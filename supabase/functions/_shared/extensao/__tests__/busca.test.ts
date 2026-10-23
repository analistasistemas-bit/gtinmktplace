import { describe, expect, it, vi } from 'vitest';
import { analisarBusca, casarCards, categoriaDaOferta, type DepsBusca, type DepsCasamento } from '../busca.ts';
import type { VariacaoCusto } from '../vinculo.ts';

const v = (id: string): VariacaoCusto => ({ variacaoId: id, codigo: id, custo: 10, origem: 'nacional', unidades: 1, codigoPai: null, dimensoes: null });

function deps(over: Partial<DepsCasamento> = {}): DepsCasamento {
  return {
    porCatalogos: vi.fn(async () => new Map([['MLB100', [v('cat')]], ['MLB200', [v('a'), v('b')]]])),
    porGtin: vi.fn(async () => [v('gtin')]),
    vinculosManuais: vi.fn(async () => new Map([['catalogo:MLB200', v('manual-cat')], ['item:MLB9', v('manual-item')]])),
    ...over,
  };
}

describe('casarCards (Task 21): mesma prioridade do resolverVinculo, em lote e sem ML', () => {
  it('catálogo único → catálogo; catálogo ambíguo cai para o EAN da busca', async () => {
    const d = deps();
    const r = await casarCards('org', [
      { itemId: 'MLB1', catalogProductId: 'MLB100' },
      { itemId: 'MLB2', catalogProductId: 'MLB200' },
    ], '7891234567895', d);
    expect(r.get('MLB1')).toEqual({ fonte: 'catalogo', variacao: v('cat') });
    expect(r.get('MLB2')).toEqual({ fonte: 'ean_da_busca', variacao: v('gtin') });
    expect(d.porCatalogos).toHaveBeenCalledWith('org', ['MLB100', 'MLB200']);
    expect(d.porGtin).toHaveBeenCalledTimes(1);
  });

  it('sem EAN: catálogo ambíguo usa o vínculo manual do catálogo; depois o do item; senão nenhuma', async () => {
    const r = await casarCards('org', [
      { itemId: 'MLB2', catalogProductId: 'MLB200' },
      { itemId: 'MLB9', catalogProductId: null },
      { itemId: 'MLB7', catalogProductId: null },
    ], null, deps({ porGtin: vi.fn(async () => []) }));
    expect(r.get('MLB2')).toEqual({ fonte: 'vinculo_manual', variacao: v('manual-cat') });
    expect(r.get('MLB9')).toEqual({ fonte: 'vinculo_manual', variacao: v('manual-item') });
    expect(r.get('MLB7')).toEqual({ fonte: 'nenhuma', variacao: null });
  });

  it('Grok: EAN com mais de uma variação é ambíguo e não casa (igual ao resolverVinculo)', async () => {
    const r = await casarCards('org', [{ itemId: 'MLB7', catalogProductId: null }], '7891234567895',
      deps({ porGtin: vi.fn(async () => [v('x'), v('y')]), vinculosManuais: vi.fn(async () => new Map()) }));
    expect(r.get('MLB7')).toEqual({ fonte: 'nenhuma', variacao: null });
  });

  it('EAN inválido não consulta; consultas de vínculo manual pedem todas as chaves de uma vez', async () => {
    const d = deps();
    await casarCards('org', [{ itemId: 'MLB9', catalogProductId: 'MLB300' }], '123', d);
    expect(d.porGtin).not.toHaveBeenCalled();
    expect(d.vinculosManuais).toHaveBeenCalledWith('org', [{ tipo: 'catalogo', valor: 'MLB300' }, { tipo: 'item', valor: 'MLB9' }]);
  });
});

describe('categoriaDaOferta', () => {
  it('só a oferta exata do item; nunca a maioria nem outra oferta', () => {
    const itens = { results: [{ item_id: 'MLB1', category_id: 'MLB5' }, { item_id: 'MLB2', category_id: 'MLB6' }, { item_id: 'MLB3', category_id: 'MLB6' }] };
    expect(categoriaDaOferta(itens, 'MLB1')).toBe('MLB5');
    expect(categoriaDaOferta(itens, 'MLB9')).toBeNull();
    expect(categoriaDaOferta({ results: [{ item_id: 'MLB1', category_id: 'x' }] }, 'MLB1')).toBeNull();
    expect(categoriaDaOferta(null, 'MLB1')).toBeNull();
  });
});

