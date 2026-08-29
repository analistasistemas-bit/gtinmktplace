import { describe, expect, it } from 'vitest';
import { carregarSeriePulseVendedores } from '../carregar-serie-vendedores.ts';

type Linha = { seller_id: number; transactions_total: number; dia: string };

function dbMock(linhas: Linha[]) {
  let rangeCall = 0;
  const db = {
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        not: () => query,
        order: () => query,
        range: (_from: number, _to: number) => {
          rangeCall += 1;
          const offset = _from;
          const slice = linhas.slice(offset, offset + (_to - _from + 1));
          return Promise.resolve({ data: slice, error: null });
        },
      };
      return query;
    },
  };
  return { db, getRangeCalls: () => rangeCall };
}

describe('carregarSeriePulseVendedores', () => {
  it('devolve série ordenada com seller_id string', async () => {
    const linhas: Linha[] = [
      { seller_id: 1, transactions_total: 100, dia: '2026-08-01' },
      { seller_id: 1, transactions_total: 150, dia: '2026-08-15' },
      { seller_id: 2, transactions_total: 50, dia: '2026-08-01' },
    ];
    const { db } = dbMock(linhas);
    const serie = await carregarSeriePulseVendedores(db as never, 'org-1', [1, 2]);
    expect(serie).toEqual([
      { seller_id: '1', transactions_total: 100, dia: '2026-08-01' },
      { seller_id: '1', transactions_total: 150, dia: '2026-08-15' },
      { seller_id: '2', transactions_total: 50, dia: '2026-08-01' },
    ]);
  });

  it('sellerIds vazio → [] sem query', async () => {
    const { db, getRangeCalls } = dbMock([]);
    const serie = await carregarSeriePulseVendedores(db as never, 'org-1', []);
    expect(serie).toEqual([]);
    expect(getRangeCalls()).toBe(0);
  });
});
