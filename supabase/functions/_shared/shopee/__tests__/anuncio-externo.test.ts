import { describe, it, expect } from 'vitest';
import { montarAnuncioExternoShopee, fotoCacheada } from '../anuncio-externo';

describe('montarAnuncioExternoShopee', () => {
  it('monta a row de publicando (sem item ainda) com canal shopee', () => {
    const row = montarAnuncioExternoShopee({
      user_id: 'u1', codigo_pai: 'PAI1', status: 'publicando',
      metadados: { shop_id: '777', fotos: {} },
    });
    expect(row.canal).toBe('shopee');
    expect(row.codigo_pai).toBe('PAI1');
    expect(row.status).toBe('publicando');
    expect(row.item_externo_id).toBeNull();
    expect(row.variacoes_externas).toEqual({});
    expect(row.metadados_canal.shop_id).toBe('777');
  });

  it('mapeia variacoesExternas (sku → { variation_id }) e dados de sucesso', () => {
    const row = montarAnuncioExternoShopee({
      user_id: 'u1', codigo_pai: 'PAI1', status: 'publicado',
      itemExternoId: '12345', permalink: 'https://shopee.com/x',
      variacoesExternas: { COD1: '12345' },
      metadados: { shop_id: '777' }, publicadoEm: '2026-06-15T00:00:00.000Z',
    });
    expect(row.item_externo_id).toBe('12345');
    expect(row.permalink).toBe('https://shopee.com/x');
    expect(row.variacoes_externas).toEqual({ COD1: { variation_id: '12345' } });
    expect(row.publicado_em).toBe('2026-06-15T00:00:00.000Z');
    expect(row.erro_mensagem).toBeNull();
  });

  it('carrega erro_mensagem no status erro', () => {
    const row = montarAnuncioExternoShopee({
      user_id: 'u1', codigo_pai: 'PAI1', status: 'erro',
      erroMensagem: 'Categoria Shopee não definida', metadados: {},
    });
    expect(row.status).toBe('erro');
    expect(row.erro_mensagem).toBe('Categoria Shopee não definida');
  });
});

describe('fotoCacheada', () => {
  it('retorna o image_id quando cacheado', () => {
    expect(fotoCacheada({ fotos: { capa: 'img1', COD1: 'img2' } }, 'capa')).toBe('img1');
    expect(fotoCacheada({ fotos: { capa: 'img1', COD1: 'img2' } }, 'COD1')).toBe('img2');
  });
  it('retorna undefined quando ausente', () => {
    expect(fotoCacheada({ fotos: {} }, 'capa')).toBeUndefined();
    expect(fotoCacheada({}, 'capa')).toBeUndefined();
  });
});