describe('analisarBusca (Task 21)', () => {
  const margem = { preco: 100, classico: { estado: 'ok', valor: { margemPct: 12 } }, premium: { estado: 'ok', valor: { margemPct: 8 } } };
  function depsBusca(over: Partial<DepsBusca> = {}): DepsBusca {
    let saldo = 2;
    return {
      ...deps(),
      ofertasDoCatalogo: vi.fn(async () => ({ results: [{ item_id: 'MLB1', category_id: 'MLB5' }, { item_id: 'MLB3', category_id: 'MLB5' }, { item_id: 'MLB4', category_id: 'MLB5' }] })),
      reservar: vi.fn(async () => saldo-- > 0),
      analisar: vi.fn(async () => ({ margem, custo: { fonte: 'catalogo' } }) as never),
      ...over,
    };
  }
  const itens = [
    { itemId: 'MLB1', catalogProductId: 'MLB100', preco: 100 },
    { itemId: 'MLB7', catalogProductId: null, preco: 50 },
    { itemId: 'MLB9', catalogProductId: null, preco: 60 },
  ];

  it('sem vínculo não vai ao ML nem consome cota; casado sem catálogo = sem categoria; casado com catálogo é analisado', async () => {
    const d = depsBusca({ porGtin: vi.fn(async () => []) });
    const r = await analisarBusca('org', { eanDaBusca: null, itens }, d);
    expect(r.itens.map((i) => [i.itemId, i.estado])).toEqual([['MLB1', 'ok'], ['MLB7', 'sem_vinculo'], ['MLB9', 'sem_categoria']]);
    expect(d.reservar).toHaveBeenCalledTimes(1);
    expect(d.ofertasDoCatalogo).toHaveBeenCalledTimes(1);
    expect(d.analisar).toHaveBeenCalledWith(expect.objectContaining({ mlItemId: 'MLB1', categoriaId: 'MLB5', preco: 100, catalogProductId: 'MLB100' }), expect.anything());
    expect(r.itens[0]).toMatchObject({ estado: 'ok', fonte: 'catalogo', codigo: 'cat', margem });
  });

  it('cota esgotada: os seguintes (na ordem da busca) voltam como limite, sem chamada ao ML', async () => {
    const muitos = [
      { itemId: 'MLB1', catalogProductId: 'MLB100', preco: 100 },
      { itemId: 'MLB3', catalogProductId: 'MLB100', preco: 101 },
      { itemId: 'MLB4', catalogProductId: 'MLB100', preco: 102 },
    ];
    const d = depsBusca();
    const r = await analisarBusca('org', { eanDaBusca: null, itens: muitos }, d);
    expect(r.itens.map((i) => i.estado)).toEqual(['ok', 'ok', 'limite']);
    expect(d.analisar).toHaveBeenCalledTimes(2);
    expect(r.limiteAtingido).toBe(true);
  });

  it('oferta do item fora da ficha (ou falha ao ler): sem categoria, nunca chuta', async () => {
    const d = depsBusca({ ofertasDoCatalogo: vi.fn(async () => null) });
    const r = await analisarBusca('org', { eanDaBusca: null, itens: [itens[0]] }, d);
    expect(r.itens[0].estado).toBe('sem_categoria');
    expect(d.analisar).not.toHaveBeenCalled();
  });

  it('Grok: cota esgotada já de saída: nenhuma leitura de ofertas no ML', async () => {
    const d = depsBusca({ reservar: vi.fn(async () => false) });
    const r = await analisarBusca('org', { eanDaBusca: null, itens: [itens[0]] }, d);
    expect(r.itens[0].estado).toBe('limite');
    expect(d.ofertasDoCatalogo).not.toHaveBeenCalled();
  });

  it('Grok: a análise recebe exatamente o casamento do card (rótulo e margem do mesmo SKU)', async () => {
    const d = depsBusca();
    await analisarBusca('org', { eanDaBusca: null, itens: [itens[0]] }, d);
    expect(d.analisar).toHaveBeenCalledWith(expect.anything(), { fonte: 'catalogo', variacao: v('cat') });
  });

  it('falha na análise de um item não derruba os outros', async () => {
    const d = depsBusca({ analisar: vi.fn(async () => { throw new Error('ml'); }) });
    const r = await analisarBusca('org', { eanDaBusca: null, itens: [itens[0]] }, d);
    expect(r.itens[0]).toMatchObject({ estado: 'indisponivel', motivo: 'falha ao consultar o Mercado Livre' });
  });
});
