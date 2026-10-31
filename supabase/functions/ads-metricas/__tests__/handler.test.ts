import { describe, expect, it, vi } from 'vitest';
import { tratar, type DepsAdsMetricas } from '../handler.ts';
import type { DepsCacheAds } from '../../_shared/ads/metricas-cache.ts';
import type { ConexaoCanal } from '../../_shared/canais/conexao.ts';
import type { RespostaML } from '../../_shared/trafego/sincronizar.ts';

// 2026-10-31 12:00 BRT: hoje = 31/10, ontem = 30/10, retenção até 01/08 (hoje − 91).
const AGORA = new Date('2026-10-31T15:00:00Z');
const ORG = 'org-da-sessao';
const ADV = 999;
const CAMP = 123;
const CONEXAO: ConexaoCanal = { id: 'cx-1', orgId: ORG, canal: 'mercado_livre', contaExternaId: '555', expiresAt: null };

const PEDIDO = { desde: '2026-10-28', ate: '2026-10-30', comparar: 'nenhum', escopo: 'conta' };

function diasEntre(desde: string, ate: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${desde}T00:00:00Z`); t <= Date.parse(`${ate}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
const janelaDe = (url: string) => {
  const q = new URL(`https://x${url}`).searchParams;
  return { desde: q.get('date_from')!, ate: q.get('date_to')! };
};

/** ML falso: 1 campanha (123) do anunciante 999; `lacuna` tira o 1º dia da série diária. */
function mlFalso(opc: { lacuna?: boolean } = {}) {
  const chamadas: string[] = [];
  const ok = (corpo: unknown): RespostaML => ({ status: 200, retryAfterMs: null, corpo });
  const get = vi.fn(async (path: string): Promise<RespostaML> => {
    chamadas.push(path);
    if (path.startsWith('/advertising/advertisers')) return ok({ advertisers: [{ site_id: 'MLB', advertiser_id: ADV }] });
    const j = janelaDe(path);
    const serie = () => {
      const dias = diasEntre(j.desde, j.ate).slice(opc.lacuna ? 1 : 0);
      return ok({ results: dias.map((date) => ({ date, cost: 1, clicks: 2, prints: 3 })) });
    };
    if (path.includes('/campaigns/search')) {
      if (path.includes('aggregation_type=DAILY')) return serie();
      return ok({
        paging: { total: 1 },
        results: [{ id: CAMP, name: 'Campanha A', status: 'active', metrics: { cost: 3 } }],
        metrics_summary: { cost: 3 },
      });
    }
    if (path.includes(`/product_ads/campaigns/${CAMP}`)) {
      if (path.includes('aggregation_type=DAILY')) return serie();
      return ok({ metrics: { cost: 3, impression_share: 0.4 } });
    }
    return { status: 404, retryAfterMs: null, corpo: null };
  });
  return { get, chamadas };
}

function cacheMemoria() {
  const m = new Map<string, string>();
  const cache: DepsCacheAds = {
    get: vi.fn(async (k: string) => m.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { m.set(k, v); }),
    setNX: vi.fn(async (k: string, v: string) => { if (m.has(k)) return false; m.set(k, v); return true; }),
  };
  return { m, cache };
}

function montar(over: Partial<DepsAdsMetricas> = {}, ml = mlFalso(), c = cacheMemoria()) {
  const deps: DepsAdsMetricas = {
    autenticar: vi.fn(async () => ({ orgId: ORG })),
    moduloAds: vi.fn(async () => true),
    conexao: vi.fn(async () => CONEXAO),
    ml: vi.fn(() => ml.get),
    cache: c.cache,
    agora: () => AGORA,
    esperar: async () => {},
    ...over,
  };
  return { deps, ml, c };
}

const post = (corpo: unknown) => new Request('https://x/functions/v1/ads-metricas', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
});

describe('ads-metricas: sessão e módulo', () => {
  it('sem sessão: devolve a recusa do requireUserOrg e não resolve conexão', async () => {
    const { deps, ml } = montar({
      autenticar: vi.fn(async () => { throw new Response('{"error":"não autenticado"}', { status: 401 }); }),
    });
    const r = await tratar(post(PEDIDO), deps);
    expect(r.status).toBe(401);
    expect(deps.conexao).not.toHaveBeenCalled();
    expect(ml.get).not.toHaveBeenCalled();
  });

  it('módulo ads desligado: 403 sem conexão nem ML', async () => {
    const { deps, ml } = montar({ moduloAds: vi.fn(async () => false) });
    const r = await tratar(post(PEDIDO), deps);
    expect(r.status).toBe(403);
    expect(deps.conexao).not.toHaveBeenCalled();
    expect(ml.get).not.toHaveBeenCalled();
  });

  it('org sem conexão ML: estado sem_conexao', async () => {
    const { deps, ml } = montar({ conexao: vi.fn(async () => null) });
    const r = await tratar(post(PEDIDO), deps);
    expect(r.status).toBe(200);
    expect((await r.json()).estado).toBe('sem_conexao');
    expect(ml.get).not.toHaveBeenCalled();
  });
});

