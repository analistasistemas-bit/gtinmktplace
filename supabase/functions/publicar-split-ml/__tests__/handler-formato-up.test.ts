// ADR-0160 (emenda 2026-11-09) — o split descobre que a categoria é User Products e devolve a
// família nova ao `publish` (saga UP), em vez de retentar FORMATO_INCOMPATIVEL até virar erro.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Linha = Record<string, unknown>;
const f = vi.hoisted(() => ({
  serve: vi.fn(),
  variacoes: [] as Linha[],
  linhas: [] as Linha[],
  familia: {} as Linha,
  updates: [] as Array<{ tabela: string; patch: Linha }>,
  criados: [] as Array<{ variacoes: Array<{ sku: string }> }>,
  // Partições com >1 cor recebem FORMATO_INCOMPATIVEL (assim age o conector numa categoria UP).
  formatoIncompativel: true,
  okPrimeiros: 0, // as N primeiras criações passam mesmo com >1 cor (estado misto)
  erroFotoRetentavel: false,
  erroLinhas: false,
  subirFoto: vi.fn(async () => 'PIC'),
}));

function builder(tabela: string) {
  const resolver = (): { data: unknown; error: null } => {
    if (tabela === 'familias') return { data: { ...f.familia, organizations: { modulos_habilitados: [] } }, error: null };
    if (tabela === 'variacoes') return { data: f.variacoes, error: null };
    if (tabela === 'anuncios_externos') {
      return (f.erroLinhas ? { data: null, error: { message: 'timeout' } } : { data: f.linhas, error: null }) as never;
    }
    if (tabela === 'lotes') return { data: { origem: 'planilha' }, error: null };
    return { data: [], error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q, eq: () => q, in: () => q, is: () => q, upsert: () => q,
    update: (patch: Linha) => { f.updates.push({ tabela, patch }); return q; },
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
    // ADR-0201 (merge): trava de escrita livre — com item no ar o split reserva antes de escrever.
    rpc: async (n: string) => ({ data: n === 'ml_travar_itens' || n === 'ml_estender_trava' ? true : [], error: null }),
    storage: { from: () => ({ createSignedUrl: async (p: string) => ({ data: { signedUrl: `http://s/${p}` }, error: null }) }) },
  }),
}));
vi.mock('../../_shared/queue.ts', () => ({
  verificarAssinatura: async () => true,
  enfileirarVinculacaoCatalogo: vi.fn(async () => {}),
  enfileirarSincronizacaoFiscal: vi.fn(async () => {}),
  enfileirarConfirmacao: vi.fn(async () => {}),
  enfileirarPublicacoes: vi.fn(async () => ['msg-1']),
}));
vi.mock('../../_shared/ml/formato-publicacao.ts', () => ({
  formatoRepoSupabase: () => ({ repo: true }),
  lerFormatoPublicacao: vi.fn(async () => 'desconhecido'),
  confirmarFormatoPublicacao: vi.fn(async () => {}),
}));
vi.mock('../../_shared/split/titulo-particao.ts', () => ({ gerarTituloParticao: vi.fn(async () => 'TITULO P') }));
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'tok' }));
vi.mock('../../_shared/canais/conexao.ts', () => ({ resolverConexao: async () => ({ id: 'conn-1' }) }));
vi.mock('../../_shared/ai/modelos.ts', () => ({ resolverModeloTexto: async () => 'modelo' }));
vi.mock('../../_shared/publicacao/guard-reajuste.ts', () => ({ exigirSemReajusteAtivo: async () => {} }));
vi.mock('../../_shared/fiscal/gate.ts', () => ({ exigirFiscalCompletoSePreciso: async () => false }));
vi.mock('../../_shared/lote/finalizar.ts', () => ({ talvezFinalizarLote: vi.fn(async () => {}) }));
vi.mock('../../_shared/anuncios/espelhar.ts', () => ({ espelharAnuncioExterno: async () => {} }));
vi.mock('../../_shared/canais/registry.ts', () => ({
  getConnector: () => ({
    garantirDescricao: async () => {},
    subirFoto: f.subirFoto,
    criarAnuncio: async (_c: unknown, a: { categoriaId: string; variacoes: Array<{ sku: string }> }) => {
      f.criados.push(a);
      if (f.erroFotoRetentavel) {
        return { ok: false, erro: { codigo: 'FOTO', mensagemOperador: 'item.pictures.unavailable', retentavel: true } };
      }
      if (f.formatoIncompativel && a.variacoes.length > 1 && f.criados.length > f.okPrimeiros) {
        return {
          ok: false,
          erro: { codigo: 'FORMATO_INCOMPATIVEL', mensagemOperador: `Categoria ${a.categoriaId} exige item plano`, retentavel: false },
        };
      }
      const n = f.criados.length;
      return {
        ok: true,
        valor: {
          itemExternoId: `MLB${n}`, permalink: `http://ml/${n}`,
          variacoesExternas: Object.fromEntries(a.variacoes.map((v, i) => [v.sku, `${n}0${i}`])),
        },
      };
    },
    atualizarAnuncio: async (_c: unknown, a: { novas: Array<{ sku: string }> }) => ({
      ok: true, valor: { variacoesExternas: Object.fromEntries(a.novas.map((n) => [n.sku, '9'])) },
    }),
  }),
}));

