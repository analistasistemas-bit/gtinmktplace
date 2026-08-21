import { describe, expect, it, vi } from 'vitest';
import type { ItemAnalise, Mercado } from '../tipos.ts';
import { analisarItemViabilidade } from '../analisar-item-viabilidade.ts';

const item: ItemAnalise = {
  gtin: '7890000000001',
  nome: 'Produto de teste',
  unidade: null,
  minimo: 50,
  custo: 20,
  origem: 'nacional',
};

const concorrencia = {
  vendedores: 4,
  preco_min: 36,
  origem: 'gtin' as const,
  classe: 'alta' as const,
  product_id: 'MCO123',
  product_name: 'Produto de catálogo',
  descricao_catalogo: 'Descrição',
  ofertas: {
    vendedores: 4,
    preco_min: 36,
    preco_max: 90,
    total_ofertas: 4,
    frete_gratis: 3,
    full: 2,
    seller_ids: [1, 2, 3, 4],
    category_id: 'MLB123',
    ofertas_detalhe: [
      { item_id: 'MLB36', seller_id: 1, preco: 36, frete_gratis: true, full: true },
      { item_id: 'MLB70', seller_id: 2, preco: 70.19, frete_gratis: true, full: false },
    ],
  },
};

function dependencias(mercado: Mercado) {
  const buscarListingPrice = vi.fn(async (
    _token: string,
    _preco: number,
    _categoria: string,
    _tipo: string,
  ) => ({ sale_fee_amount: 8, sale_fee_details: { percentage_fee: 12, fixed_fee: 2 } }));
  const buscarFreteVendedor = vi.fn(async (
    _token: string,
    _vendedor: string,
    _preco: number,
    _categoria: string,
  ) => 9);
  return {
    buscarConcorrencia: vi.fn(async () => concorrencia),
    buscarVariacaoSalva: vi.fn(async () => ({ dimensoes: null, jaCadastrado: false })),
    obterToken: vi.fn(async () => 'token'),
    resolverMercado: vi.fn(async () => mercado),
    buscarListingPrice,
    buscarFreteVendedor,
  };
}

describe('analisarItemViabilidade', () => {
  it('mantém item encontrado e observado sem chamar listing ou frete quando não há relevante', async () => {
    const mercado: Mercado = {
      menor: null,
      maior: null,
      vendedores: 0,
      freteGratis: 0,
      full: 0,
      ofertas: 0,
      observado: { menor: 36, maior: 90, vendedores: 4, ofertas: 4 },
    };
    const deps = dependencias(mercado);

    const resultado = await analisarItemViabilidade({ item, contaExternaId: 'seller-1', deps });

    expect(resultado).toMatchObject({ existeNoML: true, mercado });
    expect(resultado).not.toHaveProperty('classico');
    expect(resultado).not.toHaveProperty('premium');
    expect(resultado).not.toHaveProperty('frete');
    expect(deps.buscarListingPrice).not.toHaveBeenCalled();
    expect(deps.buscarFreteVendedor).not.toHaveBeenCalled();
  });

  it('usa exclusivamente o menor relevante para duas listings e um frete', async () => {
    const mercado: Mercado = {
      menor: 70.19,
      maior: 80,
      vendedores: 2,
      freteGratis: 1,
      full: 1,
      ofertas: 2,
      observado: { menor: 36, maior: 90, vendedores: 4, ofertas: 4 },
    };
    const deps = dependencias(mercado);

    const resultado = await analisarItemViabilidade({ item, contaExternaId: 'seller-1', deps });

    expect(resultado.mercado).toMatchObject({ maior: 80, freteGratis: 1, full: 1, ofertas: 2 });
    expect(deps.buscarListingPrice).toHaveBeenCalledTimes(2);
    expect(deps.buscarListingPrice.mock.calls.map(([, preco]) => preco)).toEqual([70.19, 70.19]);
    expect(deps.buscarListingPrice.mock.calls.flat()).not.toContain(36);
    expect(deps.buscarFreteVendedor).toHaveBeenCalledExactlyOnceWith(
      'token', 'seller-1', 70.19, 'MLB123', null,
    );
    expect(deps.buscarFreteVendedor.mock.calls.flat()).not.toContain(36);
  });
});
