import { describe, expect, it } from 'vitest';
import { montarOfertasEan, montarRespostaEan, validarEan } from '../sonar-ean.ts';
import type { OfertaVendedor } from '../../concorrencia/tipos.ts';
import type { ItemVendas } from '../sonar-vendas.ts';

const oferta = (over: Partial<OfertaVendedor> = {}): OfertaVendedor => ({
  item_id: 'MLB1', seller_id: 111, preco: 100, frete_gratis: true, full: false, ...over,
});

const itemApify = (over: Partial<ItemVendas> = {}): ItemVendas => ({
  titulo: 't', preco: null, vendidos: null, link: null, imagem: null, vendedor: null,
  frete_gratis: null, loja_oficial: null, internacional: null, full: null, item_id: null,
  catalog_product_id: null, avaliacao_nota: null, avaliacao_qtd: null, posicao: null,
  patrocinado: null, selo: null, preco_anterior: null, desconto_pct: null, flex: null,
  category_id: null, ...over,
});

describe('validarEan', () => {
  it('8 a 14 dígitos passam', () => {
    expect(validarEan('12345678')).toBe('12345678');
    expect(validarEan('12345678901234')).toBe('12345678901234');
  });
  it('trim de espaços', () => {
    expect(validarEan('  12345678  ')).toBe('12345678');
  });
  it('fora da faixa ou não-dígito → null', () => {
    expect(validarEan('1234567')).toBeNull(); // 7 dígitos
    expect(validarEan('123456789012345')).toBeNull(); // 15 dígitos
    expect(validarEan('1234567a')).toBeNull();
    expect(validarEan(null)).toBeNull();
    expect(validarEan(undefined)).toBeNull();
    expect(validarEan(12345678)).toBeNull();
  });
});

describe('montarOfertasEan (interseção por item_id)', () => {
  it('item Apify que casa com a lookup oficial traz vendidos', () => {
    const oficiais = [oferta({ item_id: 'MLB1' })];
    const apify = [itemApify({ item_id: 'MLB1', vendidos: 500 })];
    expect(montarOfertasEan(oficiais, apify)).toEqual([
      {
        item_id: 'MLB1', seller_id: 111, vendedor_nome: null, preco: 100,
        frete_gratis: true, full: false, vendidos: 500,
      },
    ]);
  });

  it('item Apify que NÃO está na lookup oficial é descartado (produto vizinho)', () => {
    const oficiais = [oferta({ item_id: 'MLB1' })];
    const apify = [itemApify({ item_id: 'MLB1', vendidos: 500 }), itemApify({ item_id: 'MLB-VIZINHO', vendidos: 999 })];
    const out = montarOfertasEan(oficiais, apify);
    expect(out).toHaveLength(1);
    expect(out[0].item_id).toBe('MLB1');
  });

  it('item oficial sem match na amostra Apify fica com vendidos:null (não 0)', () => {
    const oficiais = [oferta({ item_id: 'MLB1' }), oferta({ item_id: 'MLB2', seller_id: 222 })];
    const apify = [itemApify({ item_id: 'MLB1', vendidos: 50 })];
    const out = montarOfertasEan(oficiais, apify);
    expect(out.find((o) => o.item_id === 'MLB2')?.vendidos).toBeNull();
  });

  it('itensApify null (grátis ou indisponível) → todos vendidos:null', () => {
    const oficiais = [oferta({ item_id: 'MLB1' }), oferta({ item_id: 'MLB2' })];
    const out = montarOfertasEan(oficiais, null);
    expect(out.every((o) => o.vendidos === null)).toBe(true);
  });

  it('oferta oficial sem item_id nunca casa (fica null)', () => {
    const oficiais = [oferta({ item_id: null })];
    const apify = [itemApify({ item_id: null, vendidos: 10 })];
    expect(montarOfertasEan(oficiais, apify)[0].vendidos).toBeNull();
  });
});

describe('montarRespostaEan', () => {
  it('monta o shape completo, sem vendas_indisponivel quando não pedido', () => {
    const resp = montarRespostaEan({
      ean: '7891234567890', productId: 'MLB123', nomeProduto: 'Produto X',
      descricaoCatalogo: 'desc', categoriaMlId: 'MLB1234', nomesVendedores: { '111': 'LOJA X' },
      comVendas: false, vendasIndisponivel: false,
      ofertasOficiais: [oferta({ item_id: 'MLB1' })], itensApify: null, geradoEm: '2026-08-22T00:00:00.000Z',
    });
    expect(resp).toEqual({
      conectado: true, catalogado: true, ean: '7891234567890', product_id: 'MLB123',
      nome_produto: 'Produto X', descricao_catalogo: 'desc', categoria_ml_id: 'MLB1234',
      com_vendas: false,
      ofertas: [{
        item_id: 'MLB1', seller_id: 111, vendedor_nome: 'LOJA X', preco: 100,
        frete_gratis: true, full: false, vendidos: null,
      }],
      gerado_em: '2026-08-22T00:00:00.000Z',
    });
    expect(resp).not.toHaveProperty('vendas_indisponivel');
  });

  it('inclui vendas_indisponivel:true quando pedido mas não calculado', () => {
    const resp = montarRespostaEan({
      ean: '7891234567890', productId: 'MLB123', nomeProduto: null, descricaoCatalogo: null,
      categoriaMlId: null, nomesVendedores: {},
      comVendas: false, vendasIndisponivel: true, ofertasOficiais: [], itensApify: null,
      geradoEm: '2026-08-22T00:00:00.000Z',
    });
    expect(resp.vendas_indisponivel).toBe(true);
    expect(resp.com_vendas).toBe(false);
  });

  it('nome do vendedor entra por seller_id; vendedor sem perfil fica null', () => {
    const resp = montarRespostaEan({
      ean: '7891234567890', productId: 'MLB123', nomeProduto: null, descricaoCatalogo: null,
      categoriaMlId: 'MLB1234', nomesVendedores: { '111': 'LOJA X' },
      comVendas: false, vendasIndisponivel: false,
      ofertasOficiais: [oferta({ item_id: 'MLB1' }), oferta({ item_id: 'MLB2', seller_id: 222 })],
      itensApify: null, geradoEm: '2026-08-22T00:00:00.000Z',
    });
    expect(resp.ofertas[0].vendedor_nome).toBe('LOJA X');
    expect(resp.ofertas[1].vendedor_nome).toBeNull();
  });
});
