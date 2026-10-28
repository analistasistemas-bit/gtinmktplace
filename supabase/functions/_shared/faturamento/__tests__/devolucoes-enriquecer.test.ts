import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buscarExtrasClaim, enriquecerPendentes, lerClaimCompleto } from '../devolucoes-io';

const resp = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
}) as never;
const respJsonInvalido = () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }) as never;

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('JSON inválido em 200 nunca vira leitura bem-sucedida (achado 3)', () => {
  it('detalhe, reputação e revisões ficam ok:false; revisões sem "reviews" também', async () => {
    const f = vi.mocked(fetch);
    f.mockResolvedValue(respJsonInvalido());
    const ex = await buscarExtrasClaim('t', '1', 5);
    expect(ex).toEqual({ detalhe: { ok: false }, reputacao: { ok: false }, revisoes: { ok: false } });

    f.mockReset();
    f.mockResolvedValueOnce(resp(200, { title: 'x' })).mockResolvedValueOnce(resp(200, { affects_reputation: 'x' }))
      .mockResolvedValueOnce(resp(200, { sem: 'envelope' }));
    expect((await buscarExtrasClaim('t', '1', 5)).revisoes).toEqual({ ok: false });
  });
});

describe('lerClaimCompleto: versão capturada ANTES de ler o claim (achado 1)', () => {
  it('lidoEm é anterior ao GET do claim', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T12:00:00.000Z'));
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url).endsWith('/claims/7')) { vi.setSystemTime(new Date('2026-10-28T12:00:05.000Z')); return resp(200, { id: 7 }); }
      return resp(404, {});
    });
    const r = await lerClaimCompleto('t', '7');
    expect(r.lidoEm).toBe('2026-10-28T12:00:00.000Z');
    expect(r.claim).toEqual({ id: 7 });
  });
});

describe('enriquecerPendentes real, duas rodadas (achado 5)', () => {
  // admin fake: ml_devolucoes com 3 linhas; o RPC grava enriquecido_em quando a linha o traz.
  function criarAdmin() {
    const rows = new Map<number, { enriquecido_em: string | null }>([[1, { enriquecido_em: null }], [2, { enriquecido_em: null }], [3, { enriquecido_em: null }]]);
    const chain = (resolver: () => unknown) => {
      const b: any = {};
      for (const m of ['select', 'eq', 'is', 'order', 'limit', 'update']) b[m] = () => b;
      let gt = 0;
      b.gt = (_c: string, v: number) => { gt = v; return b; };
      b.maybeSingle = async () => ({ data: null });
      b.then = (ok: (v: unknown) => unknown) => ok(resolver.call({ gt }));
      return b;
    };
    const admin: any = {
      rows,
      rpc: vi.fn(async (_fn: string, { linha }: any) => {
        const r = rows.get(Number(linha.claim_id))!;
        if (linha.enriquecido_em) r.enriquecido_em = linha.enriquecido_em;
        return { data: linha, error: null };
      }),
      from: (tabela: string) => {
        const b: any = chain(function (this: { gt: number }) {
          if (tabela !== 'ml_devolucoes') return { data: [], error: null };
          const ids = [...rows.entries()].filter(([id, r]) => r.enriquecido_em === null && id > this.gt).map(([id]) => ({ claim_id: id }));
          return { data: ids, error: null };
        });
        return b;
      },
    };
    return admin;
  }

  it('leitura falha numa linha: ela segue null, as outras gravam, e a próxima rodada retenta', async () => {
    const admin = criarAdmin();
    let falhar = true;
    vi.mocked(fetch).mockImplementation(async (url) => {
      const u = String(url);
      const id = Number(/claims\/(\d+)/.exec(u)?.[1]);
      if (u.endsWith(`/claims/${id}`)) return resp(200, { id, resource: 'order', resource_id: 9000 + id, players: [] });
      if (u.includes('/v2/') && u.endsWith('/returns')) return resp(404, {});
      if (u.endsWith('/detail')) return id === 2 && falhar ? resp(500, {}) : resp(200, { title: 't' });
      if (u.endsWith('/affects-reputation')) return resp(200, { affects_reputation: 'not_affected' });
      return resp(404, {});
    });
    const cx = { id: 'c', orgId: 'o', canal: 'mercado_livre', contaExternaId: '999', expiresAt: null, criadoPor: 'u' };

    const r1 = await enriquecerPendentes(admin, 'tok', 'o', cx, 0, 20);
    expect(r1).toEqual({ n: 3, ultimo: 3 }); // upsert da 2 também gravou (colunas lidas), mas sem enriquecido_em
    expect(admin.rows.get(1)!.enriquecido_em).not.toBeNull();
    expect(admin.rows.get(3)!.enriquecido_em).not.toBeNull();
    expect(admin.rows.get(2)!.enriquecido_em).toBeNull();

    falhar = false;
    const r2 = await enriquecerPendentes(admin, 'tok', 'o', cx, 0, 20);
    expect(r2.ultimo).toBe(2);
    expect(admin.rows.get(2)!.enriquecido_em).not.toBeNull();
  });
});
