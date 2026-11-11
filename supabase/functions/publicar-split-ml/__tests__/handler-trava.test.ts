// ADR-0201 Task 14 — split × trava de escrita por MLB: trava todas as partições no ar antes de qualquer upload/GET/PUT,
// adia sem escrever em conflito (200), estende a trava antes do PUT de CADA partição e só solta no fim.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Linha = Record<string, unknown>;
const f = vi.hoisted(() => ({
  serve: vi.fn(),
  variacoes: [] as Linha[],
  linhas: [] as Linha[],
  familia: {} as Linha,
  eventos: [] as string[],
  updatesFamilia: [] as Linha[],
  reserva: { tipo: 'livre', dono: 'dono-split', posseAdiada: null } as Record<string, unknown>,
  reservar: vi.fn(),
  acordar: vi.fn(async () => {}),
  criarFormatoUp: false,
}));

function builder(tabela: string) {
  const resolver = () => {
    if (tabela === 'familias') return { data: { ...f.familia, organizations: { modulos_habilitados: [] } }, error: null };
    if (tabela === 'variacoes') return { data: f.variacoes, error: null };
    if (tabela === 'anuncios_externos') return { data: f.linhas, error: null };
    if (tabela === 'lotes') return { data: { origem: 'planilha' }, error: null };
    return { data: [], error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q, eq: () => q, in: () => q, is: () => q, upsert: () => q,
    update: (p: Linha) => { if (tabela === 'familias') f.updatesFamilia.push(p); return q; },
    single: async () => resolver(), maybeSingle: async () => resolver(),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, ko),
  };
  return q;
}

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/supabase.ts', () => ({
  adminClient: () => ({
    from: (t: string) => builder(t),
    rpc: async (n: string) => {
      if (n === 'ml_estender_trava') { f.eventos.push('estender'); return { data: true, error: null }; }
      if (n === 'ml_soltar_itens') { f.eventos.push('soltar'); return { data: 1, error: null }; }
      return { data: n === 'kit_skus_participantes' ? [] : null, error: null };
    },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'u' }, error: null }) }) },
  }),
}));
vi.mock('../../_shared/queue.ts', () => ({
  verificarAssinatura: async () => true,
  enfileirarVinculacaoCatalogo: vi.fn(async () => {}),
  enfileirarSincronizacaoFiscal: vi.fn(async () => {}),
  enfileirarConfirmacao: vi.fn(async () => {}),
  enfileirarJobPublicacaoML: vi.fn(async () => 'm'),
  enfileirarPublicacoes: vi.fn(async () => ['m']),
}));
vi.mock('../../_shared/ml/formato-publicacao.ts', () => ({
  formatoRepoSupabase: () => ({}),
  lerFormatoPublicacao: async () => 'desconhecido',
  confirmarFormatoPublicacao: async () => {},
}));
vi.mock('../../_shared/ml/trava-item.ts', async (original) => {
  const real = await original<typeof import('../../_shared/ml/trava-item')>();
  return { ...real, reservarEscrita: f.reservar, acordarEscritaAdiada: f.acordar };
});
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'tok' }));
vi.mock('../../_shared/canais/conexao.ts', () => ({ resolverConexao: async () => ({ id: 'conn-1' }) }));
vi.mock('../../_shared/ai/modelos.ts', () => ({ resolverModeloTexto: async () => 'modelo' }));
vi.mock('../../_shared/publicacao/guard-reajuste.ts', () => ({ exigirSemReajusteAtivo: async () => {} }));
vi.mock('../../_shared/fiscal/gate.ts', () => ({ exigirFiscalCompletoSePreciso: async () => false }));
vi.mock('../../_shared/lote/finalizar.ts', () => ({ talvezFinalizarLote: async () => {} }));
vi.mock('../../_shared/anuncios/espelhar.ts', () => ({ espelharAnuncioExterno: async () => {} }));
vi.mock('../../_shared/confirmacao/registrar.ts', () => ({
  agendarConfirmacao: async () => {}, registrarConfirmacao: async () => {},
  itemConfirmarCriado: () => null, itemConfirmarLegacy: () => null,
}));
vi.mock('../../_shared/canais/registry.ts', () => ({
  getConnector: () => ({
    garantirDescricao: async () => {},
    subirFoto: async () => { f.eventos.push('subirFoto'); return 'FOTO'; },
    lerStatus: async () => { f.eventos.push('lerStatus'); return {}; },
    criarAnuncio: async () => {
      f.eventos.push('criar');
      if (f.criarFormatoUp) {
        return { ok: false, erro: { codigo: 'FORMATO_INCOMPATIVEL', mensagemOperador: 'item plano', retentavel: false } };
      }
      return { ok: true, valor: { itemExternoId: 'MLBN', variacoesExternas: {} } };
    },
    atualizarAnuncio: async (_c: unknown, a: { itemExternoId: string; antesDoPut?: () => Promise<boolean> }) => {
      f.eventos.push(`GET:${a.itemExternoId}`);
      if (a.antesDoPut && !(await a.antesDoPut())) return { ok: false, erro: { codigo: 'DESCONHECIDO', mensagemOperador: 'x', retentavel: false, status: 409 } };
      f.eventos.push(`PUT:${a.itemExternoId}`);
      return { ok: true, valor: { variacoesExternas: {} } };
    },
  }),
}));

