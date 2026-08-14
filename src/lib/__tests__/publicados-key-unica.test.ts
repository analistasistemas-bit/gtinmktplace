import { describe, it, expect, vi } from 'vitest';

// A tela Publicados usa mlItemId como key da linha (familiaId repete entre anúncios split,
// ADR-0048). Key duplicada deixa linhas fantasmas no DOM ao filtrar/buscar.
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
  titulo_ml: 'LINHA PARA COSTURA', nome_pai: null, fornecedor: null, tipo_aviamento: null,
  categoria_nome: null, descricao_ml: null, ml_item_id: 'MLB1', ml_permalink: null,
  publicado_em: '2026-06-07', variacoes: [{ codigo: '02835002', gtin: null, preco_publicacao: 11.9, excluida_da_publicacao: false }],
};

describe('fetchPublicados', () => {
  it('não repete mlItemId quando anuncios_externos tem linhas duplicadas do mesmo anúncio', async () => {
    const externo = {
      codigo_pai: '02835002', item_externo_id: 'MLB2', permalink: null,
      titulo: 'LINHA PARA COSTURA', publicado_em: '2026-06-07', variacoes_externas: {},
    };
    let anunciosCalls = 0;
    mockFrom.mockImplementation((tabela: string) => {
      if (tabela === 'familias') return fakeChain({ data: [FAMILIA], error: null });
      if (tabela === 'anuncios_externos_itens') return fakeChain({ data: [], error: null });
      if (tabela === 'anuncios_externos') {
        anunciosCalls += 1;
        // 1ª chamada: raízes UP para catalogRetentavel; 2ª: partições split (ADR-0048).
        if (anunciosCalls === 1) return fakeChain({ data: [], error: null });
        return fakeChain({ data: [externo, { ...externo }], error: null });
      }
      return fakeChain({ data: [], error: null });
    });

    const itens = await fetchPublicados();
    expect(itens.map((i) => i.mlItemId)).toEqual(['MLB1', 'MLB2']);
  });
});
