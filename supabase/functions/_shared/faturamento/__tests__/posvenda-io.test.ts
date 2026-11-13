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
  '/claims/9/actions-history': { body: [{ action_name: 'allow_return', player_role: 'respondent', date_created: '2026-11-04T08:41:18.000-04:00' }] },
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
  it('lê as ações já feitas no claim (actions-history)', async () => {
    fakeFetch(base);
    const d = await lerDetalheReclamacao('t', '9', '7');
    expect(d.acoes_feitas).toEqual([{ acao: 'allow_return', papel: 'respondent', data: '2026-11-04T08:41:18.000-04:00' }]);
  });
  it('actions-history 500 → vazio e incompleto', async () => {
    fakeFetch({ ...base, '/claims/9/actions-history': { status: 500 } });
    const d = await lerDetalheReclamacao('t', '9', '7');
    expect(d.acoes_feitas).toEqual([]);
    expect(d.incompleto).toContain('acoes_feitas');
  });
  it('return-cost 500 → custo null e incompleto', async () => {
    fakeFetch({ ...base, '/charges/return-cost': { status: 500 } });
    const d = await lerDetalheReclamacao('t', '9', '7');
    expect(d.custo_devolucao).toBeNull();
    expect(d.incompleto).toContain('custo_devolucao');
  });
  it('429 transitório no /returns → tenta de novo e lê (claim 5611317703, 13/11)', async () => {
    let n = 0;
    const rotas = { ...base, '/claims/9/returns': { status: 404, body: { message: 'There is no associated return' } } };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/claims/9/returns') && n++ === 0) return new Response('{"code":429}', { status: 429 });
      const k = Object.keys(rotas).find((r) => String(url).includes(r));
      const r = k ? rotas[k as keyof typeof rotas] : { status: 404, body: {} };
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
    }));
    const d = await lerDetalheReclamacao('t', '9', '7');
    expect(d.return_id).toBeNull();
    expect(n).toBe(2);
  });
  it('mensagens 500 → historico incompleto', async () => {
    fakeFetch({ ...base, '/claims/9/messages': { status: 500 } });
    expect((await lerDetalheReclamacao('t', '9', '7')).incompleto).toContain('historico');
  });
});