describe('ads-metricas: isolamento', () => {
  it('org_id e advertiser_id do body são ignorados: conexão e anunciante vêm da sessão', async () => {
    const { deps, ml, c } = montar();
    const r = await tratar(post({ ...PEDIDO, org_id: 'org-alheia', advertiser_id: 777, orgId: 'org-alheia' }), deps);
    expect(r.status).toBe(200);
    expect(deps.moduloAds).toHaveBeenCalledWith(ORG);
    expect(deps.conexao).toHaveBeenCalledWith(ORG);
    expect(ml.chamadas.some((p) => p.includes('/advertisers/777/'))).toBe(false);
    expect(ml.chamadas.some((p) => p.includes(`/advertisers/${ADV}/`))).toBe(true);
    expect([...c.m.keys()].every((k) => !k.includes('org-alheia'))).toBe(true);
  });

  it('campanha de outro anunciante: sem_acesso sem chamar E3/E4', async () => {
    const { deps, ml } = montar();
    const r = await tratar(post({ ...PEDIDO, escopo: 'campanha', campanhaId: 4242 }), deps);
    const corpo = await r.json();
    expect(corpo.estado).toBe('sem_acesso');
    expect(ml.chamadas.some((p) => /\/product_ads\/campaigns\/\d+/.test(p))).toBe(false);
  });

  it('competitividade de outro anunciante: sem_acesso sem chamar E3', async () => {
    const { deps, ml } = montar();
    const corpo = await (await tratar(post({ ...PEDIDO, escopo: 'competitividade', campanhaId: 4242 }), deps)).json();
    expect(corpo.estado).toBe('sem_acesso');
    expect(ml.chamadas.some((p) => /\/product_ads\/campaigns\/\d+/.test(p))).toBe(false);
  });

  it('competitividade da campanha própria: só E3 e só campos de participação', async () => {
    const { deps, ml } = montar();
    const corpo = await (await tratar(post({ ...PEDIDO, escopo: 'competitividade', campanhaId: CAMP }), deps)).json();
    expect(corpo.estado).toBe('ok');
    expect(corpo.atual.resumo.impression_share).toEqual({ valor: 0.4, motivo: null });
    expect(corpo.atual.resumo.cost).toBeUndefined();
    expect(ml.chamadas.some((p) => p.includes(`/product_ads/campaigns/${CAMP}`) && p.includes('aggregation_type'))).toBe(false);
  });
});

describe('ads-metricas: pedido inválido → 400 com motivo, sem ML', () => {
  it.each([
    [{ ...PEDIDO, desde: '2026-02-30' }, 'data_invalida'],
    [{ ...PEDIDO, desde: '2026-10-30', ate: '2026-10-28' }, 'ordem'],
    [{ ...PEDIDO, ate: '2026-10-31' }, 'futuro'],
    [{ ...PEDIDO, desde: '2026-07-31' }, 'fora_da_retencao'],
    [{ ...PEDIDO, escopo: 'tudo' }, 'escopo_invalido'],
    [{ ...PEDIDO, comparar: 'sim' }, 'comparar_invalido'],
    [{ ...PEDIDO, escopo: 'campanha' }, 'campanha_invalida'],
    [{ ...PEDIDO, escopo: 'campanha', campanhaId: -1 }, 'campanha_invalida'],
  ])('%j → %s', async (pedido, motivo) => {
    const { deps, ml } = montar();
    const r = await tratar(post(pedido), deps);
    expect(r.status).toBe(400);
    expect((await r.json()).motivo).toBe(motivo);
    expect(ml.get).not.toHaveBeenCalled();
  });

  it('limite da retenção (hoje − 91) é aceito', async () => {
    const { deps } = montar();
    expect((await tratar(post({ ...PEDIDO, desde: '2026-08-01' }), deps)).status).toBe(200);
  });
});

describe('ads-metricas: cache', () => {
  it('cache hit não chama o ML', async () => {
    const { deps, ml } = montar();
    const a = await (await tratar(post(PEDIDO), deps)).json();
    expect(a.estado).toBe('ok');
    const n = ml.get.mock.calls.length;
    const b = await (await tratar(post(PEDIDO), deps)).json();
    expect(ml.get.mock.calls.length).toBe(n);
    expect(b).toEqual(a);
  });

  it('resposta incompleta não é cacheada', async () => {
    const { deps, ml, c } = montar({}, mlFalso({ lacuna: true }));
    const a = await (await tratar(post(PEDIDO), deps)).json();
    expect(a.estado).toBe('parcial');
    expect([...c.m.keys()].some((k) => k.startsWith('ads:metricas:v1:org'))).toBe(false);
    const n = ml.get.mock.calls.length;
    await tratar(post(PEDIDO), deps);
    expect(ml.get.mock.calls.length).toBeGreaterThan(n);
  });

  it('fresco repetido em 60 s é recusado com 429 sem chamar o ML', async () => {
    const { deps, ml } = montar();
    expect((await tratar(post({ ...PEDIDO, fresco: true }), deps)).status).toBe(200);
    const n = ml.get.mock.calls.length;
    const r = await tratar(post({ ...PEDIDO, fresco: true }), deps);
    expect(r.status).toBe(429);
    expect(ml.get.mock.calls.length).toBe(n);
  });
});

describe('ads-metricas: comparação', () => {
  it('anterior fora da retenção: comparação indisponível, não desligada', async () => {
    const { deps } = montar();
    const corpo = await (await tratar(post({ ...PEDIDO, desde: '2026-08-01', comparar: 'anterior' }), deps)).json();
    expect(corpo.comparacao.estado).toBe('indisponivel');
    expect(corpo.anterior).toBeNull();
  });

  it('campanhas: E1 atual + anterior unidos pelo ID', async () => {
    const { deps } = montar();
    const corpo = await (await tratar(post({ ...PEDIDO, escopo: 'campanhas', comparar: 'anterior' }), deps)).json();
    expect(corpo.estado).toBe('ok');
    expect(corpo.comparacao.estado).toBe('disponivel');
    expect(corpo.campanhas).toHaveLength(1);
    expect(corpo.campanhas[0].anterior.janela).toEqual({ desde: '2026-10-25', ate: '2026-10-27' });
  });
});
