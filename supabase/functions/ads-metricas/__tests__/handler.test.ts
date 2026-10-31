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

/** ML falso: 1 campanha (123) do anunciante 999; `lacuna` tira o 1º dia da série diária (só das janelas com
 *  `ate` ≤ `lacunaAte`, quando informado). E5: `anuncios` linhas da campanha + 1 de outra campanha (spike 057). */
function mlFalso(opc: {
  lacuna?: boolean; lacunaAte?: string; anuncios?: number; e5?: (path: string) => RespostaML | null;
  /** A campanha 123 só aparece na listagem E1 das janelas com `ate` ≤ este dia (campanha histórica). */
  campanhaAte?: string;
  /** Status HTTP forçado em toda leitura das janelas com `ate` ≤ `ateFalha` (a anterior, no teste de isolamento). */
  falha?: number; ateFalha?: string;
} = {}) {
  const chamadas: string[] = [];
  const ok = (corpo: unknown): RespostaML => ({ status: 200, retryAfterMs: null, corpo });
  const get = vi.fn(async (path: string): Promise<RespostaML> => {
    chamadas.push(path);
    if (path.startsWith('/advertising/advertisers')) return ok({ advertisers: [{ site_id: 'MLB', advertiser_id: ADV }] });
    const j = janelaDe(path);
    if (opc.falha && opc.ateFalha && j.ate <= opc.ateFalha) return { status: opc.falha, retryAfterMs: 0, corpo: null };
    const serie = () => {
      const corta = opc.lacuna && (!opc.lacunaAte || j.ate <= opc.lacunaAte);
      const dias = diasEntre(j.desde, j.ate).slice(corta ? 1 : 0);
      return ok({ results: dias.map((date) => ({ date, cost: 1, clicks: 2, prints: 3 })) });
    };
    if (path.includes('/ads/search')) {
      const forcada = opc.e5?.(path);
      if (forcada) return forcada;
      const q = new URL(`https://x${path}`).searchParams;
      const offset = Number(q.get('offset'));
      const linhas = [
        ...Array.from({ length: opc.anuncios ?? 2 }, (_, i) => (
          { item_id: `MLB${i + 1}`, campaign_id: CAMP, status: 'active', title: `A${i + 1}`, metrics: { cost: 1 } })),
        { item_id: 'MLB999', campaign_id: 4242, status: 'idle', metrics: { cost: 0 } },
      ];
      return ok({ paging: { offset, total: linhas.length }, results: linhas.slice(offset, offset + Number(q.get('limit'))) });
    }
    if (path.includes('/campaigns/search')) {
      if (path.includes('aggregation_type=DAILY')) return serie();
      if (opc.campanhaAte && j.ate > opc.campanhaAte) return ok({ paging: { total: 0 }, results: [], metrics_summary: { cost: 0 } });
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
    expect(ml.chamadas.some((p) => p.includes('/ads/search'))).toBe(false);
  });

  it('competitividade de outro anunciante: sem_acesso sem chamar E3', async () => {
    const { deps, ml } = montar();
    const corpo = await (await tratar(post({ ...PEDIDO, escopo: 'competitividade', campanhaId: 4242 }), deps)).json();
    expect(corpo.estado).toBe('sem_acesso');
    expect(ml.chamadas.some((p) => /\/product_ads\/campaigns\/\d+/.test(p))).toBe(false);
  });

  // I1c: campanha histórica (só na janela anterior) é provada pelas duas janelas; o E3 lê só a atual e cacheia.
  it('competitividade com comparação: campanha só na anterior é da conta; E3 só da atual e cacheado', async () => {
    const { deps, ml, c } = montar({}, mlFalso({ campanhaAte: '2026-10-27' }));
    const corpo = await (await tratar(post({ ...PEDIDO, comparar: 'anterior', escopo: 'competitividade', campanhaId: CAMP }), deps)).json();
    expect(corpo.estado).toBe('ok');
    expect(corpo.atual.resumo.impression_share).toEqual({ valor: 0.4, motivo: null });
    expect(corpo.anterior).toBeNull();
    const e3 = ml.chamadas.filter((p) => p.includes(`/product_ads/campaigns/${CAMP}`));
    expect(e3.map(janelaDe)).toEqual([{ desde: '2026-10-28', ate: '2026-10-30' }]);
    expect([...c.m.keys()].some((k) => k.startsWith('ads:metricas:v1:org'))).toBe(true);
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

describe('ads-metricas: anúncios da campanha (E5)', () => {
  const P = { ...PEDIDO, escopo: 'campanha', campanhaId: CAMP };
  const chaveMetricas = (m: Map<string, string>) => [...m.keys()].some((k) => k.startsWith('ads:metricas:v1:org'));

  it('campanha própria: anúncios da campanha (linha de outra descartada) e resposta cacheada', async () => {
    const { deps, c } = montar();
    const corpo = await (await tratar(post(P), deps)).json();
    expect(corpo.estado).toBe('ok');
    expect(corpo.anunciosMotivo).toBeNull();
    expect(corpo.anuncios.map((a: { itemId: string }) => a.itemId)).toEqual(['MLB1', 'MLB2']);
    expect(corpo.anuncios[0].atual.resumo.cost).toEqual({ valor: 1, motivo: null });
    expect(chaveMetricas(c.m)).toBe(true);
  });

  it('outros escopos não carregam anúncios', async () => {
    const { deps, ml } = montar();
    const corpo = await (await tratar(post(PEDIDO), deps)).json();
    expect('anuncios' in corpo).toBe(false);
    expect(ml.chamadas.some((p) => p.includes('/ads/search'))).toBe(false);
  });

  // M3: a lista atual inteira com a comparação por anúncio cortada pelo orçamento (determinístico) é cacheada —
  // com o motivo preservado no valor, nunca como lista comparada completa.
  it('anterior por anúncio além do orçamento: lista atual inteira cacheada com o motivo preservado', async () => {
    const { deps, c, ml } = montar({}, mlFalso({ anuncios: 480 }));
    const corpo = await (await tratar(post({ ...P, comparar: 'anterior' }), deps)).json();
    expect(corpo.estado).toBe('ok');
    expect(corpo.anuncios).toHaveLength(480);
    expect(corpo.anunciosMotivo).toBe('limite_de_leitura');
    const chave = [...c.m.keys()].find((k) => k.startsWith('ads:metricas:v1:org'));
    expect(chave).toBeDefined();
    expect(JSON.parse(c.m.get(chave!)!).anunciosMotivo).toBe('limite_de_leitura');
    const n = ml.get.mock.calls.length;
    const cache = await (await tratar(post({ ...P, comparar: 'anterior' }), deps)).json();
    expect(ml.get.mock.calls.length).toBe(n);
    expect(cache.anunciosMotivo).toBe('limite_de_leitura');
  });

  it('atual que estoura o orçamento: anuncios null com motivo, KPIs ok e nada cacheado', async () => {
    const { deps, c } = montar({}, mlFalso({ anuncios: 1050 }));
    const corpo = await (await tratar(post(P), deps)).json();
    expect(corpo.estado).toBe('ok');
    expect(corpo.atual.completo).toBe(true);
    expect(corpo.anuncios).toBeNull();
    expect(corpo.anunciosMotivo).toBe('limite_de_leitura');
    expect(chaveMetricas(c.m)).toBe(false);
  });

  // Falha só no E5 fica na lista: KPIs (E3/E4) preservados, estado ok e nada cacheado.
  describe.each([
    ['403', 'sem_permissao'],
    ['503', 'resposta_invalida'],
    ['prazo', 'limite_de_leitura'],
  ])('E5 com %s', (caso, motivoEsperado) => {
    it('anuncios null com motivo, KPIs da campanha preservados', async () => {
      let t = AGORA.getTime();
      const e5 = (): RespostaML | null => {
        if (caso === 'prazo') { t += 21_000; return null; } // a chamada passa do prazo de 20 s
        return { status: Number(caso), retryAfterMs: 0, corpo: null };
      };
      const { deps, c } = montar({ agora: () => new Date(t) }, mlFalso({ e5 }));
      const corpo = await (await tratar(post(P), deps)).json();
      expect(corpo.estado).toBe('ok');
      expect(corpo.atual.resumo.cost).toEqual({ valor: 3, motivo: null });
      expect(corpo.atual.completo).toBe(true);
      expect(corpo.anuncios).toBeNull();
      expect(corpo.anunciosMotivo).toBe(motivoEsperado);
      expect(corpo.avisos).toEqual([]);
      expect(chaveMetricas(c.m)).toBe(false);
    });
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

  // C2: o limite de 60 s é por org + escopo + campanha: o Atualizar da aba Campanhas pede conta e campanhas juntas.
  it('fresco em escopos/campanhas diferentes da mesma org não se bloqueiam; o mesmo recurso sim', async () => {
    const { deps } = montar();
    expect((await tratar(post({ ...PEDIDO, fresco: true }), deps)).status).toBe(200);
    expect((await tratar(post({ ...PEDIDO, escopo: 'campanhas', fresco: true }), deps)).status).toBe(200);
    expect((await tratar(post({ ...PEDIDO, escopo: 'campanha', campanhaId: CAMP, fresco: true }), deps)).status).toBe(200);
    expect((await tratar(post({ ...PEDIDO, escopo: 'competitividade', campanhaId: CAMP, fresco: true }), deps)).status).toBe(200);
    expect((await tratar(post({ ...PEDIDO, escopo: 'campanhas', fresco: true }), deps)).status).toBe(429);
    expect((await tratar(post({ ...PEDIDO, escopo: 'campanha', campanhaId: CAMP, fresco: true }), deps)).status).toBe(429);
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

  it('só a anterior incompleta: estado ok, comparação indisponível e não cacheia', async () => {
    const { deps, c } = montar({}, mlFalso({ lacuna: true, lacunaAte: '2026-10-27' }));
    const corpo = await (await tratar(post({ ...PEDIDO, comparar: 'anterior' }), deps)).json();
    expect(corpo.estado).toBe('ok');
    expect(corpo.comparacao.estado).toBe('indisponivel');
    expect(corpo.anterior).toBeNull();
    expect([...c.m.keys()].some((k) => k.startsWith('ads:metricas:v1:org'))).toBe(false);
  });

  it('campanhas: E1 atual + anterior unidos pelo ID', async () => {
    const { deps } = montar();
    const corpo = await (await tratar(post({ ...PEDIDO, escopo: 'campanhas', comparar: 'anterior' }), deps)).json();
    expect(corpo.estado).toBe('ok');
    expect(corpo.comparacao.estado).toBe('provisoria'); // 28–30/10 lido em 31/10: atribuição ainda aberta
    expect(corpo.campanhas).toHaveLength(1);
    expect(corpo.campanhas[0].anterior.janela).toEqual({ desde: '2026-10-25', ate: '2026-10-27' });
  });

  describe('modo da comparação com cache compartilhado (anterior fora da retenção)', () => {
    const P = { ...PEDIDO, desde: '2026-08-01', ate: '2026-08-03' };
    it('nenhum → anterior: a 2ª é indisponível com motivo', async () => {
      const { deps } = montar();
      expect((await (await tratar(post(P), deps)).json()).comparacao).toEqual({ estado: 'desligada', motivo: null });
      const b = (await (await tratar(post({ ...P, comparar: 'anterior' }), deps)).json()).comparacao;
      expect(b.estado).toBe('indisponivel');
      expect(b.motivo).toBeTruthy();
    });
    it('anterior → nenhum: a 2ª é desligada', async () => {
      const { deps } = montar();
      expect((await (await tratar(post({ ...P, comparar: 'anterior' }), deps)).json()).comparacao.estado).toBe('indisponivel');
      expect((await (await tratar(post(P), deps)).json()).comparacao).toEqual({ estado: 'desligada', motivo: null });
    });
  });

  // Atribuição final: hoje BRT (31/10) − dia ≥ DIAS_RELEITURA (15) para todo dia das duas janelas.
  const ABERTA = { desde: '2026-10-15', ate: '2026-10-17' }; // 31/10 − 17/10 = 14 → aberta
  const ENCERRADA = { desde: '2026-10-14', ate: '2026-10-16' }; // 31/10 − 16/10 = 15 → final
  describe.each([
    ['conta', {}],
    ['campanhas', {}],
    ['campanha', { campanhaId: CAMP }],
  ])('provisória no escopo %s', (escopo, extra) => {
    it('janela aberta → provisoria com motivo', async () => {
      const { deps } = montar();
      const corpo = await (await tratar(post({ ...PEDIDO, ...ABERTA, ...extra, escopo, comparar: 'anterior' }), deps)).json();
      expect(corpo.comparacao).toEqual({ estado: 'provisoria', motivo: 'O ML ainda pode revisar a atribuição de vendas destes dias.' });
      expect(corpo.anterior).not.toBeNull();
    });
    it('janela encerrada → disponivel', async () => {
      const { deps } = montar();
      const corpo = await (await tratar(post({ ...PEDIDO, ...ENCERRADA, ...extra, escopo, comparar: 'anterior' }), deps)).json();
      expect(corpo.comparacao).toEqual({ estado: 'disponivel', motivo: null });
    });
  });
});

// I1 pré-merge: 403/401 só na janela anterior não apaga a atual; a comparação sai indisponível com motivo.
describe.each([
  ['conta', {}],
  ['campanhas', {}],
  ['campanha', { campanhaId: CAMP }],
])('anterior falha no escopo %s', (escopo, extra) => {
  it.each([[403], [401]])('anterior %i com atual 200: atual preservada, comparação indisponível', async (status) => {
    const { deps, c } = montar({}, mlFalso({ falha: status, ateFalha: '2026-10-27' }));
    const corpo = await (await tratar(post({ ...PEDIDO, ...extra, escopo, comparar: 'anterior' }), deps)).json();
    expect(corpo.estado).toBe('ok');
    expect(corpo.atual).not.toBeNull();
    expect(corpo.atual.completo).toBe(true);
    expect(corpo.atual.resumo.cost).toEqual({ valor: 3, motivo: null });
    expect(corpo.anterior).toBeNull();
    expect(corpo.comparacao.estado).toBe('indisponivel');
    expect(corpo.comparacao.motivo).toMatch(/anterior/i);
    if (escopo === 'campanhas') expect(corpo.campanhas).toHaveLength(1);
    expect([...c.m.keys()].some((k) => k.startsWith('ads:metricas:v1:org'))).toBe(false);
  });
});

// I2 pré-merge: E1 com 500 na listagem atual sai parcial e incompleta (a UI não pode chamar de "nenhuma campanha").
it('campanhas com E1 500: estado parcial, atual.completo false e lista vazia não cacheada', async () => {
  const { deps, c } = montar({}, mlFalso({ falha: 500, ateFalha: '2026-10-30' }));
  const corpo = await (await tratar(post({ ...PEDIDO, escopo: 'campanhas' }), deps)).json();
  expect(corpo.estado).toBe('parcial');
  expect(corpo.atual.completo).toBe(false);
  expect(corpo.campanhas).toEqual([]);
  expect([...c.m.keys()].some((k) => k.startsWith('ads:metricas:v1:org'))).toBe(false);
});
