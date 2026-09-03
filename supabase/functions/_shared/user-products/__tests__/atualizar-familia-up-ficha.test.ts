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
