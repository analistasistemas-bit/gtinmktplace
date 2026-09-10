// ADR-0154 Decisão 12. Vitest (não Deno test) — runner que o CI/vitest.config.ts executam.
import { describe, it, expect, vi } from 'vitest';
import {
  buscarComponentesKitVirtual, buscarTodosComponentes, enriquecerComponentes,
  chaveVariacao, escolherVariacaoPorCodigo, parsePaginaML,
  type BuscarComponentesDeps, type CandidatoBrutoML, type CatalogoLocalItem, type ItemBridge,
  type PaginaComponentesML,
} from '../processar.ts';

function candidato(p: Partial<CandidatoBrutoML> & { userProductId: string }): CandidatoBrutoML {
  return {
    title: 'Produto', type: 'available', thumbnailUrl: null, categoryName: null, estoque: null,
    reasons: [], ...p,
  };
}

describe('parsePaginaML', () => {
  it('normaliza o shape real capturado em produção (2026-09-06)', () => {
    const raw = {
      paging: { search_after_hash: 'WyJNTEJVNDA2...' },
      products: [{
        id: 'MLBU4065334874',
        title: 'Linha Para Costura 1500m 100% Poliéster Várias Cores',
        type: 'available',
        thumbnail: { secure_url: 'https://x/foto.jpg' },
        category_name: 'Fios para costura e artesanato',
        stock: { locations: [{ quantity: 193 }] },
        reasons: [],
      }],
    };
    const r = parsePaginaML(raw);
    expect(r.searchAfterHash).toEqual('WyJNTEJVNDA2...');
    expect(r.produtos).toEqual([{
      userProductId: 'MLBU4065334874',
      title: 'Linha Para Costura 1500m 100% Poliéster Várias Cores',
      type: 'available',
      thumbnailUrl: 'https://x/foto.jpg',
      categoryName: 'Fios para costura e artesanato',
      estoque: 193,
      reasons: [],
    }]);
  });

  it('preserva reasons de produto non_available e cai no motivo real observado', () => {
    const raw = {
      paging: { search_after_hash: null },
      products: [{
        id: 'MLBU111', title: 'Item multi-cor', type: 'non_available',
        reasons: [{ id: 'COMPONENT_NOT_MIGRATED_TO_UP', message: 'Não está atualizado para a nova experiência de variações e não pode ser vendido em kit.' }],
      }],
    };
    const r = parsePaginaML(raw);
    expect(r.produtos[0].type).toEqual('non_available');
    expect(r.produtos[0].reasons).toEqual([
      { id: 'COMPONENT_NOT_MIGRATED_TO_UP', message: 'Não está atualizado para a nova experiência de variações e não pode ser vendido em kit.' },
    ]);
  });

  it('soma estoque de múltiplas locations e devolve null quando ausente', () => {
    expect(parsePaginaML({ products: [{ id: 'A', stock: { locations: [{ quantity: 5 }, { quantity: 3 }] } }] }).produtos[0].estoque).toEqual(8);
    expect(parsePaginaML({ products: [{ id: 'B' }] }).produtos[0].estoque).toBeNull();
  });
});

describe('buscarTodosComponentes — paginação', () => {
  it('para quando o hash se repete (achado do spike 036: laço travou repetindo o mesmo hash)', async () => {
    const paginas: PaginaComponentesML[] = [
      { produtos: [candidato({ userProductId: 'A' })], searchAfterHash: 'hash-1' },
      { produtos: [candidato({ userProductId: 'B' })], searchAfterHash: 'hash-1' }, // repete
      { produtos: [candidato({ userProductId: 'C' })], searchAfterHash: 'hash-2' }, // nunca deveria rodar
    ];
    let i = 0;
    const buscarPagina = vi.fn(async () => paginas[i++]);
    const r = await buscarTodosComponentes(buscarPagina);
    expect(r.map((p) => p.userProductId)).toEqual(['A', 'B']);
    expect(buscarPagina).toHaveBeenCalledTimes(2);
  });

  it('para quando não há mais hash (paginação normal, fim da lista)', async () => {
    const buscarPagina = vi.fn(async () => ({ produtos: [candidato({ userProductId: 'A' })], searchAfterHash: null }));
    const r = await buscarTodosComponentes(buscarPagina);
    expect(r).toHaveLength(1);
    expect(buscarPagina).toHaveBeenCalledTimes(1);
  });

  it('para quando a página não traz id novo, mesmo com hash novo', async () => {
    const paginas: PaginaComponentesML[] = [
      { produtos: [candidato({ userProductId: 'A' })], searchAfterHash: 'hash-1' },
      { produtos: [candidato({ userProductId: 'A' })], searchAfterHash: 'hash-2' }, // hash novo, id repetido
    ];
    let i = 0;
    const buscarPagina = vi.fn(async () => paginas[i++]);
    const r = await buscarTodosComponentes(buscarPagina);
    expect(r).toHaveLength(1);
    expect(buscarPagina).toHaveBeenCalledTimes(2);
  });

  it('acumula por várias páginas quando o hash avança de verdade', async () => {
    const paginas: PaginaComponentesML[] = [
      { produtos: [candidato({ userProductId: 'A' })], searchAfterHash: 'hash-1' },
      { produtos: [candidato({ userProductId: 'B' })], searchAfterHash: 'hash-2' },
      { produtos: [candidato({ userProductId: 'C' })], searchAfterHash: null },
    ];
    let i = 0;
    const buscarPagina = vi.fn(async () => paginas[i++]);
    const r = await buscarTodosComponentes(buscarPagina);
    expect(r.map((p) => p.userProductId)).toEqual(['A', 'B', 'C']);
  });
});

