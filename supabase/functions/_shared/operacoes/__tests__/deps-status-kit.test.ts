// ADR-0200 (Task 6, fix round 3): a massa usa a leitura ESTRITA para a reativação de SKU de kit (pré-checagem e
// confirmação). A frouxa devolve null para envelope 500 e confirmaria uma leitura que falhou.
import { describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ estrita: [] as string[], frouxa: [] as string[] }));
vi.mock('../ml-status.ts', () => ({
  SemAcessoStatusML: class extends Error {},
  lerStatusML: async (_t: string, id: string) => { m.frouxa.push(id); return 'pausado'; },
  lerStatusMLEstrito: async (t: string, id: string) => { m.estrita.push(`${t}:${id}`); return 'pausado'; },
}));
vi.mock('../../queue.ts', () => ({ qstashClient: () => ({ publishJSON: async () => ({}) }) }));
vi.mock('../../notificacoes/config.ts', () => ({ notificarCategoria: async () => {} }));
vi.mock('../../canais/registry.ts', () => ({ getConnector: () => ({}) }));

import { depsStatus } from '../deps.ts';

const TABELAS: Record<string, unknown[]> = {
  anuncios_externos_itens: [{ sku: 'P1', item_externo_id: 'MLB1', catalog_listing_id: null }],
};
function admin() {
  const from = (t: string) => {
    const q: Record<string, unknown> = {
      select: () => q, eq: () => q, in: () => q, or: () => q, delete: () => q,
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: TABELAS[t] ?? [], error: null }).then(ok),
    };
    return q;
  };
  const rpc = async (nome: string) => ({
    data: nome === 'kit_skus_participantes' ? ['P1']
      : nome === 'kit_ativacao_liberar' ? true : nome === 'kit_ativacao_reivindicar' ? { ok: true, anterior: false } : { ok: true },
    error: null,
  });
  return { from, rpc } as never;
}

describe('depsStatus.prepararKit (massa) × leitura estrita', () => {
  it('pré-checagem e confirmação da reativação usam lerStatusMLEstrito com o token da operação', async () => {
    const deps = depsStatus(admin(), { token: 'tok' } as never, { id: 'OP', org_id: 'O', acao: 'reativar' }, 'k', true);
    const p = await deps.prepararKit('MLB1', 'ativo');
    if (!('concluir' in p)) throw new Error(`recusou: ${JSON.stringify(p)}`);
    expect((await p.concluir({ ok: true })).liberado).toBe(true);
    expect(m.estrita).toEqual(['tok:MLB1', 'tok:MLB1']);
    expect(m.frouxa).toEqual([]);
  });
});