import { enfileirarPublicacoes } from '../../_shared/queue.ts';
import { confirmarFormatoPublicacao, lerFormatoPublicacao } from '../../_shared/ml/formato-publicacao.ts';
import { gerarTituloParticao } from '../../_shared/split/titulo-particao.ts';
import { talvezFinalizarLote } from '../../_shared/lote/finalizar.ts';

let handler: (req: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => 'http://localhost' } });
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});

const FAMILIA = {
  id: 'fam-1', org_id: 'org-1', user_id: 'user-1', codigo_pai: '02994283', status: 'publicando',
  ml_item_id: null, titulo_ml: 'ROUPA', nome_pai: 'Roupa', descricao_ml: null,
  categoria_ml_id: 'MLB277368', atributos_ml: [], tipo_aviamento: 'outro', atributos_faltantes: [],
  capa_storage_path: 'capa.jpg', capa_ml_picture_id: null,
};
const cor = (codigo: string, nome: string, preco: number, over: Linha = {}): Linha => ({
  id: codigo, codigo, cor: nome, estoque: 5, preco_publicacao: preco, gtin: null,
  ml_picture_id: 'P', ml_variation_id: null, imagem_path: `${codigo}.jpg`, ...over,
});
// Partição 0 = "Amarelo" sozinha (R$ 20); partição 1 = 6 cores a R$ 10 (alfabética por cor).
const SEIS = ['Azul', 'Bege', 'Cinza', 'Preto', 'Rosa', 'Verde'].map((n, i) => cor(`C${i}`, n, 10));
const JOB = { familia_id: 'fam-1', lote_id: 'lote-1', listing_type_id: 'gold_special', versoes_kit: { C0: 3 } };

const statusErro = () => f.updates.find((u) => u.tabela === 'familias' && u.patch.status === 'erro');

beforeEach(() => {
  f.familia = { ...FAMILIA }; f.linhas = []; f.updates = []; f.criados = [];
  f.formatoIncompativel = true; f.okPrimeiros = 0; f.erroFotoRetentavel = false; f.erroLinhas = false;
  f.variacoes = [cor('A', 'Amarelo', 20), ...SEIS];
  f.subirFoto.mockClear();
  vi.mocked(enfileirarPublicacoes).mockReset().mockResolvedValue(['msg-1']);
  vi.mocked(lerFormatoPublicacao).mockReset().mockResolvedValue('desconhecido');
  vi.mocked(confirmarFormatoPublicacao).mockClear();
  vi.mocked(gerarTituloParticao).mockClear();
  vi.mocked(talvezFinalizarLote).mockClear();
});

const rodar = (job: Linha = JOB) => handler(new Request('http://localhost', { method: 'POST', body: JSON.stringify(job) }));

const reenfileirouJob = () => expect(enfileirarPublicacoes).toHaveBeenCalledWith(
  [{ job: expect.objectContaining({ familia_id: 'fam-1', lote_id: 'lote-1', listing_type_id: 'gold_special', versoes_kit: { C0: 3 } }), alvo: 'publish' }],
  'user-1',
);

