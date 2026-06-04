import { describe, it, expect } from 'vitest';
import { montarPayloadItem } from '../publicar';

const familia = {
  titulo_ml: 'Linha XIK 120 Várias Cores',
  descricao_ml: 'Descrição...',
  categoria_ml_id: 'MLB270273',
  atributos_ml: [{ id: 'BRAND', value_name: 'Avil' }, { id: 'MODEL', value_name: 'XIK 120' }],
};
const variacoes = [
  { codigo: '00000101', cor: 'Azul', estoque: 5, preco_publicacao: 9.9, gtin: '7891234567890', ml_picture_id: 'PIC1' },
  { codigo: '00000102', cor: 'Verde', estoque: 0, preco_publicacao: 9.9, gtin: null, ml_picture_id: 'PIC2' },
];
const capaPictureId = 'CAPA1';

describe('montarPayloadItem', () => {
  it('inclui título, categoria e atributos do pai', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId);
    expect(p.title).toBe('Linha XIK 120 Várias Cores');
    expect(p.category_id).toBe('MLB270273');
    expect(p.attributes).toEqual(expect.arrayContaining([{ id: 'BRAND', value_name: 'Avil' }]));
  });
  it('listing_type_id default é Clássico (gold_special)', () => {
    expect(montarPayloadItem(familia, variacoes, capaPictureId).listing_type_id).toBe('gold_special');
  });
  it('usa o listing_type_id informado (ex.: Premium gold_pro)', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId, 'gold_pro');
    expect(p.listing_type_id).toBe('gold_pro');
  });
  it('cria uma variação por cor com cor, estoque, preço e picture_ids', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId);
    expect(p.variations).toHaveLength(2);
    const azul = p.variations[0];
    expect(azul.available_quantity).toBe(5);
    expect(azul.price).toBe(9.9);
    expect(azul.picture_ids).toContain('PIC1');
    expect(azul.attribute_combinations).toEqual(
      expect.arrayContaining([{ id: 'COLOR', value_name: 'Azul' }]),
    );
  });
  it('a capa entra como 1ª foto de cada variação (vira a principal com variações)', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId);
    expect(p.variations[0].picture_ids[0]).toBe('CAPA1');
    expect(p.variations[0].picture_ids).toContain('PIC1');
    expect(p.variations[1].picture_ids[0]).toBe('CAPA1');
  });
  it('sem capa, a variação usa só a própria foto', () => {
    const p = montarPayloadItem(familia, variacoes, null);
    expect(p.variations[0].picture_ids).toEqual(['PIC1']);
  });
  it('pictures do item incluem capa + foto de cada cor', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId);
    const ids = p.pictures.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['CAPA1', 'PIC1', 'PIC2']));
  });
  it('cor com GTIN EAN válido envia atributo GTIN com value_name', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId);
    expect(p.variations[0].attributes).toEqual([{ id: 'GTIN', value_name: '7891234567890' }]);
  });
  it('cor sem GTIN em categoria que aceita (linha) envia EMPTY_GTIN_REASON "sem código cadastrado"', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId);
    expect(p.variations[1].attributes).toEqual([{ id: 'EMPTY_GTIN_REASON', value_id: '17055160' }]);
  });
  it('GTIN interno 3000* é tratado como sem código (EMPTY_GTIN_REASON)', () => {
    const p = montarPayloadItem(familia, [{ ...variacoes[0], gtin: '30001234' }], capaPictureId);
    expect(p.variations[0].attributes).toEqual([{ id: 'EMPTY_GTIN_REASON', value_id: '17055160' }]);
  });
  it('GTIN preenchido porém malformado vai como GTIN literal (ML valida), nunca como "sem código"', () => {
    const p = montarPayloadItem(familia, [{ ...variacoes[0], gtin: '123' }], capaPictureId);
    expect(p.variations[0].attributes).toEqual([{ id: 'GTIN', value_name: '123' }]);
  });
  it('cor sem GTIN em categoria sem suporte (botão MLB270272) não envia GTIN nem EMPTY_GTIN_REASON', () => {
    const botao = { ...familia, categoria_ml_id: 'MLB270272' };
    const p = montarPayloadItem(botao, [{ ...variacoes[1] }], capaPictureId);
    const ids = (p.variations[0].attributes ?? []).map((a) => a.id);
    expect(ids).not.toContain('GTIN');
    expect(ids).not.toContain('EMPTY_GTIN_REASON');
  });
});
