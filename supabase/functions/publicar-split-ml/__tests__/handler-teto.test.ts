// ADR-0195 — fronteira real do worker: publicação nova acima do teto vira N anúncios sob o limite,
// e "somente estoque" nunca divide por soma.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Linha = Record<string, unknown>;
const f = vi.hoisted(() => ({
  serve: vi.fn(),
  variacoes: [] as Array<Record<string, unknown>>,
  linhas: [] as Array<Record<string, unknown>>,
  familia: {} as Record<string, unknown>,
  criados: [] as Array<{ titulo: string; variacoes: Array<{ sku: string; estoque: number }> }>,
  atualizados: [] as Array<{ itemExternoId: string; novas: Array<{ sku: string }> }>,
  confirmacoes: [] as Array<Record<string, unknown>>,
  modulos: [] as string[],
  componentes: [] as string[],
}));

function builder(tabela: string) {
  const resolver = (): { data: unknown; error: null } => {
    if (tabela === 'familias') return { data: { ...f.familia, organizations: { modulos_habilitados: f.modulos } }, error: null };
    if (tabela === 'variacoes') return { data: f.variacoes, error: null };
    if (tabela === 'anuncios_externos') return { data: f.linhas, error: null };
    if (tabela === 'lotes') return { data: { origem: 'planilha' }, error: null };
    return { data: [], error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q, eq: () => q, in: () => q, is: () => q, update: () => q,
    upsert: (linhas: Array<Record<string, unknown>>) => {
      if (tabela === 'confirmacoes_ml') f.confirmacoes.push(...linhas);
      return q;
    },
    single: async () => resolver(),
    maybeSingle: async () => resolver(),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, ko),
  };
  return q;
}

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/supabase.ts', () => ({
  adminClient: () => ({
    from: (t: string) => builder(t),
    rpc: async (n: string, a: { p_codigos: string[] }) => (n === 'kit_skus_participantes'
      ? { data: f.componentes.filter((c) => a.p_codigos.includes(c)), error: null }
      // ADR-0201: trava de escrita por MLB sempre livre aqui (handler-trava.test.ts cobre o conflito).
      : ['ml_travar_itens', 'ml_estender_trava', 'ml_soltar_itens'].includes(n) ? { data: true, error: null }
      : { data: null, error: { message: `rpc inesperada: ${n}` } }),
  }),
}));
vi.mock('../../_shared/queue.ts', () => ({
  verificarAssinatura: async () => true,
  enfileirarVinculacaoCatalogo: vi.fn(async () => {}),
  enfileirarSincronizacaoFiscal: vi.fn(async () => {}),
  enfileirarConfirmacao: vi.fn(async () => {}),
}));
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'tok' }));
vi.mock('../../_shared/canais/conexao.ts', () => ({ resolverConexao: async () => ({ id: 'conn-1' }) }));
vi.mock('../../_shared/ai/modelos.ts', () => ({ resolverModeloTexto: async () => 'modelo' }));
vi.mock('../../_shared/publicacao/guard-reajuste.ts', () => ({ exigirSemReajusteAtivo: async () => {} }));
vi.mock('../../_shared/fiscal/gate.ts', () => ({ exigirFiscalCompletoSePreciso: async () => false }));
vi.mock('../../_shared/lote/finalizar.ts', () => ({ talvezFinalizarLote: async () => {} }));
vi.mock('../../_shared/anuncios/espelhar.ts', () => ({ espelharAnuncioExterno: async () => {} }));
// IA fora do ar: o título da partição cai no fallback determinístico real.
vi.mock('../../_shared/ai/copywriter.ts', () => ({ gerarCopy: async () => { throw new Error('sem IA'); } }));
vi.mock('../../_shared/canais/registry.ts', () => ({
  getConnector: () => ({
    garantirDescricao: async () => {},
    criarAnuncio: async (_c: unknown, a: { titulo: string; variacoes: Array<{ sku: string; estoque: number }> }) => {
      f.criados.push(a);
      const n = f.criados.length;
      return {
        ok: true,
        valor: {
          itemExternoId: `MLB${n}`, permalink: `http://ml/${n}`,
          variacoesExternas: Object.fromEntries(a.variacoes.map((v, i) => [v.sku, `${n}0${i}`])),
        },
      };
    },
    atualizarAnuncio: async (_c: unknown, a: { itemExternoId: string; novas: Array<{ sku: string }> }) => {
      f.atualizados.push(a);
      return { ok: true, valor: { variacoesExternas: Object.fromEntries(a.novas.map((n) => [n.sku, '9'])) } };
    },
  }),
}));

import { enfileirarConfirmacao } from '../../_shared/queue.ts';