describe('publicar-split-ml — reativo FORMATO_INCOMPATIVEL', () => {
  it('FORMATO_INCOMPATIVEL na faixa de ≥2 cores sem nada no ar semeia cache e reenfileira', async () => {
    f.variacoes = [...SEIS, cor('Z', 'Zinco', 20, { cor: 'Zinco' })];
    const r = await rodar();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, reroteado: 'publish' });
    expect(confirmarFormatoPublicacao).toHaveBeenCalledWith({ repo: true }, 'conn-1', 'MLB277368', 'user_products');
    reenfileirouJob();
    expect(statusErro()).toBeUndefined();
    expect(talvezFinalizarLote).not.toHaveBeenCalled();
  });

  it('faixa de 1 cor vem depois da de ≥2 cores', async () => {
    const r = await rodar();
    expect(r.status).toBe(200);
    expect(f.criados).toHaveLength(1);
    expect(f.criados[0].variacoes).toHaveLength(6);
    reenfileirouJob();
    expect(statusErro()).toBeUndefined();
  });

  it('FORMATO_INCOMPATIVEL com partição já no ar não reenfileira e não retenta', async () => {
    // Partição 0 (2 cores, R$ 20) cria ok; partição 1 (6 cores) dá FORMATO_INCOMPATIVEL.
    f.variacoes = [cor('A', 'Amarelo', 20), cor('B', 'Ameixa', 20), ...SEIS];
    f.okPrimeiros = 1;
    const r = await rodar();
    expect(r.status).toBe(200);
    expect(f.criados).toHaveLength(2);
    expect(confirmarFormatoPublicacao).toHaveBeenCalledWith({ repo: true }, 'conn-1', 'MLB277368', 'user_products');
    expect(enfileirarPublicacoes).not.toHaveBeenCalled();
    expect(String(statusErro()?.patch.erro_mensagem)).toContain('já está no ar');
    expect(talvezFinalizarLote).toHaveBeenCalledWith(expect.anything(), 'lote-1');
  });

  it('>100 cores sem cache: FORMATO_INCOMPATIVEL no reativo não reenfileira', async () => {
    f.variacoes = Array.from({ length: 101 }, (_, i) => cor(`K${i}`, `Cor ${String(i).padStart(3, '0')}`, 10));
    const r = await rodar();
    expect(r.status).toBe(200);
    expect(confirmarFormatoPublicacao).toHaveBeenCalledWith({ repo: true }, 'conn-1', 'MLB277368', 'user_products');
    expect(enfileirarPublicacoes).not.toHaveBeenCalled();
    expect(String(statusErro()?.patch.erro_mensagem)).toContain('mais de 100 cores');
    expect(talvezFinalizarLote).toHaveBeenCalledWith(expect.anything(), 'lote-1');
  });

  it('falha no enqueue vira erro com instrução de publicar de novo', async () => {
    vi.mocked(enfileirarPublicacoes).mockRejectedValue(new Error('qstash fora'));
    const r = await rodar();
    expect(r.status).toBe(200);
    expect(String(statusErro()?.patch.erro_mensagem)).toContain('publique de novo');
    expect(talvezFinalizarLote).toHaveBeenCalledWith(expect.anything(), 'lote-1');
  });

  it('erro de foto retentável segue retentando', async () => {
    f.erroFotoRetentavel = true;
    const r = await rodar();
    expect(r.status).toBe(500);
    expect(enfileirarPublicacoes).not.toHaveBeenCalled();
    expect(statusErro()).toBeUndefined();
  });
});

describe('publicar-split-ml — pré-check do cache de formato', () => {
  it('cache user_products e nada no ar reenfileira sem POST, foto nem título', async () => {
    vi.mocked(lerFormatoPublicacao).mockResolvedValue('user_products');
    f.variacoes = f.variacoes.map((v) => ({ ...v, ml_picture_id: null }));
    const r = await rodar();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, reroteado: 'publish' });
    expect(lerFormatoPublicacao).toHaveBeenCalledWith({ repo: true }, 'conn-1', 'MLB277368');
    expect(f.criados).toEqual([]);
    expect(f.subirFoto).not.toHaveBeenCalled();
    expect(gerarTituloParticao).not.toHaveBeenCalled();
    reenfileirouJob();
    expect(talvezFinalizarLote).not.toHaveBeenCalled();
  });

  it('raiz da saga com item_externo_id nulo conta como nada no ar', async () => {
    vi.mocked(lerFormatoPublicacao).mockResolvedValue('user_products');
    f.linhas = [{ particao: 0, item_externo_id: null, variacoes_externas: {} }];
    const r = await rodar();
    expect(r.status).toBe(200);
    expect(f.criados).toEqual([]);
    reenfileirouJob();
  });

  it('>100 cores com cache user_products não reenfileira', async () => {
    vi.mocked(lerFormatoPublicacao).mockResolvedValue('user_products');
    f.formatoIncompativel = false; // segue no split (ADR-0048); a categoria aqui aceita o POST.
    f.variacoes = Array.from({ length: 101 }, (_, i) => cor(`K${i}`, `Cor ${String(i).padStart(3, '0')}`, 10));
    const r = await rodar();
    expect(r.status).toBe(200);
    expect(enfileirarPublicacoes).not.toHaveBeenCalled();
    expect(f.criados.length).toBeGreaterThan(0);
  });

  it('falha no enqueue do pré-check vira erro com instrução de publicar de novo', async () => {
    vi.mocked(lerFormatoPublicacao).mockResolvedValue('user_products');
    vi.mocked(enfileirarPublicacoes).mockRejectedValue(new Error('qstash fora'));
    const r = await rodar();
    expect(r.status).toBe(200);
    expect(f.criados).toEqual([]);
    expect(String(statusErro()?.patch.erro_mensagem)).toContain('publique de novo');
    expect(talvezFinalizarLote).toHaveBeenCalledWith(expect.anything(), 'lote-1');
  });

  it('com partição no ar o cache não reroteia', async () => {
    vi.mocked(lerFormatoPublicacao).mockResolvedValue('user_products');
    f.formatoIncompativel = false;
    f.familia = { ...FAMILIA, ml_item_id: 'MLB0' };
    f.linhas = [{ particao: 0, item_externo_id: 'MLB0', variacoes_externas: { A: {} } }];
    f.variacoes = [cor('A', 'Amarelo', 20, { ml_variation_id: '1' }), ...SEIS];
    const r = await rodar();
    expect(r.status).toBe(200);
    expect(enfileirarPublicacoes).not.toHaveBeenCalled();
  });
});

