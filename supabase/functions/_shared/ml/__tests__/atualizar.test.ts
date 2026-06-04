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

import { montarVariacaoNova } from '../atualizar';

const corNova = {
  codigo: '00000777', cor: 'Vermelho', estoque: 9,
  preco_publicacao: 12.5, gtin: '7891234567890', ml_picture_id: 'PICNOVA',
};

describe('montarVariacaoNova', () => {
  it('monta COLOR, estoque, preço, picture_ids e seller_custom_field, sem id', () => {
    const v = montarVariacaoNova(corNova, null, 'MLB270273');
    expect(v).not.toHaveProperty('id');
    expect(v.attribute_combinations).toEqual([{ id: 'COLOR', value_name: 'Vermelho' }]);
    expect(v.available_quantity).toBe(9);
    expect(v.price).toBe(12.5);
    expect(v.picture_ids).toEqual(['PICNOVA']);
    expect(v.seller_custom_field).toBe('00000777');
  });
  it('a capa entra como 1ª foto da variação nova', () => {
    const v = montarVariacaoNova(corNova, 'CAPA1', 'MLB270273');
    expect(v.picture_ids).toEqual(['CAPA1', 'PICNOVA']);
  });
  it('GTIN EAN válido vira atributo GTIN', () => {
    const v = montarVariacaoNova(corNova, null, 'MLB270273');
    expect(v.attributes).toEqual([{ id: 'GTIN', value_name: '7891234567890' }]);
  });
  it('sem GTIN em categoria que aceita → EMPTY_GTIN_REASON', () => {
    const v = montarVariacaoNova({ ...corNova, gtin: null }, null, 'MLB270273');
    expect(v.attributes).toEqual([{ id: 'EMPTY_GTIN_REASON', value_id: '17055160' }]);
  });
  it('GTIN interno 3000* → EMPTY_GTIN_REASON', () => {
    const v = montarVariacaoNova({ ...corNova, gtin: '30009999' }, null, 'MLB270273');
    expect(v.attributes).toEqual([{ id: 'EMPTY_GTIN_REASON', value_id: '17055160' }]);
  });
  it('sem GTIN em categoria sem suporte (botão MLB270272) → sem atributo de GTIN', () => {
    const v = montarVariacaoNova({ ...corNova, gtin: null }, null, 'MLB270272');
    expect(v.attributes).toBeUndefined();
  });
});
