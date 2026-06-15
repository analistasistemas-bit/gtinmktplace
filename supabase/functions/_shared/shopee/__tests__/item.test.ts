import { describe, it, expect } from 'vitest';
import { montarPayloadAddItem } from '../item';
import type { AnuncioCanonico } from '../../canais/contrato';

const base: AnuncioCanonico = {
  titulo: 'Linha de Costura 100m Azul',
  descricao: 'Linha resistente para costura geral.',
  categoriaId: '100182',
  atributos: [],
  capaFotoId: 'img_capa',
  capa2FotoId: 'img_capa2',
  capa3FotoId: null,
  desconto: null,
  dimensoes: { altura_cm: 4, largura_cm: 5, comprimento_cm: 6, peso_gramas: 250 },
  variacoes: [
    { sku: 'COD123', cor: 'Azul', estoque: 30, preco: 12.9, gtin: '789000', fotoId: 'img_var' },
  ],
};

describe('montarPayloadAddItem', () => {
  it('converte peso_gramas para kg (/1000)', () => {
    const p = montarPayloadAddItem(base, '209920');
    expect(p.weight).toBe(0.25);
  });

  it('mapeia item_sku ← sku da variação', () => {
    expect(montarPayloadAddItem(base, '209920').item_sku).toBe('COD123');
  });

  it('embute a descrição (descricaoSeparada:false)', () => {
    const p = montarPayloadAddItem(base, '209920');
    expect(p.description).toBe('Linha resistente para costura geral.');
  });

  it('preço, estoque e categoria mapeados', () => {
    const p = montarPayloadAddItem(base, '209920');
    expect(p.original_price).toBe(12.9);
    expect(p.normal_stock).toBe(30);
    expect(p.seller_stock).toEqual([{ stock: 30 }]);
    expect(p.category_id).toBe(100182);
    expect(p.item_name).toBe('Linha de Costura 100m Azul');
  });

  it('dimension a partir de cm', () => {
    const p = montarPayloadAddItem(base, '209920');
    expect(p.dimension).toEqual({ package_length: 6, package_width: 5, package_height: 4 });
  });

  it('image_id_list reúne capas + foto da variação (sem nulos)', () => {
    const p = montarPayloadAddItem(base, '209920');
    expect(p.image.image_id_list).toEqual(['img_capa', 'img_capa2', 'img_var']);
  });

  it('logistic_info placeholder vazio na Fatia 1', () => {
    expect(montarPayloadAddItem(base, '209920').logistic_info).toEqual([]);
  });

  it('lança se não houver variação', () => {
    expect(() => montarPayloadAddItem({ ...base, variacoes: [] }, '209920')).toThrow(/variação/i);
  });

  it('1 variação: gera exatamente 1 seller_stock', () => {
    expect(montarPayloadAddItem(base, '209920').seller_stock).toHaveLength(1);
  });
});
