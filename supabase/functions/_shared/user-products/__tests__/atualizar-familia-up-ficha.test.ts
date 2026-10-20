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
import { decidirRetryTransitorio } from '../../publicacao/retry';

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
    expect((chartFake.mock.calls[0] as unknown[]).slice(2)).toEqual(['c', 'MLB1', 'masculino', ['M', 'G'], 'letras']);
  });

  // ADR-0182 D2: grade gravada vence; sem ela e com tamanho não inferível → 400 antes do chart.
  it('grade gravada (calca) chega ao garantirChart', async () => {
    const fn = vi.fn(async () => ({ chartId: 'CH1', linhaPorTamanho: new Map([['40', { rowId: 'CH1:9', sizeLabel: '40' }]]) }));
    await atualizarFamiliaUP(argsGrade({
      familia: { ...(argsGrade().familia as object), grade_tamanho: 'calca' } as never,
      variacoes: [
        { codigo: 'NOVA', cor: 'Preto', tamanho: '40', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: 'P2' },
      ] as never,
      garantirChartFn: fn as never,
    }));
    expect((fn.mock.calls[0] as unknown[]).slice(2)).toEqual(['c', 'MLB1', 'masculino', ['40'], 'calca']);
  });

  // ADR-0182 D7 / Review Focus 7: CLOTHING_LOT_SIZE é por SKU — o do irmão ('4') e o de
  // atributos_ml nunca vazam; o SKU novo sai com exatamente um, o seu ('6').
  it('sem guia (CLOTHING_LOTS): SKU novo sai com GENDER infantil e só o SEU CLOTHING_LOT_SIZE', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ attributes: [
      ...ATRIBUTOS_DO_IRMAO,
      { id: 'GENDER', value_id: '339667', value_name: 'Meninos' },
      { id: 'CLOTHING_LOT_SIZE', value_id: null, value_name: '4' },
    ] }), { status: 200 })) as typeof fetch;
    await atualizarFamiliaUP(argsGrade({
      familia: { ...(argsGrade().familia as object), genero: 'meninos', grade_tamanho: 'infantil',
        atributos_ml: [{ id: 'CLOTHING_LOT_SIZE', value_name: '2' }] } as never,
      variacoes: [
        { codigo: 'A', cor: 'Azul-petróleo', tamanho: '4', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: 'P1' },
        { codigo: 'NOVA', cor: 'Preto', tamanho: '6', estoque: 40, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: 'P2' },
      ] as never,
      garantirChartFn: vi.fn(async () => ({ semGuia: 'CLOTHING_LOT_SIZE' })) as never,
    }));
    const attrs = atributosEnviados();
    expect(attrs.filter((a) => a.id === 'CLOTHING_LOT_SIZE')).toEqual([{ id: 'CLOTHING_LOT_SIZE', value_name: '6' }]);
    expect(attrs.filter((a) => a.id === 'GENDER')).toEqual([{ id: 'GENDER', value_id: '339667' }]);
    expect(attrs.map((a) => a.id)).not.toContain('SIZE');
  });

  it('grade não resolvível (tamanho infantil sem grade_tamanho) → erro 400 antes do chart', async () => {
    const err = await atualizarFamiliaUP(argsGrade({
      familia: { ...(argsGrade().familia as object), genero: 'meninos', grade_tamanho: null } as never,
      variacoes: [
        { codigo: 'NOVA', cor: 'Preto', tamanho: '4', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: 'P2' },
      ] as never,
    })).then(() => null, (e: unknown) => e);
    expect(String(err)).toMatch(/grade de tamanho/);
    expect((err as { status?: number }).status).toBe(400);
    expect(chartFake).not.toHaveBeenCalled();
    expect(criarItemSpy).not.toHaveBeenCalled();
  });

  it('família com tamanho e sem gênero falha alto, sem criar item', async () => {
    await expect(atualizarFamiliaUP(argsGrade({
      familia: { ...(args().familia as object), genero: null, categoria_ml_id: 'MLB1' } as never,
    }))).rejects.toThrow(/genero/i);
    expect(criarItemSpy).not.toHaveBeenCalled();
  });

  it('erro de cadastro (sem gênero / sem categoria) é definitivo: a decisão real de retry não retenta', async () => {
    for (const over of [{ genero: null, categoria_ml_id: 'MLB1' }, { genero: 'masculino', categoria_ml_id: null }]) {
      const err = await atualizarFamiliaUP(argsGrade({
        familia: { ...(args().familia as object), ...over } as never,
      })).then(() => null, (e: unknown) => e);
      expect((err as { status?: number }).status).toBe(400);
      expect(decidirRetryTransitorio(err, 0)).toBe('definitivo');
    }
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

// Achado pré-merge (Codex gpt-6.1-sol): "Atualizar tudo" reenvia o delta de `atributos_ml` aos
// filhos (ADR-0157). Com grade, GENDER sai de `familias.genero` e SIZE* nunca vai família-level —
// mesma regra do CREATE (publicar-familia-up.ts IDS_SUBSTITUIDOS). Saga REAL, PUT capturado no fetch.
describe('atualizarFamiliaUP — reposição não reenvia GENDER/SIZE* de atributos_ml', () => {
  type Attr = { id: string; value_id?: string | null; value_name?: string };
  const fichaMl = (genderId: string): Attr[] => [
    ...ATRIBUTOS_DO_IRMAO,
    { id: 'GENDER', value_id: genderId },
    { id: 'SIZE', value_name: '4' }, { id: 'SIZE_GRID_ID', value_name: 'CH9' }, { id: 'SIZE_GRID_ROW_ID', value_name: 'CH9:1' },
  ];
  let puts: Array<{ available_quantity?: number; price?: number; attributes?: Attr[] }>;
  function mockMl(ficha: Attr[]) {
    puts = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return new Response('{}', { status: 200 });
      }
      return new Response(JSON.stringify({ attributes: ficha }), { status: 200 });
    }) as typeof fetch;
  }
  beforeEach(() => mockMl(fichaMl('339667')));
  const ATRIBUTOS_IA: Attr[] = [
    { id: 'GENDER', value_id: '339668' },
    { id: 'SIZE', value_name: '8' }, { id: 'SIZE_GRID_ID', value_name: 'XX' }, { id: 'SIZE_GRID_ROW_ID', value_name: 'XX:1' },
    { id: 'LENGTH', value_name: '10 m' },
  ];
  function argsRepor(fam: Record<string, unknown> = {}, extra: Partial<AtualizarFamiliaUPArgs> = {}) {
    const base = args();
    return args({
      familia: { ...(base.familia as object), genero: 'meninos', grade_tamanho: 'infantil',
        atributos_ml: ATRIBUTOS_IA, ...fam } as never,
      variacoes: [
        { codigo: 'A', cor: 'Azul-petróleo', tamanho: '4', estoque: 3, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: 'P1' },
      ] as never,
      executarSaga: undefined,
      ...extra,
    });
  }

  it('gênero meninos estruturado × meninas em atributos_ml: PUT nunca leva 339668 nem SIZE*', async () => {
    await atualizarFamiliaUP(argsRepor());
    expect(puts).toHaveLength(1);
    const attrs = puts[0]!.attributes ?? [];
    expect(attrs.find((a) => a.value_id === '339668')).toBeUndefined();
    expect(attrs.filter((a) => a.id === 'GENDER').every((a) => a.value_id === '339667')).toBe(true);
    for (const id of ['SIZE', 'SIZE_GRID_ID', 'SIZE_GRID_ROW_ID']) expect(attrs.map((a) => a.id)).not.toContain(id);
    expect(attrs).toContainEqual({ id: 'LENGTH', value_name: '10 m' });
  });

  it('ML com gênero errado: a reposição corrige para o de familias.genero', async () => {
    mockMl(fichaMl('339668'));
    await atualizarFamiliaUP(argsRepor());
    expect((puts[0]!.attributes ?? []).filter((a) => a.id === 'GENDER')).toEqual([{ id: 'GENDER', value_id: '339667' }]);
  });

  it('família sem tamanho: delta de atributos_ml segue como antes (GENDER/SIZE* inclusos)', async () => {
    await atualizarFamiliaUP(argsRepor({ genero: null, grade_tamanho: null }, {
      variacoes: [{ codigo: 'A', cor: 'Azul-petróleo', estoque: 3, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: 'P1' }] as never,
    }));
    expect(puts[0]!.attributes).toEqual([
      { id: 'GENDER', value_id: '339668' }, { id: 'SIZE', value_name: '8' },
      { id: 'SIZE_GRID_ID', value_name: 'XX' }, { id: 'SIZE_GRID_ROW_ID', value_name: 'XX:1' },
      { id: 'LENGTH', value_name: '10 m' },
    ]);
  });

  it('somenteEstoque: PUT só com available_quantity, sem attributes', async () => {
    await atualizarFamiliaUP(argsRepor({}, { somenteEstoque: true }));
    expect(puts).toEqual([{ available_quantity: 3 }]);
  });
});

