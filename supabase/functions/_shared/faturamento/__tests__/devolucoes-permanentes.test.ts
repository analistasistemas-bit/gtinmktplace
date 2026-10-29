import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enriquecerPendentes } from '../devolucoes-io';

const resp = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body),
}) as never;

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('erros permanentes do ML em claim antigo (Claims 1.0 / sem acesso)', () => {
  const E401 = { code: 401, error: 'unauthorized_request_error', message: 'This functionality is not available for Claims 1.0. Please see the documentation' };
  const E403 = { code: 403, error: 'forbidden_error', message: 'User does not have access to claim' };
  const fakeAdmin = () => {
    const linhas: any[] = [];
    const b: any = {};
    for (const m of ['select', 'eq', 'is', 'order', 'limit', 'gt', 'update']) b[m] = () => b;
    b.maybeSingle = async () => ({ data: null });
    b.then = (ok: (v: unknown) => unknown) => ok({ data: [{ claim_id: 5 }], error: null });
    return { linhas, rpc: vi.fn(async (_f: string, { linha }: any) => { linhas.push(linha); return { data: linha, error: null }; }), from: () => b } as any;
  };
  const cx = { id: 'c', orgId: 'o', canal: 'mercado_livre', contaExternaId: '999', expiresAt: null, criadoPor: 'u' };
  const rodar = async (status: string, detail: [number, unknown], rep: [number, unknown], ret: [number, unknown]) => {
    const admin = fakeAdmin();
    vi.mocked(fetch).mockImplementation(async (url) => {
      const u = String(url);
      if (u.endsWith('/claims/5')) return resp(200, { id: 5, status, resource: 'order', resource_id: 9, players: [] });
      if (u.endsWith('/detail')) return resp(...detail);
      if (u.endsWith('/affects-reputation')) return resp(...rep);
      if (u.endsWith('/returns')) return resp(...ret);
      return resp(404, {});
    });
    await enriquecerPendentes(admin, 't', 'o', cx, 0, 20);
    return admin.linhas[0];
  };

  it('closed + 401 Claims 1.0 + 403: enriquecido', async () => {
    expect((await rodar('closed', [401, E401], [403, E403], [403, E403])).enriquecido_em).toBeTruthy();
  });
  it('closed + só 403: enriquecido', async () => {
    expect((await rodar('closed', [403, E403], [403, E403], [403, E403])).enriquecido_em).toBeTruthy();
  });
  it('closed: não apaga o que já está gravado (colunas não lidas ficam fora da linha)', async () => {
    const l = await rodar('closed', [401, E401], [403, E403], [403, E403]);
    expect(l).not.toHaveProperty('detalhe');
    expect(l).not.toHaveProperty('afeta_reputacao');
    expect(l).not.toHaveProperty('return_status');
  });
  it('opened + 403: continua pendente', async () => {
    expect((await rodar('opened', [403, E403], [403, E403], [403, E403])).enriquecido_em).toBeUndefined();
  });
  it('closed + 500: continua pendente', async () => {
    expect((await rodar('closed', [500, {}], [500, {}], [500, {}])).enriquecido_em).toBeUndefined();
  });
  const E401B = { code: 401, error: 'unauthorized_request_error', message: 'You are not authorized to obtain claim 5557947710', cause: null };
  it('closed + 401 "not authorized to obtain claim" em returns: enriquecido', async () => {
    expect((await rodar('closed', [200, { title: 'x' }], [200, { affects_reputation: 'no' }], [401, E401B])).enriquecido_em).toBeTruthy();
  });
  it('opened + mesmo 401: continua pendente', async () => {
    expect((await rodar('opened', [200, { title: 'x' }], [200, { affects_reputation: 'no' }], [401, E401B])).enriquecido_em).toBeUndefined();
  });
  it('closed + 401 invalid_token em returns: continua pendente', async () => {
    expect((await rodar('closed', [200, { title: 'x' }], [200, { affects_reputation: 'no' }], [401, { message: 'invalid_token' }])).enriquecido_em).toBeUndefined();
  });
  it('low_cost com id 0: enriquecido, return_id null, status mantido, sem chamar /returns/0/reviews', async () => {
    const l = await rodar('closed', [200, { title: 'x' }], [200, { affects_reputation: 'no' }],
      [200, { id: 0, status: 'closed', status_money: 'refunded', subtype: 'low_cost', related_entities: null, shipments: null }]);
    expect(l.enriquecido_em).toBeTruthy();
    expect(l.return_id).toBeNull();
    expect(l.return_status).toBe('closed');
    expect(l.return_status_money).toBe('refunded');
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes('/returns/0/'))).toBe(false);
  });
  it('closed + 401 que não é Claims 1.0: continua pendente', async () => {
    expect((await rodar('closed', [401, { message: 'invalid token' }], [403, E403], [403, E403])).enriquecido_em).toBeUndefined();
  });
});

describe('enriquecerPendentes: 403 permanente no GET principal do claim', () => {
  const E403 = { code: 403, error: 'forbidden_error', message: 'User does not have access to claim' };
  const cx = { id: 'c', orgId: 'o', canal: 'mercado_livre', contaExternaId: '999', expiresAt: null, criadoPor: 'u' };
  const rodar = async (statusLocal: string, status: number, body: unknown) => {
    const updates: any[] = [];
    const b: any = {};
    for (const m of ['select', 'is', 'order', 'limit', 'gt']) b[m] = () => b;
    b.eq = (c: string, v: unknown) => { b.filtros.push([c, v]); return b; };
    b.filtros = [] as unknown[];
    b.then = (ok: (v: unknown) => unknown) => ok({ data: [{ claim_id: 5, status: statusLocal }], error: null });
    const admin: any = {
      updates, rpc: vi.fn(async () => ({ data: {}, error: null })),
      from: () => ({
        ...b,
        update: (v: unknown) => { const u: any = { v, filtros: [] }; updates.push(u); const c: any = { eq: (k: string, x: unknown) => { u.filtros.push([k, x]); return c; }, then: (ok: (r: unknown) => unknown) => ok({ error: null }) }; return c; },
      }),
    };
    vi.mocked(fetch).mockImplementation(async () => resp(status, body));
    const r = await enriquecerPendentes(admin, 't', 'o', cx, 0, 20);
    return { admin, r };
  };

  it('closed + 403 permanente: grava só enriquecido_em (org+claim) e conta como processada', async () => {
    const { admin, r } = await rodar('closed', 403, E403);
    expect(r.n).toBe(1);
    expect(admin.updates).toHaveLength(1);
    expect(Object.keys(admin.updates[0].v)).toEqual(['enriquecido_em']);
    expect(admin.updates[0].filtros).toEqual([['org_id', 'o'], ['claim_id', 5]]);
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it('opened + 403: continua pendente', async () => {
    const { admin, r } = await rodar('opened', 403, E403);
    expect(r.n).toBe(0);
    expect(admin.updates).toHaveLength(0);
  });
  it('closed + 500: continua pendente', async () => {
    const { admin, r } = await rodar('closed', 500, {});
    expect(r.n).toBe(0);
    expect(admin.updates).toHaveLength(0);
  });
  it('closed + 403 com outra mensagem / 401 de token: continua pendente', async () => {
    expect((await rodar('closed', 403, { message: 'other' })).admin.updates).toHaveLength(0);
    expect((await rodar('closed', 401, { message: 'invalid token' })).admin.updates).toHaveLength(0);
  });
});
