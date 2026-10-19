// ADR-0187 (+ lacuna D-7 do ADR-0135): o worker do split passa pelo gate fiscal ANTES de qualquer
// escrita no ML. NCM fora da tabela oficial → erro definitivo (200, família 'erro', sem retry);
// falha lendo a tabela → transitório (500, QStash retenta, família continua 'publicando').
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  serve: vi.fn(),
  ncm: 'vencido' as 'vigente' | 'vencido' | 'erro',
  escritas: [] as Array<{ tabela: string; payload: Record<string, unknown> }>,
  chamadasML: [] as string[],
  rpcs: [] as string[],
  variacoes: [] as Record<string, unknown>[],
  linhas: [] as Record<string, unknown>[],
}));

const FAMILIA = {
  id: 'fam-1', user_id: 'user-1', org_id: 'org-1', codigo_pai: '00000010', nome_pai: 'TECIDO',
  status: 'publicando', tipo_aviamento: 'outro', atributos_ml: [], categoria_ml_id: 'MLB1',
  atributos_faltantes: [], unidade: 'UN', origem: 'nacional', ncm: '39269090', cest: null,
  origem_nfe: 0, fci: null, ex_tipi: null, tributacao_icms: '102', tributacao_icms_regime: 'simples',
};

function builder(tabela: string) {
  let payload: Record<string, unknown> | null = null;
  const ler = () => {
    if (tabela === 'familias') return FAMILIA;
    if (tabela === 'organizations') return { modulos_habilitados: ['fiscal'] };
    if (tabela === 'empresa_fiscal') return { regime_tributario: 'simples' };
    if (tabela === 'variacoes') return f.variacoes; // vazio: gate passou → "Sem cores incluídas" (400)
    if (tabela === 'anuncios_externos') return f.linhas;
    return null;
  };
  const resolver = () => {
    if (payload) { f.escritas.push({ tabela, payload }); return { data: null, error: null }; }
    return { data: ler(), error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q, eq: () => q, in: () => q, is: () => q,
    update: (p: Record<string, unknown>) => { payload = p; return q; },
    single: async () => resolver(),
    maybeSingle: async () => resolver(),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, ko),
  };
  return q;
}

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/queue.ts', () => ({
  verificarAssinatura: vi.fn(async () => true),
  enfileirarVinculacaoCatalogo: vi.fn(async () => { f.chamadasML.push('enfileirarVinculacaoCatalogo'); }),
}));
vi.mock('../../_shared/supabase.ts', () => ({
  adminClient: () => ({
    from: (t: string) => builder(t),
    rpc: async (nome: string, args: { p_codigos?: string[] }) => {
      f.rpcs.push(nome);
      if (nome !== 'ncm_consultar') return { data: null, error: null }; // reajuste_ativo_produto: nenhum
      if (f.ncm === 'erro') return { data: null, error: { message: 'fora do ar' } };
      return { data: (args.p_codigos ?? []).map((codigo) => ({ codigo, vigente: f.ncm === 'vigente' })), error: null };
    },
    storage: { from: () => ({ createSignedUrl: async () => { f.chamadasML.push('createSignedUrl'); return { data: null, error: null }; } }) },
  }),
}));
vi.mock('../../_shared/canais/conexao.ts', () => ({ resolverConexao: vi.fn(async () => ({ id: 'cx-1' })) }));
vi.mock('../../_shared/ml/token.ts', () => ({
  getValidAccessTokenConexao: vi.fn(async () => { f.chamadasML.push('getToken'); return 'tok'; }),
}));
vi.mock('../../_shared/ai/modelos.ts', () => ({ resolverModeloTexto: vi.fn(async () => 'modelo') }));
vi.mock('../../_shared/lote/finalizar.ts', () => ({ talvezFinalizarLote: vi.fn(async () => {}) }));
// Qualquer método do conector conta como chamada ao ML.
vi.mock('../../_shared/canais/registry.ts', () => ({
  getConnector: () => new Proxy({}, {
    get: (_t, nome: string) => async () => { f.chamadasML.push(nome); throw new Error(`ML chamado: ${nome}`); },
  }),
}));