describe('atualizarFamiliaUP — marca do produto (ADR-0188)', () => {

  it('cor nova: irmão com marca do fornecedor → BRAND/MANUFACTURER saem com a marca da org', async () => {
    await atualizarFamiliaUP(args({ marcaProduto: 'Zaven' }));
    const attrs = atributosEnviados();
    expect(attrs).toContainEqual({ id: 'BRAND', value_name: 'Zaven' });
    expect(attrs).toContainEqual({ id: 'MANUFACTURER', value_name: 'Zaven' });
    expect(attrs.find((a) => a.id === 'COMPOSITION')).toEqual({ id: 'COMPOSITION', value_id: '4904381' });
  });

  it('cor nova: irmão já com a marca da org normalizada (value_id) → herda o value_id, não texto cru', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ attributes: [
      { id: 'BRAND', value_id: '777', value_name: 'Zaven' },
      { id: 'COLOR', value_id: '52024', value_name: 'Azul-petróleo' },
    ] }), { status: 200 })) as typeof fetch;
    await atualizarFamiliaUP(args({ marcaProduto: 'Zaven' }));
    expect(atributosEnviados().find((a) => a.id === 'BRAND')).toEqual({ id: 'BRAND', value_id: '777' });
  });

  it('reposição: atributos da família entregues à saga já com a marca da org', async () => {
    let recebidos: unknown;
    await atualizarFamiliaUP(args({
      marcaProduto: 'Zaven',
      executarSaga: async (_p, entrada) => { recebidos = entrada.atributosFamilia; return { tipo: 'sem_mudanca' }; },
    }));
    expect(recebidos).toEqual([{ id: 'BRAND', value_name: 'Zaven' }, { id: 'LENGTH', value_name: '10 m' }]);
  });
});

