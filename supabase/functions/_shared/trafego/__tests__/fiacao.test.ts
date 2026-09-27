import { describe, expect, it, vi } from 'vitest';
import {
  buscarML, classificarItensTrafego, corteRetencao, corteVendidos, dedupContinuacao, dedupFanout,
  delaySegundos, parseMultigetStatus, parseRetryAfterMs, preservarStatus, tratarRequisicao, type Rotas,
} from '../fiacao.ts';

describe('ids de deduplicação do QStash', () => {
  it('fan-out = org + dia, só caracteres aceitos', () => {
    expect(dedupFanout('org-1', '2026-09-27')).toBe('trafego_org-1_2026-09-27');
  });
  it('continuação = org + rodada + cursor + tentativa; tentativa muda o id', () => {
    const m = { org_id: 'org-1', rodada: '2026-09-27T09:17:00.123+00:00', cursor: 'MLB1', primeira: false };
    expect(dedupContinuacao(m)).toBe('trafego_org-1_2026-09-27T09_17_00_123_00_00_MLB1_0');
    expect(dedupContinuacao({ ...m, tentativa: 2 })).toMatch(/_MLB1_2$/);
    expect(dedupContinuacao({ ...m, cursor: null })).toMatch(/00_00__0$/);
  });
});

describe('delaySegundos', () => {
  it('ms → s arredondado para cima; ausente ou zero → sem delay', () => {
    expect(delaySegundos(1500)).toBe(2);
    expect(delaySegundos(1000)).toBe(1);
    expect(delaySegundos(0)).toBeUndefined();
    expect(delaySegundos(undefined)).toBeUndefined();
  });
});

describe('parseRetryAfterMs', () => {
  it('segundos → ms; ausente/inválido → null', () => {
    expect(parseRetryAfterMs('3')).toBe(3000);
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs('amanhã')).toBeNull();
  });
});

describe('parseMultigetStatus', () => {
  it('só entradas 200 com id e status', () => {
    expect(parseMultigetStatus([
      { code: 200, body: { id: 'MLB1', status: 'active' } },
      { code: 404, body: { id: 'MLB2', status: 'closed' } },
      { code: 200, body: { id: 'MLB3' } },
      null,
    ])).toEqual([{ ml_item_id: 'MLB1', status: 'active' }]);
    expect(parseMultigetStatus({ erro: 1 })).toEqual([]);
  });
});

describe('preservarStatus', () => {
  it("'desconhecido' não sobrescreve status já gravado (closed segue closed); MLB novo fica desconhecido", () => {
    const iso = '2026-09-27T12:00:00.000Z';
    expect(preservarStatus([
      { ml_item_id: 'MLB1', status: 'desconhecido', ultimo_ok_em: iso },
      { ml_item_id: 'MLB2', status: 'desconhecido', ultimo_ok_em: iso },
      { ml_item_id: 'MLB3', status: 'active', ultimo_ok_em: null },
    ], new Map([['MLB1', 'closed'], ['MLB3', 'paused']]))).toEqual([
      { ml_item_id: 'MLB1', status: 'closed', ultimo_ok_em: iso },
      { ml_item_id: 'MLB2', status: 'desconhecido', ultimo_ok_em: iso },
      { ml_item_id: 'MLB3', status: 'active', ultimo_ok_em: null },
    ]);
  });
});

describe('classificarItensTrafego', () => {
  it('encerrado = closed há mais de 30 dias; comColetaOk = ultimo_ok_em não nulo', () => {
    const agora = Date.parse('2026-09-27T12:00:00Z');
    const r = classificarItensTrafego([
      { ml_item_id: 'MLB1', status: 'closed', status_desde: '2026-08-01T00:00:00Z', ultimo_ok_em: null },
      { ml_item_id: 'MLB2', status: 'closed', status_desde: '2026-09-20T00:00:00Z', ultimo_ok_em: '2026-09-26T09:00:00Z' },
      { ml_item_id: 'MLB3', status: 'paused', status_desde: '2026-01-01T00:00:00Z', ultimo_ok_em: '2026-09-26T09:00:00Z' },
    ], agora);
    expect([...r.encerradosHaMaisDe30d]).toEqual(['MLB1']);
    expect([...r.comColetaOk].sort()).toEqual(['MLB2', 'MLB3']);
  });
});

