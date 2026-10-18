import { describe, expect, it } from 'vitest';
import { agregarStatusUP, linkPaginaUP, resumirVariacoesPorCor, vendasDoAnuncio } from '../publicados';

// 18/10: o atalho "ML" abria o permalink do 1º SKU (sem estoque → página pausada, sem as outras
// estampas). A página /up/ mostra o grupo inteiro; aponta para um SKU com estoque.
describe('linkPaginaUP', () => {
  const itens = [
    { sku: '00000045', userProductId: 'MLBU45' },
    { sku: '00000044', userProductId: 'MLBU44' },
  ];

  it('1º SKU (por código) com estoque', () => {
    expect(linkPaginaUP(itens, new Map([['00000044', 0], ['00000045', 2]])))
      .toBe('https://www.mercadolivre.com.br/up/MLBU45');
  });

  it('nenhum com estoque → 1º SKU', () => {
    expect(linkPaginaUP(itens, new Map())).toBe('https://www.mercadolivre.com.br/up/MLBU44');
  });

  it('Legacy (sem itens UP) ou sem user_product_id → null', () => {
    expect(linkPaginaUP(undefined, new Map())).toBeNull();
    expect(linkPaginaUP([{ sku: '1', userProductId: null }], new Map())).toBeNull();
  });
});

// Zaven 17/10: short UP com 32 itens (1 por SKU) aparecia "Pausado · estoque 0" porque a linha lia
// só o item de familias.ml_item_id (um SKU zerado, pausado pelo ML), com o anúncio vendendo.
describe('agregarStatusUP', () => {
  const st = (status: 'ativo' | 'pausado' | 'encerrado', estoque: number | null) =>
    ({ status, estoque, motivo: null, preco: 41.9 });

  it('qualquer filho ativo → ativo; estoque é a soma dos filhos', () => {
    const r = agregarStatusUP(st('pausado', 0), [st('pausado', 0), st('ativo', 2), st('ativo', 1)]);
    expect(r?.status).toBe('ativo');
    expect(r?.estoque).toBe(3);
    expect(r?.preco).toBe(41.9);
  });

  it('todos pausados → mantém o status do item principal', () => {
    const r = agregarStatusUP(st('pausado', 0), [st('pausado', 0), st('pausado', 0)]);
    expect(r?.status).toBe('pausado');
    expect(r?.estoque).toBe(0);
  });

  it('sem filhos lidos → devolve o principal intacto', () => {
    const p = st('pausado', 0);
    expect(agregarStatusUP(p, [])).toBe(p);
  });

  it('principal ausente na leitura mas filhos presentes → usa o 1º filho como base', () => {
    const r = agregarStatusUP(undefined, [st('ativo', 1), st('ativo', 2)]);
    expect(r?.status).toBe('ativo');
    expect(r?.estoque).toBe(3);
  });

  it('estoque desconhecido em todos os filhos → null', () => {
    expect(agregarStatusUP(st('ativo', null), [st('ativo', null)])?.estoque).toBeNull();
  });
});

// Status agregado sem vendas agregadas jogava a família UP em "Encalhados" (ativo + 0 vendas no
// SKU principal) mesmo vendendo nos outros SKUs.
describe('vendasDoAnuncio', () => {
  const porItem = { MLB1: { unidades: 0, valor: 0 }, MLB2: { unidades: 3, valor: 120 }, MLB3: { unidades: 1, valor: 40 } };

  it('UP: soma as vendas de todos os SKUs', () => {
    expect(vendasDoAnuncio(porItem, 'MLB1', ['MLB1', 'MLB2', 'MLB3'])).toEqual({ unidades: 4, valor: 160 });
  });

  it('Legacy: vendas do próprio item; sem venda → undefined', () => {
    expect(vendasDoAnuncio(porItem, 'MLB2', undefined)).toEqual({ unidades: 3, valor: 120 });
    expect(vendasDoAnuncio(porItem, 'MLB9', undefined)).toBeUndefined();
    expect(vendasDoAnuncio(porItem, 'MLB9', ['MLB8'])).toBeUndefined();
  });
});

describe('resumirVariacoesPorCor', () => {
  it('agrupa SKUs da mesma cor e lista os tamanhos, sem repetir a cor', () => {
    const r = resumirVariacoesPorCor([
      { cor: 'Azul Claro', tamanho: 'P', codigo: '1' },
      { cor: 'Bege Cru', tamanho: 'P', codigo: '2' },
      { cor: 'Azul Claro', tamanho: 'M', codigo: '3' },
      { cor: 'Bege Cru', tamanho: 'M', codigo: '4' },
    ]);
    expect(r).toBe('Azul Claro (P, M) · Bege Cru (P, M)');
  });

  it('sem tamanho → só a cor; sem cor → código', () => {
    expect(resumirVariacoesPorCor([
      { cor: 'Preto', tamanho: null, codigo: '1' },
      { cor: '', tamanho: null, codigo: '0099' },
    ])).toBe('Preto · 0099');
  });
});
