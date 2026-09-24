import { describe, it, expect, beforeEach, vi } from 'vitest';

const { enfileirarSpy } = vi.hoisted(() => ({ enfileirarSpy: vi.fn() }));
vi.mock('../../queue.ts', () => ({ enfileirarVinculacaoCatalogo: enfileirarSpy }));
const { notificarSpy } = vi.hoisted(() => ({ notificarSpy: vi.fn() }));
vi.mock('../../notificacoes/config.ts', () => ({ notificarCategoria: notificarSpy }));

// Captura o payload que iria ao ML — é nele que a ficha herdada precisa aparecer.
const { criarItemSpy } = vi.hoisted(() => ({ criarItemSpy: vi.fn() }));
vi.mock('../../ml/criar-item.ts', () => ({
  criarItemML: (...a: unknown[]) => {
    criarItemSpy(...a);
    return Promise.resolve({ id: 'MLB-NOVO', permalink: 'https://ml/novo' });
  },
  atualizarSecaoCores: vi.fn(),
}));

import { atualizarFamiliaUP, type AtualizarFamiliaUPArgs } from '../atualizar-familia-up';
import type { PortasComposicao, ResultadoComposicao } from '../atualizar-composicao';

/** Ficha do irmão como o ML devolve: BRAND normalizado com value_id e COMPOSITION, que o app
 *  nunca envia — as duas divergências que desagruparam a família no lote 54. */
const ATRIBUTOS_DO_IRMAO = [
  { id: 'BRAND', value_id: '9165622', value_name: 'Búfalo' },
  { id: 'MANUFACTURER', value_id: '9165622', value_name: 'Búfalo' },
  { id: 'COMPOSITION', value_id: '4904381', value_name: '100% poliéster' },
  { id: 'COLOR', value_id: '52024', value_name: 'Azul-petróleo' },
  { id: 'SELLER_PACKAGE_WEIGHT', value_id: null, value_name: '2330 g' },
];

const FILHO_ATIVO = {
  sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB-IRMAO', family_id: 'FAM-1',
};

function fakeAdmin(filhos: Record<string, unknown>[]) {
  function chain(table: string) {
    const rec = { op: '' };
    const ler = () => (table === 'anuncios_externos_itens' ? filhos : null);
    const api: Record<string, unknown> = {
      select: () => api, eq: () => api, in: () => api, is: () => api, limit: () => api, upsert: () => api,
      update: () => { rec.op = 'update'; return api; },
      maybeSingle: async () => ({ data: ler(), error: null }),
      single: async () => ({ data: ler(), error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: rec.op === 'update' ? null : ler(), error: null }).then(resolve),
    };
    return api;
  }
  const storage = { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'x' }, error: null }) }) };
  return { from: chain, storage } as never;
}

const conn = {
  capabilities: { variacoes: true, descricaoSeparada: false, catalogo: false, desconto: false, atacado: false, dimensoesPacote: true },
  subirFoto: async () => 'PIC',
  garantirDescricao: async () => {},
  aplicarAtacado: async () => {},
  sincronizarDescricao: async () => null,
} as never;

/** Saga fake que só exercita a porta de criação — é o caminho da cor nova. */
function sagaQueCria(sku: string) {
  return async (portas: PortasComposicao): Promise<ResultadoComposicao> => {
    await portas.criarPlano(sku);
    return { tipo: 'sem_mudanca' };
  };
}