describe('cortes de data', () => {
  it('retenção: dia BRT de hoje menos 13 meses', () => {
    expect(corteRetencao(new Date('2026-09-27T12:00:00Z'))).toBe('2025-08-27');
    // 01:00Z ainda é o dia anterior em BRT
    expect(corteRetencao(new Date('2026-09-27T01:00:00Z'))).toBe('2025-08-26');
  });
  it('vendidos: 180 dias atrás', () => {
    expect(corteVendidos(Date.parse('2026-09-27T12:00:00Z'))).toBe('2026-03-31T12:00:00.000Z');
  });
});

describe('buscarML', () => {
  const resp = (status: number, corpo: string, headers: Record<string, string> = {}) =>
    new Response(corpo, { status, headers });
  it('só GET, token no header, devolve status/corpo', async () => {
    const f = vi.fn(async () => resp(200, '{"a":1}'));
    expect(await buscarML('https://x/items', 'tok', f)).toEqual({ status: 200, retryAfterMs: null, corpo: { a: 1 } });
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it('429 com Retry-After; corpo não-JSON vira null', async () => {
    const f = vi.fn(async () => resp(429, 'too many', { 'Retry-After': '2' }));
    expect(await buscarML('u', 't', f)).toEqual({ status: 429, retryAfterMs: 2000, corpo: null });
  });
  it('timeout/rede → 503 (transitório: retry/adiamento, não falha imediata)', async () => {
    const f = vi.fn(async () => { throw new DOMException('timeout', 'TimeoutError'); });
    expect(await buscarML('u', 't', f)).toEqual({ status: 503, retryAfterMs: null, corpo: null });
  });
});

describe('tratarRequisicao', () => {
  const rotas = (o: Partial<Rotas> = {}) => ({
    verificar: vi.fn(async () => true),
    fanout: vi.fn(async () => 2),
    limpar: vi.fn(async () => {}),
    sincronizar: vi.fn(async () => ({ resultado: 'ok' as const })),
    ...o,
  });
  const post = (body = '') => new Request('https://x/f', { method: 'POST', body });

  it('sem assinatura válida → 401 sem fazer nada', async () => {
    const r = rotas({ verificar: vi.fn(async () => false) });
    expect((await tratarRequisicao(post('{"org_id":"o"}'), r)).status).toBe(401);
    expect(r.sincronizar).not.toHaveBeenCalled();
    expect(r.fanout).not.toHaveBeenCalled();
  });
  it('não-POST → 405', async () => {
    expect((await tratarRequisicao(new Request('https://x/f'), rotas())).status).toBe(405);
  });
  it('sem org_id → fan-out e só depois a limpeza; falha da limpeza não vira 500', async () => {
    const r = rotas({ limpar: vi.fn(async () => { throw new Error('db'); }) });
    const res = await tratarRequisicao(post(), r);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, orgs: 2 });
    expect(r.fanout.mock.invocationCallOrder[0]).toBeLessThan(r.limpar.mock.invocationCallOrder[0]);
  });
  it('fan-out que falha → 500 e sem limpeza', async () => {
    const r = rotas({ fanout: vi.fn(async () => { throw new Error('qstash'); }) });
    expect((await tratarRequisicao(post('{}'), r)).status).toBe(500);
    expect(r.limpar).not.toHaveBeenCalled();
  });
  it('com org_id → sincroniza a mensagem; erro → 500, demais → 200', async () => {
    const r = rotas();
    const msg = { org_id: 'o', rodada: 'R', cursor: 'MLB1', primeira: false, tentativa: 1 };
    expect((await tratarRequisicao(post(JSON.stringify(msg)), r)).status).toBe(200);
    expect(r.sincronizar).toHaveBeenCalledWith(msg);
    for (const [resultado, status] of [['erro', 500], ['obsoleta', 200], ['continua', 200], ['sem_acesso', 200]] as const) {
      const r2 = rotas({ sincronizar: vi.fn(async () => ({ resultado })) });
      expect((await tratarRequisicao(post('{"org_id":"o","primeira":true}'), r2)).status).toBe(status);
    }
  });
});
