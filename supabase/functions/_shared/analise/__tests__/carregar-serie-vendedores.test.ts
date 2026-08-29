import { describe, expect, it } from 'vitest';
import { carregarSeriePulseVendedores } from '../carregar-serie-vendedores.ts';

type Linha = { seller_id: number; transactions_total: number; dia: string };

/** Mock da RPC `mercado_serie_vendedores` (ADR-0144) — não há mais select em pulse_vendedores. */
function dbMock(linhas: Linha[]) {
  const chamadas: Array<{ fn: string; args: unknown }> = [];
  let rangeCalls = 0;
  const db = {
    rpc: (fn: string, args: unknown) => {
      chamadas.push({ fn, args });
      return {
        range: (from: number, to: number) => {
          rangeCalls += 1;
          return Promise.resolve({ data: linhas.slice(from, to + 1), error: null });
        },
      };
    },
    // Se alguém voltar a ler a tabela direto, o teste quebra em vez de passar silenciosamente.
    from: () => {
      throw new Error('carregarSeriePulseVendedores não pode ler pulse_vendedores direto (ADR-0144)');
    },
  };
  return { db, chamadas, getRangeCalls: () => rangeCalls };
}

const linha = (seller_id: number, dia: string, transactions_total: number): Linha =>
  ({ seller_id, dia, transactions_total });

describe('carregarSeriePulseVendedores', () => {
  it('chama a RPC de mercado, não a tabela org-scoped (ADR-0144 D-1)', async () => {
    const { db, chamadas } = dbMock([linha(1, '2026-08-01', 10), linha(1, '2026-08-02', 12)]);
    // deno-lint-ignore no-explicit-any
    await carregarSeriePulseVendedores(db as any, [1]);
    expect(chamadas[0].fn).toBe('mercado_serie_vendedores');
    expect(chamadas[0].args).toEqual({ p_seller_ids: [1] });
  });

  it('devolve a série com seller_id como string', async () => {
    const { db } = dbMock([linha(42, '2026-08-01', 100), linha(42, '2026-08-05', 130)]);
    // deno-lint-ignore no-explicit-any
    const serie = await carregarSeriePulseVendedores(db as any, [42]);
    expect(serie).toEqual([
      { seller_id: '42', transactions_total: 100, dia: '2026-08-01' },
      { seller_id: '42', transactions_total: 130, dia: '2026-08-05' },
    ]);
  });

  it('deduplica os ids antes de perguntar', async () => {
    const { db, chamadas } = dbMock([]);
    // deno-lint-ignore no-explicit-any
    await carregarSeriePulseVendedores(db as any, [7, 7, 9, 7]);
    expect(chamadas[0].args).toEqual({ p_seller_ids: [7, 9] });
  });

  it('pagina quando a resposta enche a página', async () => {
    const muitas = Array.from({ length: 1500 }, (_, i) =>
      linha(1, `2026-08-${String((i % 28) + 1).padStart(2, '0')}`, i));
    const { db, getRangeCalls } = dbMock(muitas);
    // deno-lint-ignore no-explicit-any
    const serie = await carregarSeriePulseVendedores(db as any, [1]);
    expect(serie).toHaveLength(1500);
    expect(getRangeCalls()).toBe(2);
  });

  it('lista vazia não consulta nada', async () => {
    const { db, chamadas } = dbMock([linha(1, '2026-08-01', 10)]);
    // deno-lint-ignore no-explicit-any
    expect(await carregarSeriePulseVendedores(db as any, [])).toEqual([]);
    expect(chamadas).toHaveLength(0);
  });

  it('erro da RPC sobe — série silenciosamente vazia viraria "sem estimativa" falso', async () => {
    const db = {
      rpc: () => ({ range: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }),
    };
    // deno-lint-ignore no-explicit-any
    await expect(carregarSeriePulseVendedores(db as any, [1])).rejects.toBeTruthy();
  });
});