import { enfileirarPublicacoes } from '../../_shared/queue.ts';

let handler: (req: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => 'http://localhost' } });
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});

const cor = (codigo: string, nome: string, preco: number, over: Linha = {}): Linha => ({
  id: codigo, codigo, cor: nome, estoque: 5, preco_publicacao: preco, preco_publicado_ml: preco, gtin: null,
  ml_picture_id: 'P', ml_variation_id: '1', ...over,
});

beforeEach(() => {
  f.familia = { id: 'fam-1', org_id: 'org-1', user_id: 'user-1', codigo_pai: '000', status: 'publicando', ml_item_id: 'MLB0',
    titulo_ml: 'T', nome_pai: 'N', descricao_ml: null, categoria_ml_id: 'MLB1', atributos_ml: [], tipo_aviamento: 'outro',
    atributos_faltantes: [] };
  f.linhas = [
    { particao: 0, item_externo_id: 'MLB0', variacoes_externas: { A: {} }, titulo: 'T' },
    { particao: 1, item_externo_id: 'MLB1', variacoes_externas: { B: {} }, titulo: 'T2' },
  ];
  f.variacoes = [cor('A', 'Azul', 10), cor('B', 'Rosa', 20)];
  f.eventos = []; f.updatesFamilia = [];
  f.reservar.mockReset();
  f.reservar.mockImplementation(async () => f.reserva);
  f.reserva = { tipo: 'livre', dono: 'dono-split', posseAdiada: null };
  f.acordar.mockClear();
  f.criarFormatoUp = false;
  vi.mocked(enfileirarPublicacoes).mockClear();
});

const rodar = async (job: Linha = {}) => handler(new Request('http://localhost', {
  method: 'POST', body: JSON.stringify({ familia_id: 'fam-1', lote_id: 'lote-1', ...job }),
}));

