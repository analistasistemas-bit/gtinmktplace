import { describe, expect, it } from 'vitest';
import { calcularResumo } from '../sales-summary.ts';
import type { Venda } from '../sales-types.ts';

const sale = (patch: Partial<Venda> = {}): Venda => ({
  id: 'sale-1', order_id: 1, pack_id: null, status: 'paid', date_closed: '2026-10-02T12:00:00Z',
  date_created: null, total_amount: 100, liquido: 80, sale_fee_total: 20, frete_vendedor: null,
  estorno: null, money_release_date: null, itens: [{ id: 'item-1', ml_item_id: 'MLB1', variation_id: 1,
    titulo: null, codigo: 'SKU', ean: null, quantity: 1, unit_price: 100, custo_congelado: 50 }], ...patch,
});

describe('calcularResumo compartilhado', () => {
  it('calcula markup, não margem, após imposto e custo congelado', () => {
    const summary = calcularResumo([sale()], (item) => item.custo_congelado ?? 999, undefined, Date.now(), () => 8);
    expect(summary.bruto).toBe(100);
    expect(summary.markup).toBeCloseTo(0.44);
    expect(summary.vendasComCusto).toBe(1);
  });

  it('preserva bruto reembolsado, separa estorno e faz fallback por SKU', () => {
    const row = sale({ status: 'refunded', estorno: 100, itens: [{ ...sale().itens[0], custo_congelado: null }] });
    const summary = calcularResumo([row], (item) => item.codigo === 'SKU' ? 50 : null);
    expect(summary.bruto).toBe(100);
    expect(summary.estornos).toBe(100);
    expect(summary.markup).toBeCloseTo(0.6);
  });

  it('devolve markup nulo sem custo', () => {
    expect(calcularResumo([sale({ itens: [{ ...sale().itens[0], custo_congelado: null }] })]).markup).toBeNull();
  });
});
