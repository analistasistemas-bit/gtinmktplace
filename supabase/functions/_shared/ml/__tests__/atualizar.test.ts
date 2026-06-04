import { describe, it, expect } from 'vitest';
import { montarVariacoesUpdate } from '../atualizar';

const atuais = [
  { id: 'V1', seller_custom_field: '00000101', available_quantity: 5 },
  { id: 'V2', seller_custom_field: '00000102', available_quantity: 8 },
];

describe('montarVariacoesUpdate', () => {
  it('aplica o estoque novo na variação casada por código', () => {
    const r = montarVariacoesUpdate(atuais, [{ codigo: '00000101', estoque: 12 }]);
    expect(r).toContainEqual({ id: 'V1', available_quantity: 12 });
  });
  it('preserva o estoque atual de variação sem correspondente no lote (cor removida)', () => {
    const r = montarVariacoesUpdate(atuais, [{ codigo: '00000101', estoque: 12 }]);
    expect(r).toContainEqual({ id: 'V2', available_quantity: 8 });
  });
  it('inclui TODAS as variações atuais (nunca deleta por omissão)', () => {
    const r = montarVariacoesUpdate(atuais, [{ codigo: '00000101', estoque: 12 }]);
    expect(r).toHaveLength(2);
  });
  it('nunca inclui price (preço preservado pelo ML)', () => {
    const r = montarVariacoesUpdate(atuais, [{ codigo: '00000101', estoque: 12 }]);
    for (const v of r) expect(v).not.toHaveProperty('price');
  });
  it('cor nova do lote (sem variação atual) não entra no PUT', () => {
    const r = montarVariacoesUpdate(atuais, [{ codigo: '00000999', estoque: 3 }]);
    const ids = r.map((v) => v.id);
    expect(ids).toEqual(['V1', 'V2']);
  });
  it('id numérico do ML é mantido', () => {
    const r = montarVariacoesUpdate([{ id: 123, seller_custom_field: '00000101', available_quantity: 5 }], [{ codigo: '00000101', estoque: 7 }]);
    expect(r[0]).toEqual({ id: 123, available_quantity: 7 });
  });
});