describe('enriquecerComponentes', () => {
  it('casa produto local via ponte user_product_id -> item_id -> catálogo', () => {
    const candidatos = [candidato({ userProductId: 'UP-1' })];
    const bridges: ItemBridge[] = [{ itemId: 'MLB1', userProductId: 'UP-1', precoAtualML: 99.9, categoriaMlId: 'MLB1234' }];
    const catalogo: CatalogoLocalItem[] = [{
      itemId: 'MLB1', codigo: '00000010', codigoPai: '00000001', custo: 12.5, origem: 'nacional', kitMultiplicador: null,
    }];
    const r = enriquecerComponentes(candidatos, bridges, catalogo);
    expect(r[0]).toMatchObject({
      userProductId: 'UP-1', itemId: 'MLB1', codigo: '00000010', codigoPai: '00000001',
      custo: 12.5, origem: 'nacional', kitMultiplicador: null,
      precoAtualML: 99.9, categoriaMlId: 'MLB1234',
    });
  });

  it('produto sem ponte local vem com todos os campos de enriquecimento null (não 0/undefined)', () => {
    const candidatos = [candidato({ userProductId: 'UP-fora-do-app' })];
    const r = enriquecerComponentes(candidatos, [], []);
    expect(r[0]).toMatchObject({
      itemId: null, codigo: null, codigoPai: null, custo: null, origem: null, kitMultiplicador: null,
      precoAtualML: null, categoriaMlId: null,
    });
  });

  it('ponte casa mas o ML não devolveu price/category_id: os dois vêm null, nunca 0/string vazia', () => {
    const candidatos = [candidato({ userProductId: 'UP-4' })];
    const bridges: ItemBridge[] = [{ itemId: 'MLB4', userProductId: 'UP-4', precoAtualML: null, categoriaMlId: null }];
    const catalogo: CatalogoLocalItem[] = [{
      itemId: 'MLB4', codigo: '00000040', codigoPai: '00000004', custo: 5, origem: 'nacional', kitMultiplicador: null,
    }];
    const r = enriquecerComponentes(candidatos, bridges, catalogo);
    expect(r[0].precoAtualML).toBeNull();
    expect(r[0].categoriaMlId).toBeNull();
  });

  it('item plano casa mas sem custo local (variação sem custo cadastrado): custo é null, NUNCA 0', () => {
    // A margem (calcularMargemKit) depende de custo:null para devolver {ok:false} — um 0 aqui
    // viraria margem calculada com custo zero, calada, exatamente o que a Decisão 6 proíbe.
    const candidatos = [candidato({ userProductId: 'UP-2' })];
    const bridges: ItemBridge[] = [{ itemId: 'MLB2', userProductId: 'UP-2' }];
    const catalogo: CatalogoLocalItem[] = [{
      itemId: 'MLB2', codigo: '00000020', codigoPai: '00000002', custo: null, origem: 'importado', kitMultiplicador: null,
    }];
    const r = enriquecerComponentes(candidatos, bridges, catalogo);
    expect(r[0].custo).toBeNull();
    expect(r[0].custo).not.toEqual(0);
  });

  it('anexa kit_multiplicador quando o componente é um kit vinculado (D-9)', () => {
    const candidatos = [candidato({ userProductId: 'UP-KIT' })];
    const bridges: ItemBridge[] = [{ itemId: 'MLB-KIT', userProductId: 'UP-KIT', precoAtualML: 30, categoriaMlId: 'MLB1' }];
    const catalogo: CatalogoLocalItem[] = [{
      itemId: 'MLB-KIT', codigo: '00000030-K3', codigoPai: '00000030', custo: 30, origem: 'nacional', kitMultiplicador: 3,
    }];
    const r = enriquecerComponentes(candidatos, bridges, catalogo);
    expect(r[0].kitMultiplicador).toEqual(3);
  });

  it('preserva reasons de non_available através do enriquecimento', () => {
    const candidatos = [candidato({
      userProductId: 'UP-3', type: 'non_available',
      reasons: [{ id: 'OUT_OF_STOCK_ERROR', message: 'Sem estoque' }],
    })];
    const r = enriquecerComponentes(candidatos, [], []);
    expect(r[0].type).toEqual('non_available');
    expect(r[0].reasons).toEqual([{ id: 'OUT_OF_STOCK_ERROR', message: 'Sem estoque' }]);
  });
});

