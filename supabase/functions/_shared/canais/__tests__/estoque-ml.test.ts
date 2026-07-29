import { describe, it, expect } from 'vitest';
import { montarVariacoesUpdate } from '../../ml/atualizar';

// Caracterização do comportamento que `atualizarEstoque` reusa. Se algum destes
// quebrar, `montarVariacoesUpdate` mudou e o push de estoque precisa ser revisto.
describe('push de estoque: montagem das variações', () => {
  const atuais = [
    { id: 1, seller_custom_field: 'A1', available_quantity: 5, picture_ids: ['p1'], cor: 'Azul', price: 10 },
    { id: 2, seller_custom_field: 'A2', available_quantity: 7, picture_ids: ['p2'], cor: 'Rosa', price: 10 },
    { id: 3, seller_custom_field: 'A3', available_quantity: 9, picture_ids: ['p3'], cor: 'Verde', price: 10 },
  ];

  it('reenvia TODAS as variações — o ML deleta as omitidas', () => {
    const r = montarVariacoesUpdate(atuais, [{ codigo: 'A1', estoque: 2 }], undefined, null, null, undefined, true);
    expect(r).toHaveLength(3);
    expect(r.map((v) => v.id)).toEqual([1, 2, 3]);
  });

  it('aplica o estoque novo só nos SKUs cobertos e preserva o atual nos demais', () => {
    const r = montarVariacoesUpdate(
      atuais,
      [{ codigo: 'A1', estoque: 2 }, { codigo: 'A3', estoque: 0 }],
      undefined, null, null, undefined, true,
    );
    expect(r.find((v) => v.id === 1)!.available_quantity).toBe(2);
    expect(r.find((v) => v.id === 2)!.available_quantity).toBe(7);
    expect(r.find((v) => v.id === 3)!.available_quantity).toBe(0);
  });

  it('nunca envia price nem original_price em push de estoque', () => {
    const r = montarVariacoesUpdate(atuais, [{ codigo: 'A1', estoque: 2 }], undefined, null, null, undefined, true);
    for (const v of r) {
      expect(v.price).toBeUndefined();
      expect(v.original_price).toBeUndefined();
    }
  });
});
