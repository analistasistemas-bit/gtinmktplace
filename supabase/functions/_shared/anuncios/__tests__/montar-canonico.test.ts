import { describe, expect, it, beforeEach } from 'vitest';
import { montarAnuncioCanonico, type FamiliaParaMontar, type VariacaoParaMontar } from '../montar-canonico';
import { fakeConnector } from '../../canais/fake';

// Simula o SupabaseClient admin usado por montarAnuncioCanonico: signed URL de storage +
// updates de persistência de picture_id (best-effort, resultado não é verificado aqui).
function fakeAdmin() {
  return {
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed/${path}` }, error: null }),
      }),
    },
    from: (_tabela: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        update: () => chain,
        maybeSingle: async () => ({ data: null }),
        then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return chain;
    },
  } as any;
}

const FAMILIA: FamiliaParaMontar = {
  id: 'fam-1',
  user_id: 'user-1',
  titulo_ml: 'Camisa Polo Azul',
  descricao_ml: 'Descrição de teste',
  categoria_ml_id: 'MLB123',
  atributos_ml: [{ id: 'BRAND', value_name: 'Avil' }],
  capa_storage_path: 'capas/00001.jpg',
  capa_ml_picture_id: null,
  capa2_storage_path: 'capas/00001-2.jpg',
  capa2_ml_picture_id: null,
  capa3_storage_path: 'capas/00001-3.jpg',
  capa3_ml_picture_id: null,
  variacao_principal_codigo: 'V2',
  exibir_com_desconto: false,
  desconto_pct: null,
};

// familia real traz cores excluídas junto — a query do caller (publish-familia-ml /
// publicar-anuncio) filtra `excluida_da_publicacao=false` ANTES de chamar o builder.
const TODAS_VARIACOES: Array<VariacaoParaMontar & { excluida_da_publicacao: boolean }> = [
  { id: 'v1', codigo: 'V1', cor: 'Azul', estoque: 10, preco_publicacao: 49.9, gtin: '789', imagem_path: 'v1.jpg', ml_picture_id: null, altura_cm: 5, largura_cm: 10, comprimento_cm: 15, peso_gramas: 200, excluida_da_publicacao: false },
  { id: 'v2', codigo: 'V2', cor: 'Verde', estoque: 5, preco_publicacao: 49.9, gtin: '790', imagem_path: 'v2.jpg', ml_picture_id: 'ML-PIC-2', altura_cm: 6, largura_cm: 11, comprimento_cm: 16, peso_gramas: 210, excluida_da_publicacao: false },
  { id: 'v3', codigo: 'V3', cor: 'Preto', estoque: 3, preco_publicacao: 49.9, gtin: '791', imagem_path: 'v3.jpg', ml_picture_id: null, altura_cm: 5, largura_cm: 10, comprimento_cm: 15, peso_gramas: 200, excluida_da_publicacao: true },
];

describe('montarAnuncioCanonico', () => {
  beforeEach(() => fakeConnector.reset());

  it('monta título/descrição/categoria/atributos e variações excluindo excluida_da_publicacao', async () => {
    const incluidas = TODAS_VARIACOES.filter((v) => !v.excluida_da_publicacao);
    const anuncio = await montarAnuncioCanonico(
      fakeAdmin(), fakeConnector, { getToken: async () => 'token' }, FAMILIA, incluidas,
    );

    expect(anuncio.titulo).toBe('Camisa Polo Azul');
    expect(anuncio.descricao).toBe('Descrição de teste');
    expect(anuncio.categoriaId).toBe('MLB123');
    expect(anuncio.atributos).toEqual([{ id: 'BRAND', value_name: 'Avil' }]);
    expect(anuncio.variacoes).toHaveLength(2);
    expect(anuncio.variacoes.map((v) => v.sku).sort()).toEqual(['V1', 'V2']);
  });

  it('sobe capa/capa2/capa3 na ordem 1/2/3 (picture_ids sequenciais do conector)', async () => {
    const incluidas = TODAS_VARIACOES.filter((v) => !v.excluida_da_publicacao);
    const anuncio = await montarAnuncioCanonico(
      fakeAdmin(), fakeConnector, { getToken: async () => 'token' }, FAMILIA, incluidas,
    );

    expect(anuncio.capaFotoId).toBe('FAKE-FOTO-0');
    expect(anuncio.capa2FotoId).toBe('FAKE-FOTO-1');
    expect(anuncio.capa3FotoId).toBe('FAKE-FOTO-2');
  });

  it('reusa picture_id já persistido (idempotente) — não sobe foto de novo', async () => {
    const comCapaJaSubida: FamiliaParaMontar = { ...FAMILIA, capa_ml_picture_id: 'ML-CAPA-JA' };
    const incluidas = TODAS_VARIACOES.filter((v) => !v.excluida_da_publicacao);
    const anuncio = await montarAnuncioCanonico(
      fakeAdmin(), fakeConnector, { getToken: async () => 'token' }, comCapaJaSubida, incluidas,
    );

    expect(anuncio.capaFotoId).toBe('ML-CAPA-JA');
    // variação V2 já tinha ml_picture_id — não deve gerar upload novo para ela.
    const uploadsDeFoto = fakeConnector.chamadas.filter((c) => c.metodo === 'subirFoto');
    expect(uploadsDeFoto.some((c) => (c.args as { sourceUrl: string }).sourceUrl.includes('v2.jpg'))).toBe(false);
  });

  it('ordena a variação principal primeiro', async () => {
    const incluidas = TODAS_VARIACOES.filter((v) => !v.excluida_da_publicacao);
    const anuncio = await montarAnuncioCanonico(
      fakeAdmin(), fakeConnector, { getToken: async () => 'token' }, FAMILIA, incluidas,
    );
    expect(anuncio.variacoes[0].sku).toBe('V2'); // variacao_principal_codigo
  });

  it('propaga listingTypeId (era fechado sobre job.listing_type_id no worker ML)', async () => {
    const incluidas = TODAS_VARIACOES.filter((v) => !v.excluida_da_publicacao);
    const anuncio = await montarAnuncioCanonico(
      fakeAdmin(), fakeConnector, { getToken: async () => 'token' }, FAMILIA, incluidas, 'gold_pro',
    );
    expect(anuncio.listingTypeId).toBe('gold_pro');
  });
});