describe('buscarComponentesKitVirtual — orquestração', () => {
  function depsFake(opts: {
    candidatos: CandidatoBrutoML[];
    itemIdsLocais?: string[];
    bridges?: ItemBridge[];
    catalogo?: CatalogoLocalItem[];
  }): BuscarComponentesDeps {
    return {
      buscarPagina: async () => ({ produtos: opts.candidatos, searchAfterHash: null }),
      listarItemIdsLocais: async () => opts.itemIdsLocais ?? [],
      buscarUserProductIds: async () => opts.bridges ?? [],
      buscarCatalogoLocal: async () => opts.catalogo ?? [],
    };
  }

  it('separa elegíveis (available) de inelegíveis (non_available), preservando reasons', async () => {
    const deps = depsFake({
      candidatos: [
        candidato({ userProductId: 'UP-ok', type: 'available' }),
        candidato({
          userProductId: 'UP-multicor', type: 'non_available',
          reasons: [{ id: 'COMPONENT_NOT_MIGRATED_TO_UP', message: 'não migrado' }],
        }),
      ],
    });
    const r = await buscarComponentesKitVirtual(deps);
    expect(r.elegiveis.map((c) => c.userProductId)).toEqual(['UP-ok']);
    expect(r.inelegiveis).toHaveLength(1);
    expect(r.inelegiveis[0].reasons).toEqual([{ id: 'COMPONENT_NOT_MIGRATED_TO_UP', message: 'não migrado' }]);
  });

  it('não chama buscarUserProductIds/buscarCatalogoLocal quando a org não tem item local nenhum', async () => {
    const listarItemIdsLocais = vi.fn(async () => [] as string[]);
    const buscarUserProductIds = vi.fn(async () => [] as ItemBridge[]);
    const buscarCatalogoLocal = vi.fn(async () => [] as CatalogoLocalItem[]);
    await buscarComponentesKitVirtual({
      buscarPagina: async () => ({ produtos: [candidato({ userProductId: 'UP-1' })], searchAfterHash: null }),
      listarItemIdsLocais, buscarUserProductIds, buscarCatalogoLocal,
    });
    expect(buscarUserProductIds).not.toHaveBeenCalled();
    expect(buscarCatalogoLocal).not.toHaveBeenCalled();
  });

  it('ponta a ponta: busca ML + ponte + catálogo local enriquecem o resultado final', async () => {
    const deps = depsFake({
      candidatos: [candidato({ userProductId: 'UP-1' })],
      itemIdsLocais: ['MLB1'],
      bridges: [{ itemId: 'MLB1', userProductId: 'UP-1', precoAtualML: 149.9, categoriaMlId: 'MLB1234' }],
      catalogo: [{ itemId: 'MLB1', codigo: '001', codigoPai: '000', custo: 9.9, origem: 'nacional', kitMultiplicador: null }],
    });
    const r = await buscarComponentesKitVirtual(deps);
    expect(r.elegiveis[0]).toMatchObject({
      codigo: '001', codigoPai: '000', custo: 9.9, origem: 'nacional',
      precoAtualML: 149.9, categoriaMlId: 'MLB1234',
    });
  });
});

