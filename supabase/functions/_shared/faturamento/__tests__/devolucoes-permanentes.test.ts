import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enriquecerPendentes } from '../devolucoes-io';

const resp = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
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
  it('closed + 401 que não é Claims 1.0: continua pendente', async () => {
    expect((await rodar('closed', [401, { message: 'invalid token' }], [403, E403], [403, E403])).enriquecido_em).toBeUndefined();
  });
});
