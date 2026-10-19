import { describe, expect, it, vi } from 'vitest';
import { reenfileirarPushFiscalPendente } from '../push-fiscal-pendente.ts';

const AGORA = new Date('2026-10-19T12:00:00Z');
type Fam = { id: string; publicado_em: string | null; fiscal_sincronizado_em: string | null };

function fakeAdmin(opts: { modulos?: string[]; familias?: Fam[]; familiasErro?: string } = {}) {
  const lidas: string[] = [];
  const admin = {
    from: (t: string) => {
      if (t === 'organizations') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () =>
          ({ data: { modulos_habilitados: opts.modulos ?? ['fiscal'] }, error: null }) }) }) };
      }
      lidas.push(t);
      // Emula o PostgREST: sem .range() corta em 1000 linhas.
      let faixa: [number, number] = [0, 999];
      const q: Record<string, unknown> = {
        eq: () => q,
        not: () => q,
        order: () => q,
        range: (a: number, b: number) => { faixa = [a, b]; return q; },
        then: (res: (v: unknown) => unknown) => Promise.resolve(opts.familiasErro
          ? { data: null, error: { message: opts.familiasErro } }
          : { data: (opts.familias ?? []).slice(faixa[0], Math.min(faixa[1], faixa[0] + 999) + 1), error: null }).then(res),
      };
      return { select: () => q };
    },
  };
  return { admin: admin as never, lidas };
}

describe('reenfileirarPushFiscalPendente (C4)', () => {
  it('org sem módulo fiscal → 0 sem ler familias', async () => {
    const { admin, lidas } = fakeAdmin({ modulos: [] });
    const enq = vi.fn(async () => {});
    expect(await reenfileirarPushFiscalPendente(admin, 'o1', enq, AGORA)).toBe(0);
    expect(lidas).toEqual([]);
  });

  it.each([
    ['nunca concluído', { publicado_em: '2026-10-19T11:00:00Z', fiscal_sincronizado_em: null }, 1],
    ['concluído depois de publicar', { publicado_em: '2026-10-19T11:00:00Z', fiscal_sincronizado_em: '2026-10-19T11:10:00Z' }, 0],
    ['dentro da carência de 30 min', { publicado_em: '2026-10-19T11:50:00Z', fiscal_sincronizado_em: null }, 0],
    ['sincronizado antes de publicar', { publicado_em: '2026-10-19T11:00:00Z', fiscal_sincronizado_em: '2026-10-19T10:00:00Z' }, 1],
    ['publicado_em nulo', { publicado_em: null, fiscal_sincronizado_em: null }, 0],
  ])('%s', async (_n, f, esperado) => {
    const { admin } = fakeAdmin({ familias: [{ id: 'f1', ...f }] });
    const enq = vi.fn(async () => {});
    expect(await reenfileirarPushFiscalPendente(admin, 'o1', enq, AGORA)).toBe(esperado);
    expect(enq).toHaveBeenCalledTimes(esperado);
  });

  it('falha de enqueue em uma família não impede as demais', async () => {
    const f = { publicado_em: '2026-10-19T11:00:00Z', fiscal_sincronizado_em: null };
    const { admin } = fakeAdmin({ familias: [{ id: 'a', ...f }, { id: 'b', ...f }] });
    const enq = vi.fn().mockRejectedValueOnce(new Error('qstash')).mockResolvedValue(undefined);
    expect(await reenfileirarPushFiscalPendente(admin, 'o1', enq, AGORA)).toBe(1);
    expect(enq).toHaveBeenCalledTimes(2);
  });

  it('erro lendo familias → rejeita', async () => {
    const { admin } = fakeAdmin({ familiasErro: 'boom' });
    await expect(reenfileirarPushFiscalPendente(admin, 'o1', vi.fn(), AGORA)).rejects.toThrow('boom');
  });

  it('pendente fora da 1ª página de 1000 linhas também é reenfileirado', async () => {
    const ok = { publicado_em: '2026-10-19T11:00:00Z', fiscal_sincronizado_em: '2026-10-19T11:10:00Z' };
    const familias: Fam[] = Array.from({ length: 1000 }, (_, i) => ({ id: `ok${i}`, ...ok }));
    familias.push({ id: 'pendente', publicado_em: '2026-10-19T11:00:00Z', fiscal_sincronizado_em: null });
    const { admin } = fakeAdmin({ familias });
    const enq = vi.fn(async () => {});
    expect(await reenfileirarPushFiscalPendente(admin, 'o1', enq, AGORA)).toBe(1);
    expect(enq).toHaveBeenCalledWith('pendente');
  });
});