// O item plano UP é ancorado pelo SKU (ADR-0088 "Ancoragem"): `variacao_id` é nullable e estava
// NULL em 156/156 linhas em produção (medido 2026-09-10), então resolver por ela deixava todo
// componente UP sem custo/origem/kit_multiplicador na tela de montagem do kit. Mas o SKU sozinho
// não identifica: 136 dos 156 SKUs têm variação duplicada (re-ingest, ADR-0108) — quem desambigua
// é o `codigo_pai` do anúncio vendido.
describe('escolherVariacaoPorCodigo', () => {
  const linha = (
    codigo: string, custo: number | null, codigo_pai: string, atualizado_em: string | null,
    origem: 'nacional' | 'importado' | null = 'nacional', kit_multiplicador: number | null = null,
  ) => ({ codigo, custo, atualizado_em, familias: { codigo_pai, origem, kit_multiplicador } });

  it('resolve a variação pelo par (codigo_pai, sku)', () => {
    const m = escolherVariacaoPorCodigo([linha('00220566', 12.5, 'PAI1', '2026-09-01T00:00:00Z')]);
    expect(m.get(chaveVariacao('PAI1', '00220566'))).toEqual({ custo: 12.5, origem: 'nacional', kitMultiplicador: null });
  });

  // O incidente registrado em docs/reference/edge-functions.md: o código `26705421` existe em duas
  // famílias com GTINs diferentes e `atualizado_em` IDÊNTICO — desempatar por data caiu na família
  // errada. Escopar por codigo_pai remove a escolha arbitrária em vez de mascará-la.
  it('mesmo código em duas famílias com data IDÊNTICA: cada codigo_pai fica com a sua', () => {
    const m = escolherVariacaoPorCodigo([
      linha('26705421', 9.9, 'PAI_A', '2026-01-10T00:00:00Z', 'nacional'),
      linha('26705421', 14.2, 'PAI_B', '2026-01-10T00:00:00Z', 'importado'),
    ]);
    expect(m.get(chaveVariacao('PAI_A', '26705421'))).toMatchObject({ custo: 9.9, origem: 'nacional' });
    expect(m.get(chaveVariacao('PAI_B', '26705421'))).toMatchObject({ custo: 14.2, origem: 'importado' });
  });

  // Dentro do MESMO codigo_pai a duplicata é re-ingest do mesmo produto — aí o ADR-0108 vale.
  it('re-ingest do mesmo produto: vence a mais recente, com custo e origem da MESMA linha', () => {
    const m = escolherVariacaoPorCodigo([
      linha('X', 9.9, 'PAI1', '2026-01-10T00:00:00Z', 'nacional'),
      linha('X', 14.2, 'PAI1', '2026-08-30T00:00:00Z', 'importado'),
      linha('X', 11.0, 'PAI1', '2026-04-02T00:00:00Z', 'nacional'),
    ]);
    expect(m.get(chaveVariacao('PAI1', 'X'))).toMatchObject({ custo: 14.2, origem: 'importado' });
  });

  it('ordem do banco não importa: a mais recente vence mesmo vindo primeiro', () => {
    const m = escolherVariacaoPorCodigo([
      linha('X', 14.2, 'PAI1', '2026-08-30T00:00:00Z'),
      linha('X', 9.9, 'PAI1', '2026-01-10T00:00:00Z'),
    ]);
    expect(m.get(chaveVariacao('PAI1', 'X'))?.custo).toBe(14.2);
  });

  it('sem atualizado_em perde de qualquer data (e não vira NaN no comparador)', () => {
    const m = escolherVariacaoPorCodigo([
      linha('X', 9.9, 'PAI1', null),
      linha('X', 14.2, 'PAI1', '2026-01-10T00:00:00Z'),
    ]);
    expect(m.get(chaveVariacao('PAI1', 'X'))?.custo).toBe(14.2);
  });

  it('todas sem data: mantém a primeira, sem escolher no acaso', () => {
    const m = escolherVariacaoPorCodigo([linha('X', 9.9, 'PAI1', null), linha('X', 14.2, 'PAI1', null)]);
    expect(m.get(chaveVariacao('PAI1', 'X'))?.custo).toBe(9.9);
  });

  it('custo null é preservado (o front trata como campo faltante, não como zero)', () => {
    const m = escolherVariacaoPorCodigo([linha('X', null, 'PAI1', '2026-08-30T00:00:00Z')]);
    expect(m.get(chaveVariacao('PAI1', 'X'))?.custo).toBeNull();
  });

  // O supabase-js devolve o embed como objeto OU array conforme a cardinalidade inferida.
  it('aceita a família embutida como array (shape alternativo do supabase-js)', () => {
    const m = escolherVariacaoPorCodigo([
      { codigo: 'X', custo: 7.5, atualizado_em: null, familias: [{ codigo_pai: 'PAI1', origem: 'importado', kit_multiplicador: 3 }] },
    ]);
    expect(m.get(chaveVariacao('PAI1', 'X'))).toEqual({ custo: 7.5, origem: 'importado', kitMultiplicador: 3 });
  });

  it('linha sem família não entra no mapa (não há como escopar o código)', () => {
    const m = escolherVariacaoPorCodigo([{ codigo: 'X', custo: 7.5, atualizado_em: null, familias: null }]);
    expect(m.size).toBe(0);
  });

  it('lista vazia → mapa vazio', () => {
    expect(escolherVariacaoPorCodigo([]).size).toBe(0);
  });
});