let handler: (req: Request) => Promise<Response>;
let fetchSpy: ReturnType<typeof vi.fn>;
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => 'http://localhost' } });
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});
beforeEach(() => {
  f.ncm = 'vencido'; f.escritas = []; f.chamadasML = []; f.rpcs = []; f.variacoes = []; f.linhas = [];
  fetchSpy = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetchSpy);
});

const post = (extra: Record<string, unknown> = {}) => handler(new Request('http://localhost', {
  method: 'POST', body: JSON.stringify({ familia_id: 'fam-1', lote_id: 'lote-1', ...extra }),
}));

// 100 cores já ancoradas na partição 0 (+ opcionalmente 1 nova, que exige partição nova).
const cor = (i: number) => ({
  id: `v${i}`, codigo: `C${i}`, cor: `Cor ${i}`, estoque: 1, preco_publicacao: 10, preco_publicado_ml: 10,
  ml_picture_id: `PIC${i}`, imagem_path: null, gtin: null, ml_variation_id: i < 100 ? `VAR${i}` : null,
});
function cenarioSomenteEstoque(comCorNova: boolean) {
  const ancoradas = Array.from({ length: 100 }, (_, i) => cor(i));
  f.variacoes = comCorNova ? [...ancoradas, cor(100)] : ancoradas;
  f.linhas = [{
    particao: 0, item_externo_id: 'MLB-P0', permalink: null, titulo: 'T', atacado_status: null,
    variacoes_externas: Object.fromEntries(ancoradas.map((v) => [v.codigo, { id: v.ml_variation_id }])),
  }];
}

describe('publicar-split-ml — gate fiscal / NCM na tabela oficial (ADR-0187)', () => {
  it('NCM vencido → erro definitivo (200, família erro com a copy), zero chamadas ao ML', async () => {
    const r = await post();
    expect(r.status).toBe(200);
    const erro = f.escritas.find((w) => w.tabela === 'familias' && w.payload.status === 'erro');
    expect(erro?.payload.erro_mensagem).toMatch(/NCM 39269090 não está mais vigente/);
    expect(f.chamadasML).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('erro lendo ncm_consultar → transitório (500), família não marcada erro, zero chamadas ao ML', async () => {
    f.ncm = 'erro';
    const r = await post();
    expect(r.status).toBe(500);
    expect(f.escritas).toEqual([]);
    expect(f.chamadasML).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('NCM vigente → gate passa (segue para as variações), sem chamar o ML até aí', async () => {
    f.ncm = 'vigente';
    const r = await post();
    expect(r.status).toBe(200);
    const erro = f.escritas.find((w) => w.tabela === 'familias' && w.payload.status === 'erro');
    expect(erro?.payload.erro_mensagem).toBe('Sem cores incluídas para publicar');
    expect(f.chamadasML).toEqual([]);
  });

  it('fix r1: somenteEstoque com cor nova (partição nova = CREATE) + NCM vencido → definitivo, zero chamadas ao ML', async () => {
    cenarioSomenteEstoque(true);
    const r = await post({ somenteEstoque: true });
    expect(r.status).toBe(200);
    const erro = f.escritas.find((w) => w.tabela === 'familias' && w.payload.status === 'erro');
    expect(erro?.payload.erro_mensagem).toMatch(/NCM 39269090 não está mais vigente/);
    expect(f.chamadasML).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fix r1: somenteEstoque só com cores já ancoradas (nenhuma criação) → gate fiscal não roda', async () => {
    cenarioSomenteEstoque(false);
    await post({ somenteEstoque: true });
    expect(f.rpcs).not.toContain('ncm_consultar');
  });

  it('fix r1: somenteEstoque com cores ancoradas numa partição SEM item no ML (criação pendente) → gate roda', async () => {
    cenarioSomenteEstoque(false);
    f.linhas[0].item_externo_id = null;
    const r = await post({ somenteEstoque: true });
    expect(r.status).toBe(200);
    const erro = f.escritas.find((w) => w.tabela === 'familias' && w.payload.status === 'erro');
    expect(erro?.payload.erro_mensagem).toMatch(/NCM 39269090 não está mais vigente/);
    expect(f.chamadasML).toEqual([]);
  });
});
