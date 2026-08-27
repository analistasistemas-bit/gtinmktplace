import { describe, expect, it } from 'vitest';
import { montarOfertasEan, montarRespostaEan, validarEan } from '../sonar-ean.ts';
import type { FichaEan } from '../sonar-ean.ts';
import type { OfertaVendedor } from '../../concorrencia/tipos.ts';
import type { ItemVendas } from '../sonar-vendas.ts';

const oferta = (over: Partial<OfertaVendedor> = {}): OfertaVendedor => ({
  item_id: 'MLB1', seller_id: 111, preco: 100, frete_gratis: true, full: false, ...over,
});

const ficha = (over: Partial<FichaEan> = {}): FichaEan => ({
  product_id: 'MLB123', nome: 'Produto X', ofertas: [oferta()], ...over,
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

describe('montarOfertasEan (interseção por item_id + união de fichas)', () => {
  it('item Apify que casa com a lookup oficial traz vendidos', () => {
    const fichas = [ficha({ ofertas: [oferta({ item_id: 'MLB1' })] })];
    const apify = [itemApify({ item_id: 'MLB1', vendidos: 500 })];
    expect(montarOfertasEan(fichas, apify)).toEqual([
      {
        item_id: 'MLB1', seller_id: 111, vendedor_nome: null, preco: 100,
        frete_gratis: true, full: false, vendidos: 500,
        product_id: 'MLB123', produto_nome: 'Produto X',
      },
    ]);
  });

  it('item Apify que NÃO está na lookup oficial é descartado (produto vizinho)', () => {
    const fichas = [ficha({ ofertas: [oferta({ item_id: 'MLB1' })] })];
    const apify = [itemApify({ item_id: 'MLB1', vendidos: 500 }), itemApify({ item_id: 'MLB-VIZINHO', vendidos: 999 })];
    const out = montarOfertasEan(fichas, apify);
    expect(out).toHaveLength(1);
    expect(out[0].item_id).toBe('MLB1');
  });

  it('item oficial sem match na amostra Apify fica com vendidos:null (não 0)', () => {
    const fichas = [ficha({ ofertas: [oferta({ item_id: 'MLB1' }), oferta({ item_id: 'MLB2', seller_id: 222 })] })];
    const apify = [itemApify({ item_id: 'MLB1', vendidos: 50 })];
    const out = montarOfertasEan(fichas, apify);
    expect(out.find((o) => o.item_id === 'MLB2')?.vendidos).toBeNull();
  });

  it('itensApify null (grátis ou indisponível) → todos vendidos:null', () => {
    const fichas = [ficha({ ofertas: [oferta({ item_id: 'MLB1' }), oferta({ item_id: 'MLB2' })] })];
    const out = montarOfertasEan(fichas, null);
    expect(out.every((o) => o.vendidos === null)).toBe(true);
  });

  it('oferta oficial sem item_id nunca casa (fica null)', () => {
    const fichas = [ficha({ ofertas: [oferta({ item_id: null })] })];
    const apify = [itemApify({ item_id: null, vendidos: 10 })];
    expect(montarOfertasEan(fichas, apify)[0].vendidos).toBeNull();
  });

  it('duas fichas: une as ofertas e anota product_id/produto_nome de origem', () => {
    const fichas = [
      ficha({ product_id: 'MLB1', nome: 'Cor A', ofertas: [oferta({ item_id: 'MLB1-A' })] }),
      ficha({ product_id: 'MLB2', nome: 'Cor B', ofertas: [oferta({ item_id: 'MLB2-A', seller_id: 222 })] }),
    ];
    const out = montarOfertasEan(fichas, null);
    expect(out).toEqual([
      expect.objectContaining({ item_id: 'MLB1-A', product_id: 'MLB1', produto_nome: 'Cor A' }),
      expect.objectContaining({ item_id: 'MLB2-A', product_id: 'MLB2', produto_nome: 'Cor B' }),
    ]);
  });

  it('item_id repetido entre fichas: dedupe, primeira ocorrência vence', () => {
    const fichas = [
      ficha({ product_id: 'MLB1', nome: 'Cor A', ofertas: [oferta({ item_id: 'MLB-DUP', seller_id: 111 })] }),
      ficha({ product_id: 'MLB2', nome: 'Cor B', ofertas: [oferta({ item_id: 'MLB-DUP', seller_id: 222 }), oferta({ item_id: 'MLB-UNICO', seller_id: 333 })] }),
    ];
    const out = montarOfertasEan(fichas, null);
    expect(out).toHaveLength(2);
    expect(out.find((o) => o.item_id === 'MLB-DUP')).toMatchObject({ product_id: 'MLB1', seller_id: 111 });
  });
});

describe('montarRespostaEan', () => {
  it('monta o shape completo (uma ficha, comportamento igual ao de hoje)', () => {
    const resp = montarRespostaEan({
      ean: '7891234567890',
      fichas: [ficha({ product_id: 'MLB123', nome: 'Produto X', ofertas: [oferta({ item_id: 'MLB1' })] })],
      fichasEncontradas: 1,
      descricaoCatalogo: 'desc', categoriaMlId: 'MLB1234', nomesVendedores: { '111': 'LOJA X' },
      comVendas: false, vendasIndisponivel: false,
      itensApify: null, geradoEm: '2026-08-22T00:00:00.000Z',
    });
    expect(resp).toEqual({
      conectado: true, catalogado: true, ean: '7891234567890', product_id: 'MLB123',
      nome_produto: 'Produto X', descricao_catalogo: 'desc', categoria_ml_id: 'MLB1234',
      com_vendas: false,
      ofertas: [{
        item_id: 'MLB1', seller_id: 111, vendedor_nome: 'LOJA X', preco: 100,
        frete_gratis: true, full: false, vendidos: null,
        product_id: 'MLB123', produto_nome: 'Produto X',
      }],
      fichas_consultadas: 1, fichas_encontradas: 1,
      fichas: [{ product_id: 'MLB123', nome: 'Produto X', ofertas: 1 }],
      gerado_em: '2026-08-22T00:00:00.000Z',
    });
    expect(resp).not.toHaveProperty('vendas_indisponivel');
  });

  it('inclui vendas_indisponivel:true quando pedido mas não calculado', () => {
    const resp = montarRespostaEan({
      ean: '7891234567890',
      fichas: [ficha({ product_id: 'MLB123', nome: null, ofertas: [] })],
      fichasEncontradas: 1,
      descricaoCatalogo: null, categoriaMlId: null, nomesVendedores: {},
      comVendas: false, vendasIndisponivel: true, itensApify: null,
      geradoEm: '2026-08-22T00:00:00.000Z',
    });
    expect(resp.vendas_indisponivel).toBe(true);
    expect(resp.com_vendas).toBe(false);
  });

  it('nome do vendedor entra por seller_id; vendedor sem perfil fica null', () => {
    const resp = montarRespostaEan({
      ean: '7891234567890',
      fichas: [ficha({
        product_id: 'MLB123', nome: null,
        ofertas: [oferta({ item_id: 'MLB1' }), oferta({ item_id: 'MLB2', seller_id: 222 })],
      })],
      fichasEncontradas: 1,
      descricaoCatalogo: null, categoriaMlId: 'MLB1234', nomesVendedores: { '111': 'LOJA X' },
      comVendas: false, vendasIndisponivel: false,
      itensApify: null, geradoEm: '2026-08-22T00:00:00.000Z',
    });
    expect(resp.ofertas[0].vendedor_nome).toBe('LOJA X');
    expect(resp.ofertas[1].vendedor_nome).toBeNull();
  });

  it('duas fichas: une ofertas e monta o resumo por ficha', () => {
    const resp = montarRespostaEan({
      ean: '7891234567890',
      fichas: [
        ficha({ product_id: 'MLB1', nome: 'Cor A', ofertas: [oferta({ item_id: 'MLB1-A' })] }),
        ficha({ product_id: 'MLB2', nome: 'Cor B', ofertas: [oferta({ item_id: 'MLB2-A', seller_id: 222 }), oferta({ item_id: 'MLB2-B', seller_id: 333 })] }),
      ],
      fichasEncontradas: 2,
      descricaoCatalogo: null, categoriaMlId: null, nomesVendedores: {},
      comVendas: false, vendasIndisponivel: false, itensApify: null,
      geradoEm: '2026-08-22T00:00:00.000Z',
    });
    expect(resp.product_id).toBe('MLB1');
    expect(resp.nome_produto).toBe('Cor A');
    expect(resp.fichas_consultadas).toBe(2);
    expect(resp.fichas_encontradas).toBe(2);
    expect(resp.ofertas).toHaveLength(3);
    expect(resp.fichas).toEqual([
      { product_id: 'MLB1', nome: 'Cor A', ofertas: 1 },
      { product_id: 'MLB2', nome: 'Cor B', ofertas: 2 },
    ]);
  });

  it('item_id repetido entre fichas: sum(fichas[].ofertas) === ofertas.length', () => {
    const resp = montarRespostaEan({
      ean: '7891234567890',
      fichas: [
        ficha({ product_id: 'MLB1', nome: 'Cor A', ofertas: [oferta({ item_id: 'MLB-DUP' })] }),
        ficha({ product_id: 'MLB2', nome: 'Cor B', ofertas: [oferta({ item_id: 'MLB-DUP', seller_id: 222 })] }),
      ],
      fichasEncontradas: 2,
      descricaoCatalogo: null, categoriaMlId: null, nomesVendedores: {},
      comVendas: false, vendasIndisponivel: false, itensApify: null,
      geradoEm: '2026-08-22T00:00:00.000Z',
    });
    expect(resp.ofertas).toHaveLength(1);
    // A ficha 2 perdeu a única oferta pro dedupe — continua no resumo, com ofertas: 0.
    expect(resp.fichas).toEqual([
      { product_id: 'MLB1', nome: 'Cor A', ofertas: 1 },
      { product_id: 'MLB2', nome: 'Cor B', ofertas: 0 },
    ]);
    const soma = resp.fichas.reduce((acc, f) => acc + f.ofertas, 0);
    expect(soma).toBe(resp.ofertas.length);
  });

  it('fichas_encontradas > fichas_consultadas (teto de 5 aplicado pelo chamador)', () => {
    const resp = montarRespostaEan({
      ean: '7891234567890',
      fichas: [ficha({ product_id: 'MLB1', nome: 'Cor A', ofertas: [oferta()] })],
      fichasEncontradas: 7,
      descricaoCatalogo: null, categoriaMlId: null, nomesVendedores: {},
      comVendas: false, vendasIndisponivel: false, itensApify: null,
      geradoEm: '2026-08-22T00:00:00.000Z',
    });
    expect(resp.fichas_consultadas).toBe(1);
    expect(resp.fichas_encontradas).toBe(7);
  });
});