function args(over: Partial<AtualizarFamiliaUPArgs> = {}): AtualizarFamiliaUPArgs {
  return {
    admin: fakeAdmin([FILHO_ATIVO]),
    conn,
    ctx: { getToken: async () => 'tok' } as never,
    conexao: { id: 'c', contaExternaId: 'seller-1' } as never,
    familia: {
      id: 'fam-1', org_id: 'org-1', codigo_pai: '000', categoria_ml_id: null,
      descricao_ml: 'Desc', atributos_ml: [{ id: 'BRAND', value_name: 'BUFALO' }, { id: 'LENGTH', value_name: '10 m' }],
      capa_ml_picture_id: null, capa2_ml_picture_id: null, capa3_ml_picture_id: null, atacado: null,
    } as never,
    raiz: { id: 'root-1', titulo: 'T', criado_em: null },
    variacoes: [
      { codigo: 'A', cor: 'Azul-petróleo', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: 'P1' },
      { codigo: 'NOVA', cor: 'Preto', estoque: 40, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: 'P2',
        peso_gramas: 2200, altura_cm: 43, largura_cm: 16, comprimento_cm: 36 },
    ] as never,
    somenteEstoque: false, tentativas: 0,
    executarSaga: sagaQueCria('NOVA'),
    ...over,
  };
}

function atributosEnviados(): Array<{ id: string; value_id?: string; value_name?: string }> {
  const payload = criarItemSpy.mock.calls[0]![1] as { attributes?: Array<{ id: string; value_id?: string; value_name?: string }> };
  return payload.attributes ?? [];
}

beforeEach(() => {
  enfileirarSpy.mockReset(); notificarSpy.mockReset(); criarItemSpy.mockReset();
  globalThis.fetch = (async () => new Response(JSON.stringify({ attributes: ATRIBUTOS_DO_IRMAO }), { status: 200 })) as typeof fetch;
});

describe('atualizarFamiliaUP — cor nova herda a ficha do irmão (incidente do lote 54)', () => {
  it('BRAND vai com o value_id do irmão, não com o texto cru do fornecedor', async () => {
    await atualizarFamiliaUP(args());
    const attrs = atributosEnviados();
    expect(attrs).toContainEqual({ id: 'BRAND', value_id: '9165622' });
    expect(attrs.find((a) => a.id === 'BRAND')?.value_name).toBeUndefined();
  });

  it('COMPOSITION — que o app nunca envia — chega no payload vindo do irmão', async () => {
    await atualizarFamiliaUP(args());
    expect(atributosEnviados()).toContainEqual({ id: 'COMPOSITION', value_id: '4904381' });
  });

  it('não herda a COR do irmão (senão a cor nova nasceria Azul-petróleo)', async () => {
    await atualizarFamiliaUP(args());
    const cores = atributosEnviados().filter((a) => a.id === 'COLOR');
    expect(cores.every((c) => c.value_id !== '52024')).toBe(true);
  });

  it('dimensões continuam vindo do banco (frete, ADR-0018), não do irmão', async () => {
    await atualizarFamiliaUP(args());
    const attrs = atributosEnviados();
    expect(attrs).toContainEqual({ id: 'SELLER_PACKAGE_WEIGHT', value_name: '2200 g' });
    expect(attrs.find((a) => a.value_name === '2330 g')).toBeUndefined();
  });

  it('atributo que só a família tem continua chegando', async () => {
    await atualizarFamiliaUP(args());
    expect(atributosEnviados()).toContainEqual({ id: 'LENGTH', value_name: '10 m' });
  });

  it('GET do irmão falhou → segue com os atributos da família (comportamento anterior)', async () => {
    globalThis.fetch = (async () => new Response('erro', { status: 500 })) as typeof fetch;
    await atualizarFamiliaUP(args());
    expect(atributosEnviados()).toContainEqual({ id: 'BRAND', value_name: 'BUFALO' });
  });
});

