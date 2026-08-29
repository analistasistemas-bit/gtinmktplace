import { describe, expect, it } from 'vitest';
import { anunciosDaAmostra } from '../amostra-sonar.ts';
import type { ItemVendas } from '../../pulse/sonar-vendas.ts';

const item = (over: Partial<ItemVendas>): ItemVendas => ({
  titulo: 'Produto',
  preco: 10,
  vendidos: 100,
  link: null,
  imagem: null,
  vendedor: null,
  seller_id: null,
  frete_gratis: null,
  loja_oficial: null,
  internacional: null,
  full: null,
  item_id: 'MLB1',
  catalog_product_id: null,
  avaliacao_nota: null,
  avaliacao_qtd: null,
  posicao: null,
  patrocinado: null,
  selo: null,
  preco_anterior: null,
  desconto_pct: null,
  flex: null,
  category_id: null,
  ...over,
});

describe('anunciosDaAmostra', () => {
  it('usa seller_id do ItemVendas quando presente', () => {
    const { anuncios, semSellerId } = anunciosDaAmostra([
      item({ item_id: 'MLB1', seller_id: 42 }),
    ]);
    expect(anuncios).toEqual([{
      item_id: 'MLB1',
      seller_id: 42,
      preco: 10,
      vendidos: 100,
    }]);
    expect(semSellerId).toBe(0);
  });

  it('cai para sellerPorItem quando ItemVendas.seller_id é null', () => {
    const map = new Map([['MLB2', 99]]);
    const { anuncios, semSellerId } = anunciosDaAmostra([
      item({ item_id: 'MLB2', seller_id: null }),
    ], map);
    expect(anuncios[0].seller_id).toBe(99);
    expect(semSellerId).toBe(0);
  });

  it('pula item sem item_id ou seller_id e conta semSellerId', () => {
    const { anuncios, semSellerId } = anunciosDaAmostra([
      item({ item_id: null, seller_id: 1 }),
      item({ item_id: 'MLB3', seller_id: null }),
      item({ item_id: 'MLB4', seller_id: 7 }),
    ]);
    expect(anuncios).toHaveLength(1);
    expect(anuncios[0].item_id).toBe('MLB4');
    expect(semSellerId).toBe(1);
  });
});
