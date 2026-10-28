import { describe, it, expect, vi, afterEach } from 'vitest';
import { lerDetalheReclamacao } from '../posvenda-io';

const CLAIM = {
  id: 9, stage: 'claim', status: 'opened',
  players: [{ role: 'respondent', user_id: 7, available_actions: [] }],
};

// Rotas (primeira que casa por substring) -> status/corpo; o que não casar responde 404.
function fakeFetch(rotas: Record<string, { status?: number; body?: unknown }>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const k = Object.keys(rotas).find((r) => String(url).includes(r));
    const r = k ? rotas[k] : { status: 404, body: {} };
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  }));
}
const base = {
  '/claims/9/returns': { body: { id: 5, orders: [{ order_id: 1 }] } },
  '/claims/9/detail': { body: { title: 't' } },
  '/claims/9/affects-reputation': { body: { affects_reputation: 'not_affected' } },
  '/returns/5/reviews': { body: { reviews: [] } },
  '/claims/9/messages': { body: [] },
  '/claims/9/status-history': { body: [] },
  '/claims/9/expected-resolutions': { body: [] },
  '/charges/return-cost': { body: { amount: 0 } },
  '/claims/9': { body: CLAIM },
};

afterEach(() => vi.unstubAllGlobals());

describe('lerDetalheReclamacao', () => {
  it('caminho feliz: incompleto vazio', async () => {
    fakeFetch(base);
    const d = await lerDetalheReclamacao('t', '9', '7');
    expect(d.incompleto).toEqual([]);
    expect(d.custo_devolucao).toBe(0);
  });
  it('revisões do return com 500 → lança (não vira "nenhuma pendente")', async () => {
    fakeFetch({ ...base, '/returns/5/reviews': { status: 500 } });
    await expect(lerDetalheReclamacao('t', '9', '7')).rejects.toThrow(/revis/i);
  });
  it('return-cost 500 → custo null e incompleto', async () => {
    fakeFetch({ ...base, '/charges/return-cost': { status: 500 } });
    const d = await lerDetalheReclamacao('t', '9', '7');
    expect(d.custo_devolucao).toBeNull();
    expect(d.incompleto).toContain('custo_devolucao');
  });
  it('mensagens 500 → historico incompleto', async () => {
    fakeFetch({ ...base, '/claims/9/messages': { status: 500 } });
    expect((await lerDetalheReclamacao('t', '9', '7')).incompleto).toContain('historico');
  });
});