// Caracterização (Codex #12): payload COMPLETO que o código de ANTES da feature (ADR-0166
// 2026-09-24c) gerava para a família sem tamanho — literais copiados da saída real daquele código.
// Família sem tamanho tem que continuar byte a byte igual (INV-1).
const PAYLOAD_SEM_TAMANHO_ATUAL = {"category_id":"","currency_id":"BRL","buying_mode":"buy_it_now","listing_type_id":"gold_special","condition":"new","pictures":[{"id":"P2"}],"attributes":[{"id":"BRAND","value_id":"9165622"},{"id":"MANUFACTURER","value_id":"9165622"},{"id":"COMPOSITION","value_id":"4904381"},{"id":"LENGTH","value_name":"10 m"},{"id":"COLOR","value_name":"Preto"},{"id":"SELLER_PACKAGE_HEIGHT","value_name":"43 cm"},{"id":"SELLER_PACKAGE_WIDTH","value_name":"16 cm"},{"id":"SELLER_PACKAGE_LENGTH","value_name":"36 cm"},{"id":"SELLER_PACKAGE_WEIGHT","value_name":"2200 g"}],"price":10,"available_quantity":40,"seller_custom_field":"NOVA","family_name":"T"};
// Irmão remoto COM SIZE* e banco sem tamanho: hoje o SIZE* do irmão é herdado — continua sendo.
const PAYLOAD_SEM_TAMANHO_IRMAO_COM_SIZE = {"category_id":"","currency_id":"BRL","buying_mode":"buy_it_now","listing_type_id":"gold_special","condition":"new","pictures":[{"id":"P2"}],"attributes":[{"id":"BRAND","value_id":"9165622"},{"id":"MANUFACTURER","value_id":"9165622"},{"id":"COMPOSITION","value_id":"4904381"},{"id":"SIZE","value_name":"M"},{"id":"SIZE_GRID_ID","value_name":"CH1"},{"id":"SIZE_GRID_ROW_ID","value_name":"CH1:2"},{"id":"LENGTH","value_name":"10 m"},{"id":"COLOR","value_name":"Preto"},{"id":"SELLER_PACKAGE_HEIGHT","value_name":"43 cm"},{"id":"SELLER_PACKAGE_WIDTH","value_name":"16 cm"},{"id":"SELLER_PACKAGE_LENGTH","value_name":"36 cm"},{"id":"SELLER_PACKAGE_WEIGHT","value_name":"2200 g"}],"price":10,"available_quantity":40,"seller_custom_field":"NOVA","family_name":"T"};

describe('atualizarFamiliaUP — família sem tamanho (INV-1)', () => {
  it('payload completo idêntico ao de antes da feature, e chart nunca é chamado', async () => {
    const chartFake = vi.fn();
    await atualizarFamiliaUP(args({ garantirChartFn: chartFake as never }));
    expect(chartFake).not.toHaveBeenCalled();
    expect(criarItemSpy.mock.calls[0]![1]).toEqual(PAYLOAD_SEM_TAMANHO_ATUAL);
  });
  // Codex r3 #3: irmão remoto COM SIZE* e banco sem tamanho → payload exatamente como hoje.
  it('irmão remoto com SIZE* e variação sem tamanho: payload idêntico ao atual', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ attributes: [
      ...ATRIBUTOS_DO_IRMAO, { id: 'SIZE', value_name: 'M' }, { id: 'SIZE_GRID_ID', value_name: 'CH1' },
      { id: 'SIZE_GRID_ROW_ID', value_name: 'CH1:2' },
    ] }), { status: 200 })) as typeof fetch;
    await atualizarFamiliaUP(args());
    expect(criarItemSpy.mock.calls[0]![1]).toEqual(PAYLOAD_SEM_TAMANHO_IRMAO_COM_SIZE);
  });
});