let handler: (req: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => 'http://localhost' } });
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});

const FAMILIA = {
  id: 'fam-1', org_id: 'org-1', user_id: 'user-1', codigo_pai: '000', status: 'publicando',
  ml_item_id: null, titulo_ml: 'LINHA COSTURA 1500M', nome_pai: 'Linha', descricao_ml: null,
  categoria_ml_id: 'MLB1', atributos_ml: [], tipo_aviamento: 'outro', atributos_faltantes: [],
};
const cor = (codigo: string, nome: string, estoque: number, over: Linha = {}): Linha => ({
  id: codigo, codigo, cor: nome, estoque, preco_publicacao: 10, gtin: null, ml_picture_id: 'P', ml_variation_id: null, ...over,
});

beforeEach(() => {
  f.familia = { ...FAMILIA }; f.linhas = []; f.criados = []; f.atualizados = []; f.confirmacoes = [];
  f.modulos = []; f.componentes = [];
  f.variacoes = [cor('A', 'Azul', 60_000), cor('B', 'Rosa', 60_000)];
  vi.mocked(enfileirarConfirmacao).mockClear();
});

const rodar = async (job: Linha = {}) => {
  const r = await handler(new Request('http://localhost', {
    method: 'POST', body: JSON.stringify({ familia_id: 'fam-1', lote_id: 'lote-1', ...job }),
  }));
  expect(r.status).toBe(200);
  return r.json();
};
const somaDe = (a: { variacoes: Array<{ estoque: number }> }) => a.variacoes.reduce((s, v) => s + v.estoque, 0);

describe('publicar-split-ml — divisão por soma (ADR-0195)', () => {
  it('2 cores, preço único, soma acima do limite: 2 anúncios sob o limite, títulos distintos', async () => {
    await rodar();
    expect(f.criados).toHaveLength(2);
    expect(f.criados.every((a) => somaDe(a) <= 99_999)).toBe(true);
    expect(f.criados[0].titulo).not.toBe(f.criados[1].titulo);
  });

  it('cor sozinha acima do limite fica em partição própria, sem laço', async () => {
    f.variacoes = [cor('A', 'Azul', 150_000), cor('B', 'Rosa', 10)];
    await rodar();
    expect(f.criados.map((a) => a.variacoes.map((v) => v.sku))).toEqual([['A'], ['B']]);
  });

  it('somente estoque não divide por soma: cor nova segue a partição do preço', async () => {
    f.familia = { ...FAMILIA, ml_item_id: 'MLB0', preco_publicado_ml: 10 };
    f.linhas = [{ particao: 0, item_externo_id: 'MLB0', variacoes_externas: { A: {} } }];
    f.variacoes = [cor('A', 'Azul', 90_000, { ml_variation_id: '1', preco_publicado_ml: 10 }), cor('N', 'Verde', 20_000)];
    await rodar({ somenteEstoque: true });
    expect(f.criados).toEqual([]);
    expect(f.atualizados.map((a) => a.novas.map((n) => n.sku))).toEqual([['N']]);
  });
});

describe('publicar-split-ml — conferência do CREATE (ADR-0195)', () => {
  it('registra o enviado depois do teto, com `capados`, e agenda a conferência', async () => {
    f.variacoes = [cor('A', 'Azul', 150_000), cor('B', 'Rosa', 10)];
    await rodar();
    expect(f.confirmacoes.map((c) => c.item_externo_id)).toEqual(['MLB1', 'MLB2']);
    expect(f.confirmacoes[0]).toMatchObject({
      modelo: 'variacoes', capados: 1, status: 'aguardando',
      enviado: { A: { qtd: 99_999, anterior: null, variacao_id: '100' } },
    });
    expect(f.confirmacoes[1]).toMatchObject({ capados: 0, enviado: { B: { qtd: 10, anterior: null, variacao_id: '200' } } });
    expect(enfileirarConfirmacao).toHaveBeenCalledTimes(1);
  });
});

// ADR-0200: kit com variação só existe em user products; o split Legacy nunca escreve quantidade dele.
describe('publicar-split-ml — kit com variação', () => {
  it('cor participante: recusa antes de criar ou atualizar qualquer partição', async () => {
    f.modulos = ['kit_variacao']; f.componentes = ['A'];
    await handler(new Request('http://localhost', {
      method: 'POST', body: JSON.stringify({ familia_id: 'fam-1', lote_id: 'lote-1' }),
    }));
    expect(f.criados).toEqual([]);
    expect(f.atualizados).toEqual([]);
  });

  it('org sem o módulo publica como hoje', async () => {
    f.componentes = ['A'];
    await rodar();
    expect(f.criados).toHaveLength(2);
  });
});