// Incidente 19/10/2026 (MLB7845606234): o ML gravou o family_name normalizado na criação
// ("…Mauricinho", sem espaço duplo nem a cor) e a cor nova foi com o título cru da raiz
// ("…Mauricinho  Preto") → family_id novo → UPDATE bloqueado.
describe('atualizarFamiliaUP — cor nova usa o family_name vivo do irmão', () => {
  it('family_name do payload e da busca por SKU é o do irmão no ML, não o título local', async () => {
    // Item já criado numa tentativa anterior (com o nome vivo): a busca por SKU precisa readotá-lo.
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes('/items/search')) {
        return new Response(JSON.stringify({ results: ['MLB-X'], paging: { total: 1 } }), { status: 200 });
      }
      if (String(url).includes('/items/bulk')) {
        return new Response(JSON.stringify([{ status_code: 200, body: {
          id: 'MLB-X', category_id: '', family_name: 'Nome Vivo', seller_id: 'seller-1', date_created: new Date().toISOString(),
        } }]), { status: 200 });
      }
      return new Response(JSON.stringify({ attributes: ATRIBUTOS_DO_IRMAO, family_name: 'Nome Vivo' }), { status: 200 });
    }) as typeof fetch;
    let achado: unknown;
    await atualizarFamiliaUP(args({
      raiz: { id: 'root-1', titulo: 'Nome  Local Preto', criado_em: null },
      executarSaga: async (portas) => {
        achado = await portas.buscarPorSku('NOVA');
        await portas.criarPlano('NOVA');
        return { tipo: 'sem_mudanca' };
      },
    }));
    expect((criarItemSpy.mock.calls[0]![1] as { family_name?: string }).family_name).toBe('Nome Vivo');
    expect(achado).toEqual({ tipo: 'um', itemExternoId: 'MLB-X' });
  });

  it('item de tentativa anterior criado com o título cru ainda é readotado (sem POST duplicado)', async () => {
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes('/items/search')) {
        return new Response(JSON.stringify({ results: ['MLB-ORFAO'], paging: { total: 1 } }), { status: 200 });
      }
      if (String(url).includes('/items/bulk')) {
        return new Response(JSON.stringify([{ status_code: 200, body: {
          id: 'MLB-ORFAO', category_id: '', family_name: 'Nome  Local Preto', seller_id: 'seller-1', date_created: new Date().toISOString(),
        } }]), { status: 200 });
      }
      return new Response(JSON.stringify({ attributes: ATRIBUTOS_DO_IRMAO, family_name: 'Nome Vivo' }), { status: 200 });
    }) as typeof fetch;
    let achado: unknown;
    await atualizarFamiliaUP(args({
      raiz: { id: 'root-1', titulo: 'Nome  Local Preto', criado_em: null },
      executarSaga: async (portas) => { achado = await portas.buscarPorSku('NOVA'); return { tipo: 'sem_mudanca' }; },
    }));
    expect(achado).toEqual({ tipo: 'um', itemExternoId: 'MLB-ORFAO' });
  });

  it('GET do irmão falhou → family_name cai para o título da raiz', async () => {
    globalThis.fetch = (async () => new Response('erro', { status: 500 })) as typeof fetch;
    await atualizarFamiliaUP(args());
    expect((criarItemSpy.mock.calls[0]![1] as { family_name?: string }).family_name).toBe('T');
  });
});