describe('atualizarFamiliaUP — SKU novo de grade (ADR-0166 2026-09-24c)', () => {
  const IRMAO_GRADE = [
    ...ATRIBUTOS_DO_IRMAO,
    { id: 'GENDER', value_id: '339666', value_name: 'Masculino' },
    { id: 'SIZE', value_name: 'M' },
    { id: 'SIZE_GRID_ID', value_name: 'CH1' },
    { id: 'SIZE_GRID_ROW_ID', value_name: 'CH1:2' },
  ];
  const chartFake = vi.fn(async () => ({
    chartId: 'CH1',
    linhaPorTamanho: new Map([['M', { rowId: 'CH1:2', sizeLabel: 'M' }], ['G', { rowId: 'CH1:3', sizeLabel: 'G' }]]),
  }));
  function argsGrade(over: Partial<AtualizarFamiliaUPArgs> = {}) {
    const base = args();
    return args({
      familia: { ...(base.familia as object), genero: 'masculino', categoria_ml_id: 'MLB1', atributos_ml: [{ id: 'SIZE', value_name: 'XX' }] } as never,
      variacoes: [
        { codigo: 'A', cor: 'Azul-petróleo', tamanho: 'M', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: 'P1' },
        { codigo: 'NOVA', cor: 'Preto', tamanho: 'G', estoque: 40, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: 'P2' },
      ] as never,
      garantirChartFn: chartFake as never,
      ...over,
    });
  }
  beforeEach(() => {
    chartFake.mockClear();
    globalThis.fetch = (async () => new Response(JSON.stringify({ attributes: IRMAO_GRADE }), { status: 200 })) as typeof fetch;
  });

  it('SKU novo leva o SIZE e a linha do chart DELE, não os do irmão — e um SIZE só', async () => {
    await atualizarFamiliaUP(argsGrade());
    const attrs = atributosEnviados();
    expect(attrs.filter((a) => a.id === 'SIZE')).toEqual([{ id: 'SIZE', value_name: 'G' }]);
    expect(attrs.filter((a) => a.id === 'SIZE_GRID_ROW_ID')).toEqual([{ id: 'SIZE_GRID_ROW_ID', value_name: 'CH1:3' }]);
    expect(attrs.filter((a) => a.id === 'SIZE_GRID_ID')).toEqual([{ id: 'SIZE_GRID_ID', value_name: 'CH1' }]);
  });

  it('chart resolvido uma vez, com gênero e todos os tamanhos da família', async () => {
    await atualizarFamiliaUP(argsGrade());
    expect(chartFake).toHaveBeenCalledTimes(1);
    expect((chartFake.mock.calls[0] as unknown[]).slice(2)).toEqual(['c', 'MLB1', 'masculino', ['M', 'G']]);
  });

  it('família com tamanho e sem gênero falha alto, sem criar item', async () => {
    await expect(atualizarFamiliaUP(argsGrade({
      familia: { ...(args().familia as object), genero: null, categoria_ml_id: 'MLB1' } as never,
    }))).rejects.toThrow(/genero/i);
    expect(criarItemSpy).not.toHaveBeenCalled();
  });

  it('GENDER vem de familias.genero, nunca do irmão nem de atributos_ml (Codex #2)', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      attributes: IRMAO_GRADE.map((a) => (a.id === 'GENDER' ? { id: 'GENDER', value_id: '339665', value_name: 'Feminino' } : a)),
    }), { status: 200 })) as typeof fetch;
    await atualizarFamiliaUP(argsGrade({
      familia: { ...(args().familia as object), genero: 'masculino', categoria_ml_id: 'MLB1',
        atributos_ml: [{ id: 'GENDER', value_id: '110461' }] } as never,
    }));
    expect(atributosEnviados().filter((a) => a.id === 'GENDER')).toEqual([{ id: 'GENDER', value_id: '339666' }]);
  });

  it('GET do irmão falhou → GENDER e SIZE continuam certos', async () => {
    globalThis.fetch = (async () => new Response('erro', { status: 500 })) as typeof fetch;
    await atualizarFamiliaUP(argsGrade());
    const attrs = atributosEnviados();
    expect(attrs.filter((a) => a.id === 'GENDER')).toEqual([{ id: 'GENDER', value_id: '339666' }]);
    expect(attrs.filter((a) => a.id === 'SIZE')).toEqual([{ id: 'SIZE', value_name: 'G' }]);
  });
});
