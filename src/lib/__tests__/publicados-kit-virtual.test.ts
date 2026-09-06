import { describe, it, expect, vi } from 'vitest';

// ADR-0154 D-2: Kit Virtual é a 3ª fonte de fetchPublicados, tabela própria (não `familias`
// nem `anuncios_externos`). A armadilha real: `codigoPai` é chave de agrupamento
// (repPorCodigo/dedupePublicados) para os produtos normais — o kit precisa nascer DEPOIS desse
// agrupamento fechar, com um `codigoPai` sentinela que nunca colide com um `codigo_pai` real.
const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mockFrom } }));

const { fetchPublicados } = await import('../queries');

function fakeChain(resultado: unknown) {
  const chain: any = {
    select: () => chain,
    not: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    then: (resolve: any) => Promise.resolve(resultado).then(resolve),
  };
  return chain;
}

const FAMILIA = {
  id: 'fam-1', codigo_pai: '02835002', variacao_principal_codigo: null,
  titulo_ml: 'LINHA PARA COSTURA', nome_pai: null, fornecedor: 'BUFALO', tipo_aviamento: null,
  categoria_nome: null, descricao_ml: null, ml_item_id: 'MLB1', ml_permalink: null,
  publicado_em: '2026-06-07', variacoes: [{ codigo: '02835002', gtin: null, preco_publicacao: 11.9, excluida_da_publicacao: false }],
};

const KIT = {
  id: 'kit-1', titulo: 'Kit Aventura: 1 Motosserra + 1 Canivete',
  ml_item_id: 'MLB-KIT1', ml_permalink: 'https://example.com/kit1', publicado_em: '2026-09-06',
};

function mockTabelas({ kits = [KIT] as unknown[] } = {}) {
  mockFrom.mockImplementation((tabela: string) => {
    if (tabela === 'familias') return fakeChain({ data: [FAMILIA], error: null });
    if (tabela === 'kits_virtuais') return fakeChain({ data: kits, error: null });
    return fakeChain({ data: [], error: null });
  });
}

describe('fetchPublicados — Kit Virtual (ADR-0154)', () => {
  it('anexa o kit como linha própria, com sentinela em codigoPai e sem colidir com o produto', async () => {
    mockTabelas();
    const itens = await fetchPublicados();

    expect(itens).toHaveLength(2);
    const produto = itens.find((i) => i.mlItemId === 'MLB1')!;
    const kit = itens.find((i) => i.mlItemId === 'MLB-KIT1')!;

    expect(produto.ehKitVirtual).toBeFalsy();
    expect(produto.codigoPai).toBe('02835002');
    expect(produto.fornecedor).toBe('BUFALO'); // produto comum intacto (não herda nada do kit)

    expect(kit.ehKitVirtual).toBe(true);
    expect(kit.kitVirtualId).toBe('kit-1');
    expect(kit.titulo).toBe('Kit Aventura: 1 Motosserra + 1 Canivete');
    expect(kit.mlPermalink).toBe('https://example.com/kit1');
    expect(kit.codigoPai).not.toBe(produto.codigoPai);
    expect(kit.codigoPai).toContain('kit-1'); // sentinela, nunca um codigo_pai real
    expect(kit.familiaId).toBe('');
    expect(kit.precoPublicacao).toBe(0);
  });

  it('sem kit nenhum: lista de produtos comuns idêntica à de antes (regressão)', async () => {
    mockTabelas({ kits: [] });
    const itens = await fetchPublicados();
    expect(itens).toHaveLength(1);
    expect(itens[0].mlItemId).toBe('MLB1');
    expect(itens[0].ehKitVirtual).toBeFalsy();
  });
});