describe('publicar-split-ml — trava de escrita (ADR-0201)', () => {
  it('cor nova numa partição com item travado → nenhum upload, GET nem PUT; 200; família continua publicando', async () => {
    f.variacoes = [cor('A', 'Azul', 10), cor('B', 'Rosa', 20), cor('C', 'Verde', 20, { ml_variation_id: null, ml_picture_id: null, imagem_path: 'x.jpg' })];
    f.reserva = { tipo: 'adiada', adiadaId: 'ad1' };
    const r = await rodar();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ adiado: true });
    expect(f.reservar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      orgId: 'org-1', familiaId: 'fam-1', loteId: 'lote-1', endpoint: 'publicar-split-ml', itens: ['MLB0', 'MLB1'],
    }));
    expect(f.eventos).toEqual([]);
    expect(f.updatesFamilia.filter((u) => 'status' in u)).toEqual([]);
  });

  it('2 partições sequenciais → cada PUT estende a trava antes de sair; solta só no fim', async () => {
    const r = await rodar();
    expect(r.status).toBe(200);
    expect(f.eventos).toEqual(['GET:MLB0', 'estender', 'PUT:MLB0', 'GET:MLB1', 'estender', 'PUT:MLB1', 'soltar']);
  });

  it('somenteEstoque sem cor nova → dispensado (não reserva)', async () => {
    await rodar({ somenteEstoque: true });
    expect(f.reservar).not.toHaveBeenCalled();
    expect(f.eventos.filter((e) => e.startsWith('PUT'))).toHaveLength(2);
  });

  it('falha ao gravar o adiamento → 5xx (a mensagem original repete)', async () => {
    f.reservar.mockImplementation(async () => { throw new Error('gravar escrita adiada: boom'); });
    expect((await rodar()).status).toBe(500);
    expect(f.eventos).toEqual([]);
  });

  it('mensagem de acordar → só a retomada da linha (nunca o conector)', async () => {
    const r = await rodar({ acordar: true, adiada_id: 'ad1' });
    expect(r.status).toBe(200);
    expect(f.acordar).toHaveBeenCalledWith(expect.anything(), 'ad1', expect.objectContaining({ base: 'http://localhost' }));
    expect(f.reservar).not.toHaveBeenCalled();
    expect(f.eventos).toEqual([]);
  });

  // ADR-0160 × ADR-0201 (merge 11/11): o catch solta a trava antes de qualquer saída, inclusive o reroteamento UP.
  it('FORMATO_INCOMPATIVEL com trava adquirida e antes de qualquer PUT → solta a trava; não reroteia (parte no ar)', async () => {
    f.familia = { ...f.familia, ml_item_id: null };
    // Partição 0 ancorada mas ainda sem item (CREATE) vem antes da 1, já no ar: o POST falha antes de qualquer PUT.
    f.linhas = [
      { particao: 0, item_externo_id: null, variacoes_externas: { A: {}, A2: {} }, titulo: 'T' },
      { particao: 1, item_externo_id: 'MLB1', variacoes_externas: { B: {} }, titulo: 'T2' },
    ];
    f.variacoes = [cor('A', 'Azul', 10, { ml_variation_id: null }), cor('A2', 'Bege', 10, { ml_variation_id: null }), cor('B', 'Rosa', 20)];
    f.criarFormatoUp = true;
    const r = await rodar();
    expect(r.status).toBe(200);
    expect(f.reservar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ itens: ['MLB1'] }));
    expect(f.eventos).toEqual(['criar', 'soltar']);
    expect(enfileirarPublicacoes).not.toHaveBeenCalled();
    expect(f.updatesFamilia.find((u) => u.status === 'erro')?.erro_mensagem).toMatch(/anúncio antigo/);
  });

  it('FORMATO_INCOMPATIVEL sem nada no ar → reroteia ao publish sem reservar trava (nada a travar)', async () => {
    f.familia = { ...f.familia, ml_item_id: null };
    f.linhas = [];
    f.variacoes = [cor('A', 'Azul', 10, { ml_variation_id: null }), cor('A2', 'Bege', 10, { ml_variation_id: null })];
    f.criarFormatoUp = true;
    const r = await rodar();
    expect(await r.json()).toEqual({ ok: true, reroteado: 'publish' });
    expect(f.reservar).not.toHaveBeenCalled();
    expect(f.eventos).toEqual(['criar']);
    expect(enfileirarPublicacoes).toHaveBeenCalledWith([expect.objectContaining({ alvo: 'publish' })], 'user-1');
  });
});
