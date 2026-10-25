import { describe, expect, it } from 'vitest';
import { nomeSku } from '../nome-sku.ts';
import { nomeSku as nomeSkuTela } from '../../../../../../src/lib/vendas-sku';

type L = { codigo: string; titulo: string | null; nomeFamilia: string | null };

describe('nomeSku (paridade com a tela Vendas SKU)', () => {
  it.each<[string, L]>([
    ['título só cor + família', { codigo: '001', titulo: 'PRETO', nomeFamilia: 'SHAMPOO HAIR FLY' }],
    ['título contém a família', { codigo: '002', titulo: 'SHAMPOO HAIR FLY PRETO', nomeFamilia: 'SHAMPOO HAIR FLY' }],
    ['família palavra parcial', { codigo: '003', titulo: 'Tapete Sala', nomeFamilia: 'PET' }],
    ['título nulo com família', { codigo: '004', titulo: null, nomeFamilia: 'SHAMPOO HAIR FLY' }],
    ['título e família nulos', { codigo: '005', titulo: null, nomeFamilia: null }],
    ['siglas e números', { codigo: '006', titulo: 'KIT 2 UN FPS 60', nomeFamilia: 'PROTETOR LED' }],
  ])('%s', (_n, l) => {
    expect(nomeSku(l)).toBe(nomeSkuTela(l));
  });
});
