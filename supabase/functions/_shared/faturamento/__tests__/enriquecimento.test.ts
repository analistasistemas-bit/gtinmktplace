import { describe, it, expect } from 'vitest';
import { montarMapaLiquido } from '../enriquecimento';
import type { PagamentoMP } from '../../mercadopago/financeiro';

function pag(p: Partial<PagamentoMP> & { id: number }): PagamentoMP {
  return p as PagamentoMP;
}

describe('montarMapaLiquido', () => {
  it('inclui a venda da conta com estorno e data de liberação', () => {
    const mapa = montarMapaLiquido([
      pag({
        id: 1,
        collector_id: 123,
        transaction_amount_refunded: 10,
        money_release_date: '2026-07-30T00:00:00.000-04:00',
      }),
    ], 123);
    expect(mapa.get('1')).toEqual({
      estorno: 10,
      releaseDate: '2026-07-30T00:00:00.000-04:00',
    });
  });

  it('descarta pagamento de terceiro (collector_id != conta)', () => {
    const mapa = montarMapaLiquido([
      pag({ id: 1, collector_id: 123 }),
      pag({ id: 2, collector_id: 999 }),
    ], 123);
    expect([...mapa.keys()]).toEqual(['1']);
  });

  it('descarta a perna de frete do ML (description marketplace_shipment)', () => {
    const mapa = montarMapaLiquido([
      pag({ id: 1, collector_id: 123 }),
      pag({ id: 2, collector_id: 123, description: 'marketplace_shipment' }),
    ], 123);
    expect([...mapa.keys()]).toEqual(['1']);
  });

  // Sem conta resolvida não dá para saber o que é venda da conta. `Number(null)` é 0, então sem
  // guard um pagamento com collector_id ausente entraria como se fosse venda própria.
  it('conta inválida (0, null, undefined, NaN) → mapa vazio', () => {
    const pagamentos = [pag({ id: 1, collector_id: 123 }), pag({ id: 2, collector_id: null })];
    expect(montarMapaLiquido(pagamentos, 0).size).toBe(0);
    expect(montarMapaLiquido(pagamentos, null as unknown as number).size).toBe(0);
    expect(montarMapaLiquido(pagamentos, undefined as unknown as number).size).toBe(0);
    expect(montarMapaLiquido(pagamentos, NaN).size).toBe(0);
  });
});