// Cada indicador de "algo no ar" bloqueia sozinho o reenfileiramento — no pré-check e no reativo.
// As 6 cores ficam ancoradas numa partição SEM item (CREATE), então o que está no ar nunca é
// tocado neste attempt (particaoNoAr segue false): só `nadaNoAr` pode barrar.
const SEIS_ANCORADAS = Object.fromEntries(SEIS.map((v) => [v.codigo as string, {}]));
const cenarios: Array<[string, () => void]> = [
  ['só familia.ml_item_id', () => {
    f.familia = { ...FAMILIA, ml_item_id: 'MLB0' };
    f.linhas = [{ particao: 1, item_externo_id: null, variacoes_externas: SEIS_ANCORADAS }];
    f.variacoes = [...SEIS];
  }],
  ['só linha com item_externo_id em partição ≠ 0', () => {
    f.linhas = [
      { particao: 0, item_externo_id: null, variacoes_externas: SEIS_ANCORADAS },
      { particao: 1, item_externo_id: 'MLB9', variacoes_externas: { Z: {} } },
    ];
    f.variacoes = [...SEIS, cor('Z', 'Zinco', 20, { ml_variation_id: '9' })];
  }],
];

describe.each(cenarios)('publicar-split-ml — algo no ar (%s)', (_nome, montar) => {
  it('pré-check não reenfileira com cache user_products', async () => {
    montar();
    vi.mocked(lerFormatoPublicacao).mockResolvedValue('user_products');
    f.formatoIncompativel = false;
    const r = await rodar();
    expect(r.status).toBe(200);
    expect(enfileirarPublicacoes).not.toHaveBeenCalled();
    expect(f.criados.length).toBeGreaterThan(0);
  });

  it('reativo não reenfileira: erro "já está no ar", sem retry', async () => {
    montar();
    const r = await rodar();
    expect(r.status).toBe(200);
    expect(f.criados.map((a) => a.variacoes.length)).toEqual([6]);
    expect(enfileirarPublicacoes).not.toHaveBeenCalled();
    expect(String(statusErro()?.patch.erro_mensagem)).toContain('já está no ar');
    expect(talvezFinalizarLote).toHaveBeenCalledWith(expect.anything(), 'lote-1');
  });
});

describe('publicar-split-ml — falha na leitura de anuncios_externos', () => {
  it('retenta (500) sem enqueue, foto nem POST', async () => {
    vi.mocked(lerFormatoPublicacao).mockResolvedValue('user_products');
    f.erroLinhas = true;
    f.variacoes = f.variacoes.map((v) => ({ ...v, ml_picture_id: null }));
    const r = await rodar();
    expect(r.status).toBe(500);
    expect(enfileirarPublicacoes).not.toHaveBeenCalled();
    expect(lerFormatoPublicacao).not.toHaveBeenCalled();
    expect(f.criados).toEqual([]);
    expect(f.subirFoto).not.toHaveBeenCalled();
    expect(statusErro()).toBeUndefined();
  });
});
