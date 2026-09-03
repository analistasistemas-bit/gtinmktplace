import { describe, expect, it } from 'vitest';
import { resumirEstoque } from '../produtos-saldo-resumo';
import type { ProdutoComSaldo, VariacaoComSaldo } from '../produtos-saldo';

function v(over: Partial<VariacaoComSaldo> = {}): VariacaoComSaldo {
  return {
    codigo: '1', nome: null, cor: null, gtin: null, estoque: 10, custo: 5, preco: 20,
    pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null, imagemPath: null, mlPictureId: null, mlItemId: null,
    kits: [],
    ...over,
  };
}

function p(variacoes: VariacaoComSaldo[], codigoPai = 'A'): ProdutoComSaldo {
  return {
    codigoPai, nomePai: 'Produto', descricaoPai: null, variacoes,
    saldoTotal: variacoes.reduce((s, x) => s + x.estoque, 0),
    capaStoragePath: null, capaMlPictureId: null, fornecedor: null, unidade: null, origem: 'nacional',
    mlItemId: null, criadoEm: '2026-01-01T00:00:00Z',
  };
}

describe('resumirEstoque', () => {
  it('soma SKUs, unidades e valor pelo custo de cada variação', () => {
    const r = resumirEstoque([p([v({ estoque: 10, custo: 5 }), v({ codigo: '2', estoque: 3, custo: 2 })])]);
    expect(r).toMatchObject({ produtos: 1, skus: 2, unidades: 13, valorEmEstoque: 56, skusSemCusto: 0 });
  });

  // Caminho financeiro: custo ausente NÃO pode virar zero silencioso na soma — fica de fora e
  // é contado, para a UI avisar que o valor está subnotificado.
  it('SKU com saldo e sem custo fica fora do valor e é contado em skusSemCusto', () => {
    const r = resumirEstoque([p([v({ estoque: 10, custo: 5 }), v({ codigo: '2', estoque: 4, custo: null })])]);
    expect(r.valorEmEstoque).toBe(50);
    expect(r.skusSemCusto).toBe(1);
    expect(r.unidades).toBe(14);
  });

  it('SKU sem estoque conta como sem estoque e não entra em unidades nem no valor', () => {
    const r = resumirEstoque([p([v({ estoque: 0, custo: 5 }), v({ codigo: '2', estoque: 6, custo: 5 })])]);
    expect(r).toMatchObject({ skus: 2, skusSemEstoque: 1, unidades: 6, valorEmEstoque: 30 });
  });

  // Saldo negativo é bug de ledger (nunca deveria existir); somá-lo produziria valor negativo
  // e mascararia o estoque real dos outros SKUs.
  it('saldo negativo não vira unidade nem valor negativo', () => {
    const r = resumirEstoque([p([v({ estoque: -3, custo: 5 })])]);
    expect(r).toMatchObject({ unidades: 0, valorEmEstoque: 0, skusSemEstoque: 1, skusSemCusto: 0 });
  });

  it('lista vazia zera tudo', () => {
    expect(resumirEstoque([])).toMatchObject({ produtos: 0, skus: 0, unidades: 0, valorEmEstoque: 0 });
  });
});
