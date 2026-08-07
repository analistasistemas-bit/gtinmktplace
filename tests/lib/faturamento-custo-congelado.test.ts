import { describe, it, expect } from 'vitest';
import { comCustoCongelado, type CustoCongeladoRow } from '@/lib/faturamento';
import type { Venda, VendaItem } from '@/lib/faturamento';

// O casamento item ↔ custo congelado (ADR-0109) é por chave string montada dos dois lados. Se a
// serialização divergir (bigint como number de um lado e string do outro), a chave não bate e o
// custo congelado é ignorado EM SILÊNCIO — a tela volta ao custo dinâmico sem erro nenhum.
// Achado M2 do code-review-v6: verificado à mão contra o PostgREST, mas sem teste que o prenda.

const item = (o: Partial<VendaItem> = {}): VendaItem => ({
  id: 'it', ml_item_id: null, variation_id: null, titulo: null, codigo: null,
  cor: null, ean: null, quantity: 1, unit_price: 0, sale_fee: 0, is_publiai: true, ...o,
});

/** Só os campos que `comCustoCongelado` lê. */
const venda = (itens: VendaItem[], custos: CustoCongeladoRow[]) =>
  ({ itens, custos } as unknown as Venda & { custos?: CustoCongeladoRow[] | null });

describe('comCustoCongelado — casamento item ↔ custo (ADR-0109)', () => {
  it('casa com variação nula (o caso comum: item sem variação)', () => {
    const r = comCustoCongelado(venda(
      [item({ ml_item_id: 'MLB6943015034', variation_id: null })],
      [{ ml_item_id: 'MLB6943015034', variation_id: null, custo_unitario: 15.8558 }],
    ));
    expect(r[0].custo_congelado).toBe(15.8558);
  });

  it('casa com variation_id bigint preenchido', () => {
    const r = comCustoCongelado(venda(
      [item({ ml_item_id: 'MLB1', variation_id: 203734189745 })],
      [{ ml_item_id: 'MLB1', variation_id: 203734189745, custo_unitario: 17.1224 }],
    ));
    expect(r[0].custo_congelado).toBe(17.1224);
  });

  it('NÃO casa quando a variação difere — vira null, não o custo do vizinho', () => {
    const r = comCustoCongelado(venda(
      [item({ ml_item_id: 'MLB1', variation_id: 1 })],
      [{ ml_item_id: 'MLB1', variation_id: 2, custo_unitario: 99 }],
    ));
    expect(r[0].custo_congelado).toBeNull();
  });

  it('NÃO casa quando o anúncio difere', () => {
    const r = comCustoCongelado(venda(
      [item({ ml_item_id: 'MLB1', variation_id: null })],
      [{ ml_item_id: 'MLB2', variation_id: null, custo_unitario: 99 }],
    ));
    expect(r[0].custo_congelado).toBeNull();
  });

  // numeric do Postgres pode chegar como string dependendo do driver/versão.
  it('aceita custo_unitario como string numérica', () => {
    const r = comCustoCongelado(venda(
      [item({ ml_item_id: 'MLB1' })],
      [{ ml_item_id: 'MLB1', variation_id: null, custo_unitario: '15.8558' }],
    ));
    expect(r[0].custo_congelado).toBe(15.8558);
  });

  it('custo inválido ou não positivo vira null, nunca NaN', () => {
    for (const ruim of ['abc', null, 0, -5, undefined]) {
      const r = comCustoCongelado(venda(
        [item({ ml_item_id: 'MLB1' })],
        [{ ml_item_id: 'MLB1', variation_id: null, custo_unitario: ruim }],
      ));
      expect(r[0].custo_congelado).toBeNull();
    }
  });

  it('venda sem custos congelados devolve os itens intactos, com null', () => {
    const r = comCustoCongelado(venda([item({ ml_item_id: 'MLB1' })], []));
    expect(r).toHaveLength(1);
    expect(r[0].custo_congelado).toBeNull();
    expect(r[0].ml_item_id).toBe('MLB1');
  });

  it('casa cada item da venda com o seu próprio custo', () => {
    const r = comCustoCongelado(venda(
      [item({ id: 'a', ml_item_id: 'MLB1', variation_id: 10 }), item({ id: 'b', ml_item_id: 'MLB1', variation_id: 20 })],
      [
        { ml_item_id: 'MLB1', variation_id: 20, custo_unitario: 2 },
        { ml_item_id: 'MLB1', variation_id: 10, custo_unitario: 1 },
      ],
    ));
    expect(r.find((x) => x.id === 'a')?.custo_congelado).toBe(1);
    expect(r.find((x) => x.id === 'b')?.custo_congelado).toBe(2);
  });
});
