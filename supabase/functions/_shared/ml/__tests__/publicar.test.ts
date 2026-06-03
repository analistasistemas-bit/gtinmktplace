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
  it('pictures do item incluem capa + foto de cada cor', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId);
    const ids = p.pictures.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['CAPA1', 'PIC1', 'PIC2']));
  });
  it('cor com GTIN inválido/nulo marca o atributo de "sem código universal"', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId);
    const verde = p.variations[1];
    expect(JSON.stringify(verde)).toMatch(/GTIN|código|EMPTY/i);
  });
});
