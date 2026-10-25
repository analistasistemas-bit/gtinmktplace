// Fronteira HTTP da edge `extensao` (ADR-0092/0189 D-18): sessão, módulo, limite, payload, vínculo,
// erro de leitura e sigilo do token ML — handler real com dependências controladas.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireUserOrg } from '../../_shared/auth.ts';
import { exigirModulo } from '../../_shared/produto/modulo.ts';
import { resolverConexao } from '../../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../../_shared/ml/token.ts';
import { buscarListingPrice } from '../../_shared/ml/listing-prices.ts';
import { buscarFreteVendedorComProveniencia } from '../../_shared/ml/frete.ts';
import { mlGet } from '../../_shared/ml/http.ts';
import { buscarPerfilVendedor } from '../../_shared/ml/perfil-vendedor.ts';
import { redisIncrComTTL, redisSet } from '../../_shared/redis/client.ts';

type Contexto = { userId: string; orgId: string; isAdmin: boolean; support: null | { requestId: string; scope: 'read' | 'full' } };

const f = vi.hoisted(() => ({
  serve: vi.fn(),
  contexto: null as unknown as Contexto,
  ops: [] as { tabela: string; op: string; valor?: unknown }[],
  /** variação existe na org? (salvar_vinculo) */
  variacaoExiste: true,
  falharEscrita: false,
  /** mensagem de erro de qualquer leitura do banco (null = sem erro) */
  erroDb: null as string | null,
  rpcs: [] as { fn: string; args: unknown }[],
  froms: [] as string[],
  /** linha devolvida por maybeSingle por tabela (sobrepõe o padrão de variação) */
  linhas: {} as Record<string, unknown>,
  eqs: [] as [string, string, unknown][],
  /** linhas devolvidas por consultas em lista (await da query) por tabela */
  dados: {} as Record<string, unknown[]>,
}));

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/auth.ts', () => ({ requireUserOrg: vi.fn(async () => f.contexto) }));
vi.mock('../../_shared/produto/modulo.ts', () => ({ exigirModulo: vi.fn(async () => true) }));
vi.mock('../../_shared/canais/conexao.ts', () => ({ resolverConexao: vi.fn(async () => null) }));
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: vi.fn() }));
vi.mock('../../_shared/ml/listing-prices.ts', async (orig) => ({ ...(await orig<object>()), buscarListingPrice: vi.fn() }));
vi.mock('../../_shared/ml/frete.ts', () => ({ buscarFreteVendedorComProveniencia: vi.fn() }));
vi.mock('../../_shared/ml/http.ts', () => ({ mlGet: vi.fn() }));
vi.mock('../../_shared/ml/perfil-vendedor.ts', () => ({ buscarPerfilVendedor: vi.fn(async () => null) }));
vi.mock('../../_shared/redis/client.ts', () => ({ redisGet: vi.fn(), redisSet: vi.fn(), redisIncrComTTL: vi.fn(async () => 1) }));
vi.mock('../../_shared/supabase.ts', () => ({
  adminClient: () => ({
    rpc: async (fn: string, args: unknown) => { f.rpcs.push({ fn, args }); return { error: null }; },
    from: (tabela: string) => {
      f.froms.push(tabela);
      let op = 'select';
      let valor: unknown;
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => { f.eqs.push([tabela, col, v]); return q; },
        order: () => q,
        limit: () => q,
        ilike: () => q,
        in: () => q,
        upsert: (v: unknown) => { op = 'upsert'; valor = v; return q; },
        insert: (v: unknown) => { op = 'insert'; valor = v; f.ops.push({ tabela, op, valor }); return Promise.resolve({ error: null }); },
        delete: () => { op = 'delete'; return q; },
        maybeSingle: () => Promise.resolve(f.erroDb ? { data: null, error: { message: f.erroDb } }
          : tabela in f.linhas ? { data: f.linhas[tabela], error: null }
          : { data: f.variacaoExiste ? { id: 'v' } : null, error: null }),
        then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
          f.ops.push({ tabela, op, valor });
          const error = f.falharEscrita ? { message: 'boom' } : null;
          const data = op === 'delete' ? [{ variacao_id: '0b7c6a2e-3c1d-4b5a-9f00-000000000002' }] : f.dados[tabela] ?? null;
          return Promise.resolve({ data, error }).then(ok, ko);
        },
      };
      return q;
    },
  }),
}));

let handler: (req: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve });
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});

const VAR = '0b7c6a2e-3c1d-4b5a-9f00-000000000001';
const chave = { tipo: 'catalogo', valor: 'MLB777' };
const SALVAR = { acao: 'salvar_vinculo', chave, variacaoId: VAR };
const REMOVER = { acao: 'remover_vinculo', chave };
const post = (body: unknown) => handler(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }));
const suporte = (scope: 'read' | 'full'): Contexto => ({ userId: 'admin-1', orgId: 'org-1', isAdmin: false, support: { requestId: 'req-1', scope } });
const auditorias = () => f.ops.filter((o) => o.tabela === 'support_audit_events').map((o) => o.valor);
const escritas = () => f.ops.filter((o) => o.tabela === 'extensao_vinculos');

beforeEach(() => {
  f.ops.length = 0;
  f.variacaoExiste = true;
  f.falharEscrita = false;
  f.erroDb = null;
  f.rpcs.length = 0;
  f.froms.length = 0;
  f.linhas = {};
  f.eqs.length = 0;
  f.dados = {};
  vi.clearAllMocks();
  vi.mocked(requireUserOrg).mockImplementation(async () => f.contexto);
  vi.mocked(exigirModulo).mockResolvedValue(true);
  vi.mocked(resolverConexao).mockResolvedValue(null);
  vi.mocked(redisIncrComTTL).mockResolvedValue(1);
  f.contexto = { userId: 'user-1', orgId: 'org-1', isAdmin: false, support: null };
});

describe('extensao — auditoria de suporte nas escritas de vínculo', () => {
  it('sem suporte: grava e não audita', async () => {
    expect((await post(SALVAR)).status).toBe(200);
    expect(escritas().map((o) => o.op)).toEqual(['upsert']);
    expect(auditorias()).toEqual([]);
  });

  it('suporte full: salvar audita ação, alvo (chave + variação) e sucesso', async () => {
    f.contexto = suporte('full');
    expect((await post(SALVAR)).status).toBe(200);
    expect(auditorias()).toEqual([{
      org_id: 'org-1', support_request_id: 'req-1', actor_id: 'admin-1', event: 'operation',
      target_type: 'extensao_vinculo:salvar', target_id: `catalogo:MLB777:${VAR}`, result: 'succeeded',
    }]);
  });

  it('suporte full: remover audita com a variação que estava vinculada', async () => {
    f.contexto = suporte('full');
    expect((await post(REMOVER)).status).toBe(200);
    expect(auditorias()).toMatchObject([{
      target_type: 'extensao_vinculo:remover', target_id: 'catalogo:MLB777:0b7c6a2e-3c1d-4b5a-9f00-000000000002', result: 'succeeded',
    }]);
  });

  it('suporte full: falha na escrita audita failed e responde interno', async () => {
    f.contexto = suporte('full');
    f.falharEscrita = true;
    const r = await post(SALVAR);
    expect(r.status).toBe(500);
    expect(auditorias()).toMatchObject([{ target_type: 'extensao_vinculo:salvar', result: 'failed' }]);
  });

  it('suporte full: variação de outra org → payload_invalido e audita failed', async () => {
    f.contexto = suporte('full');
    f.variacaoExiste = false;
    expect((await post(SALVAR)).status).toBe(400);
    expect(escritas().map((o) => o.op)).not.toContain('upsert');
    expect(auditorias()).toMatchObject([{ target_id: `catalogo:MLB777:${VAR}`, result: 'failed' }]);
  });

  it.each([['salvar', SALVAR], ['remover', REMOVER]])('suporte só leitura: %s negado (403 interno), sem escrita, auditado denied', async (acao, body) => {
    f.contexto = suporte('read');
    const r = await post(body);
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ erro: 'interno' });
    expect(escritas()).toEqual([]);
    expect(auditorias()).toMatchObject([{ target_type: `extensao_vinculo:${acao}`, target_id: acao === 'salvar' ? `catalogo:MLB777:${VAR}` : 'catalogo:MLB777', result: 'denied' }]);
  });

  it('suporte só leitura continua podendo ler (analisar não é escrita, não audita)', async () => {
    f.contexto = suporte('read');
    const r = await post({ acao: 'buscar_sku', termo: 'abc' });
    expect(r.status).toBe(200);
    expect(auditorias()).toEqual([]);
  });
});

describe('extensao — quantidade por anúncio (D-8)', () => {
  it('anúncio fora de catálogo: unidades não confirmadas (null), nunca 1', async () => {
    const r = await post({ acao: 'analisar_anuncio', tipoPagina: 'anuncio', mlItemId: 'MLB1', sellerId: '9', catalogProductId: null, categoriaId: 'MLB5', preco: 100, eanDaBusca: null });
    expect(r.status).toBe(200);
    expect((await r.json()).custo).toMatchObject({ unidadesPorPacote: null });
  });
});

const ANALISAR = { acao: 'analisar_anuncio', tipoPagina: 'anuncio', mlItemId: 'MLB1', sellerId: '9', catalogProductId: 'MLB42', categoriaId: 'MLB5', preco: 100, eanDaBusca: null };
const chamouMLouDb = () =>
  vi.mocked(resolverConexao).mock.calls.length + vi.mocked(getValidAccessTokenConexao).mock.calls.length
  + vi.mocked(buscarListingPrice).mock.calls.length + vi.mocked(mlGet).mock.calls.length + f.froms.length + f.rpcs.length;

describe('extensao — sessão e módulo antes de qualquer ML/banco', () => {
  it('sessão expirada (401 do auth) → 401 sessao_expirada', async () => {
    vi.mocked(requireUserOrg).mockRejectedValue(new Response('{}', { status: 401 }));
    const r = await post(ANALISAR);
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ erro: 'sessao_expirada' });
    expect(exigirModulo).not.toHaveBeenCalled();
    expect(chamouMLouDb()).toBe(0);
  });

  it('sessão de suporte expirada (403 + x-motivo) → 403 sessao_suporte_expirada', async () => {
    vi.mocked(requireUserOrg).mockRejectedValue(new Response('{}', { status: 403, headers: { 'x-motivo': 'sessao_suporte' } }));
    const r = await post(ANALISAR);
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ erro: 'sessao_suporte_expirada' });
    expect(chamouMLouDb()).toBe(0);
  });

  it('payload inválido não mascara sessão expirada', async () => {
    vi.mocked(requireUserOrg).mockRejectedValue(new Response('{}', { status: 401 }));
    const r = await handler(new Request('http://x', { method: 'POST', body: 'não é json' }));
    expect(r.status).toBe(401);
  });

  it('módulo desligado → 403 modulo_desligado, sem ML nem banco', async () => {
    vi.mocked(exigirModulo).mockResolvedValue(false);
    const r = await post(ANALISAR);
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ erro: 'modulo_desligado' });
    expect(exigirModulo).toHaveBeenCalledWith(expect.anything(), 'org-1', 'extensao');
    expect(redisIncrComTTL).not.toHaveBeenCalled();
    expect(chamouMLouDb()).toBe(0);
  });

  it.each([
    ['corpo não-JSON', 'xx'],
    ['ação desconhecida', JSON.stringify({ acao: 'publicar' })],
    ['preço zero', JSON.stringify({ ...ANALISAR, preco: 0 })],
    ['variacaoId não-UUID', JSON.stringify({ ...SALVAR, variacaoId: '1' })],
  ])('payload_invalido: %s → 400, sem ML nem banco', async (_, body) => {
    const r = await handler(new Request('http://x', { method: 'POST', body }));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ erro: 'payload_invalido' });
    expect(chamouMLouDb()).toBe(0);
  });
});

describe('extensao — limite de 30 análises/min (D-18)', () => {
  it('31º pedido do minuto → 429 com a mensagem exata, sem análise', async () => {
    const contagem = new Map<string, number>();
    vi.mocked(redisIncrComTTL).mockImplementation(async (k) => { contagem.set(k, (contagem.get(k) ?? 0) + 1); return contagem.get(k)!; });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T12:00:10Z'));
    try {
      for (let i = 1; i <= 30; i++) expect((await post(ANALISAR)).status).toBe(200);
      const chamadas = vi.mocked(resolverConexao).mock.calls.length;
      const r = await post(ANALISAR);
      expect(r.status).toBe(429);
      expect(await r.json()).toEqual({ erro: 'limite', mensagem: 'Muitas análises em sequência. Aguarde um minuto.' });
      expect(vi.mocked(resolverConexao).mock.calls.length).toBe(chamadas);
      expect(vi.mocked(redisIncrComTTL).mock.calls.at(-1)).toEqual(['ext:rl:user-1:202610221200', 120]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('o limite é por análise: buscar_sku não consome a janela', async () => {
    await post({ acao: 'buscar_sku', termo: 'abc' });
    expect(redisIncrComTTL).not.toHaveBeenCalled();
  });
});

describe('extensao — salvar_vinculo', () => {
  it('variação de outra org → 400 payload_invalido, sem upsert (usuário comum)', async () => {
    f.variacaoExiste = false;
    const r = await post(SALVAR);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ erro: 'payload_invalido' });
    expect(escritas().map((o) => o.op)).not.toContain('upsert');
  });
});

describe('extensao — erro_leitura', () => {
  const ERRO = { acao: 'erro_leitura', tipoPagina: 'anuncio', mlItemId: 'MLB9', versao: '0.1.0', motivo: 'campo_ausente:preco' };

  it('registra via RPC (dedupe no banco) só com ID, tipo, versão e motivo', async () => {
    const r = await post(ERRO);
    expect(r.status).toBe(200);
    expect(f.rpcs).toEqual([{ fn: 'extensao_registrar_erro', args: { p_org_id: 'org-1', p_tipo: 'anuncio', p_versao: '0.1.0', p_motivo: 'campo_ausente:preco', p_ml_item_id: 'MLB9' } }]);
    expect(vi.mocked(redisIncrComTTL).mock.calls[0][0]).toMatch(/^ext:rl-erro:user-1:\d{10}$/);
    expect(vi.mocked(redisIncrComTTL).mock.calls[0][1]).toBe(3600);
  });

  it('acima de 20/h: 200 ok em silêncio, sem gravar', async () => {
    vi.mocked(redisIncrComTTL).mockResolvedValue(21);
    const r = await post(ERRO);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(f.rpcs).toEqual([]);
  });

  it('motivo fora do formato → payload_invalido (texto livre não é gravado)', async () => {
    const r = await post({ ...ERRO, motivo: 'título do concorrente' });
    expect(r.status).toBe(400);
    expect(f.rpcs).toEqual([]);
  });
});

describe('extensao — token ML e chave de serviço nunca saem do servidor', () => {
  const TOKEN = 'APP_USR-SENTINELA-TOKEN-ML';
  const SERVICE = 'SENTINELA-SERVICE-ROLE-KEY';

  beforeEach(() => {
    vi.mocked(resolverConexao).mockResolvedValue({ contaExternaId: 555, accessToken: TOKEN, refreshToken: `${TOKEN}-refresh` } as never);
    vi.mocked(getValidAccessTokenConexao).mockResolvedValue(TOKEN);
    vi.mocked(buscarListingPrice).mockResolvedValue({ sale_fee_amount: 12, sale_fee_details: { percentage_fee: 12, fixed_fee: 0 } });
    vi.mocked(buscarFreteVendedorComProveniencia).mockResolvedValue({ valor: 20, proveniencia: 'official' } as never);
    vi.mocked(mlGet).mockResolvedValue({ id: 'MLB42', attributes: [{ id: 'UNITS_PER_PACK', value_name: '1' }], token: TOKEN });
    vi.mocked(buscarPerfilVendedor).mockResolvedValue({
      seller_id: 9, nickname: 'LOJA X', nivel: '5_green', power_seller: 'gold', transactions_total: 50, uf: 'SP',
      detalhe: { transactions: { period: 'historic', total: 50, completed: null, canceled: null, ratings: { positive: null, neutral: null, negative: null } }, metrics: {} },
    });
  });

  it('análise com sucesso usa o token só nas chamadas ao ML', async () => {
    const r = await post(ANALISAR);
    expect(r.status).toBe(200);
    const corpo = await r.text();
    expect(buscarListingPrice).toHaveBeenCalledWith(TOKEN, 100, 'MLB5', 'gold_special');
    expect(corpo).not.toContain('SENTINELA');
    expect(JSON.parse(corpo).parametros.classico).toMatchObject({ estado: 'ok' });
    expect(buscarPerfilVendedor).toHaveBeenCalledWith(TOKEN, 9);
    expect(JSON.parse(corpo).vendedor).toEqual({ nickname: 'LOJA X', nivel: '5_green', medalha: 'gold', vendas: 50, periodo: null, uf: 'SP' });
  });

  it.each([
    ['ML lança com o token na mensagem', () => { vi.mocked(buscarListingPrice).mockRejectedValue(new Error(`401 Bearer ${TOKEN}`)); }],
    ['token lança com a chave de serviço', () => { vi.mocked(getValidAccessTokenConexao).mockRejectedValue(new Error(`${SERVICE} ${TOKEN}`)); }],
    ['banco falha com a chave de serviço', () => { f.erroDb = `JWT ${SERVICE} inválido`; }],
    ['auth lança Error com a chave', () => { vi.mocked(requireUserOrg).mockRejectedValue(new Error(SERVICE)); }],
  ])('%s → corpo sem sentinela', async (_, preparar) => {
    preparar();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await post(ANALISAR);
    spy.mockRestore();
    const corpo = await r.text();
    expect(corpo).not.toContain('SENTINELA');
    if (r.status !== 200) expect(JSON.parse(corpo)).toEqual({ erro: 'interno' });
  });
});

describe('extensao — catalogo (Task 23)', () => {
  const CAT = { acao: 'catalogo', catalogProductId: 'MLB32466350' };
  const TOKEN = 'APP_USR-SENTINELA-CATALOGO';

  it('sem conexão ML: indisponível, ainda debita o limite', async () => {
    const r = await post(CAT);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ estado: 'indisponivel', motivo: 'Conecte o Mercado Livre à organização' });
    expect(vi.mocked(redisIncrComTTL).mock.calls[0][0]).toMatch(/^ext:rl:user-1:/);
  });

  it('acima de 30/min: 429 limite, sem ir ao ML', async () => {
    vi.mocked(redisIncrComTTL).mockResolvedValue(31);
    const r = await post(CAT);
    expect(r.status).toBe(429);
    expect(mlGet).not.toHaveBeenCalled();
  });

  it('com conexão: vencedor do ML, nossa oferta, price-to-win e token fora da resposta', async () => {
    vi.mocked(resolverConexao).mockResolvedValue({ contaExternaId: 555, accessToken: TOKEN } as never);
    vi.mocked(getValidAccessTokenConexao).mockResolvedValue(TOKEN);
    vi.mocked(buscarPerfilVendedor).mockResolvedValue(null);
    vi.mocked(mlGet).mockImplementation(async (url: string) => {
      if (url.endsWith('/products/MLB32466350')) return { buy_box_winner: { item_id: 'MLB2', price: 90, seller_id: 7 } };
      if (url.includes('/products/MLB32466350/items')) {
        return { paging: { total: 2 }, results: [{ item_id: 'MLB2', seller_id: 7, price: 90 }, { item_id: 'MLB9', seller_id: 555, price: 95 }] };
      }
      if (url.includes('/items/MLB9/price_to_win')) return { status: 'competing', price_to_win: 89.9, current_price: 95 };
      return null;
    });
    const r = await post(CAT);
    const corpo = await r.text();
    expect(r.status).toBe(200);
    expect(corpo).not.toContain('SENTINELA');
    const j = JSON.parse(corpo);
    expect(j.estado).toBe('ok');
    expect(j.valor.vencedor).toEqual({ itemId: 'MLB2', sellerId: 7, preco: 90, origem: 'api' });
    expect(j.valor.participacao).toMatchObject({ estado: 'participa', itemId: 'MLB9', posicao: 2, ptw: { status: 'competing', precoParaGanhar: 89.9 } });
    expect(buscarPerfilVendedor).toHaveBeenCalledWith(TOKEN, 555);
    expect(f.rpcs).toContainEqual({ fn: 'extensao_registrar_uso', args: { p_org_id: 'org-1', p_user_id: 'user-1', p_tipo: 'catalogo' } });
  });

  it('buy_box_winner inválido + item da página: o perfil consultado é o do vendedor da página', async () => {
    vi.mocked(resolverConexao).mockResolvedValue({ contaExternaId: 555 } as never);
    vi.mocked(getValidAccessTokenConexao).mockResolvedValue(TOKEN);
    vi.mocked(buscarPerfilVendedor).mockResolvedValue(null);
    vi.mocked(mlGet).mockImplementation(async (url: string) => {
      if (url.endsWith('/products/MLB32466350')) return { buy_box_winner: { item_id: 'MLB2', price: 0, seller_id: 7 } };
      if (url.includes('/products/MLB32466350/items')) {
        return { paging: { total: 2 }, results: [{ item_id: 'MLB2', seller_id: 7, price: 90 }, { item_id: 'MLB3', seller_id: 8, price: 99 }] };
      }
      return null;
    });
    const j = await (await post({ ...CAT, itemDaPagina: 'MLB3' })).json();
    expect(j.valor.vencedor).toEqual({ itemId: 'MLB3', sellerId: 8, preco: 99, origem: 'pagina' });
    expect(vi.mocked(buscarPerfilVendedor).mock.calls.map((c) => c[1])).toEqual([8, 7]);
  });

  it('falha ao ler as ofertas: indisponível (nunca "ninguém vende")', async () => {
    vi.mocked(resolverConexao).mockResolvedValue({ contaExternaId: 555 } as never);
    vi.mocked(getValidAccessTokenConexao).mockResolvedValue(TOKEN);
    vi.mocked(mlGet).mockResolvedValue(null);
    expect(await (await post(CAT)).json()).toEqual({ estado: 'indisponivel', motivo: 'falha ao consultar o Mercado Livre' });
  });
});

describe('extensao — radar do Pulse (Task 18)', () => {
  const RADAR = { acao: 'radar', catalogProductId: 'MLB32466350' };
  const ADD = { acao: 'adicionar_radar', catalogProductId: 'MLB32466350' };
  const comConexao = () => {
    vi.mocked(resolverConexao).mockResolvedValue({ id: 'c1' } as never);
    vi.mocked(getValidAccessTokenConexao).mockResolvedValue('tok');
  };
  const fetchMl = vi.fn(async () => new Response(JSON.stringify({ name: 'Fone' }), { status: 200 }));
  beforeEach(() => { fetchMl.mockClear(); fetchMl.mockImplementation(async () => new Response(JSON.stringify({ name: 'Fone' }), { status: 200 })); vi.stubGlobal('fetch', fetchMl); });
  const pulseDesligado = () => vi.mocked(exigirModulo).mockImplementation(async (_a, _o, m) => m !== 'pulse');

  it('radar com módulo Pulse desligado: só {modulo:false}, sem ler as tabelas do Pulse', async () => {
    pulseDesligado();
    expect(await (await post(RADAR)).json()).toEqual({ modulo: false });
    expect(f.froms.filter((t) => t.startsWith('pulse_'))).toEqual([]);
  });

  it('adicionar com Pulse desligado: 403 modulo_desligado, sem ML; em suporte full, auditado denied', async () => {
    pulseDesligado();
    comConexao();
    f.contexto = suporte('full');
    expect((await post(ADD)).status).toBe(403);
    expect(fetchMl).not.toHaveBeenCalled();
    expect(auditorias()).toMatchObject([{ target_type: 'extensao_radar:adicionar', result: 'denied' }]);
  });

  it('Grok: sem conexão ML → indisponível, auditado failed, sem gastar a cota', async () => {
    f.contexto = suporte('full');
    expect(await (await post(ADD)).json()).toEqual({ estado: 'indisponivel', motivo: 'Conecte o Mercado Livre à organização' });
    expect(auditorias()).toMatchObject([{ result: 'failed' }]);
    expect(redisIncrComTTL).not.toHaveBeenCalled();
  });

  it('suporte só leitura: adicionar negado e auditado denied, sem ML nem escrita', async () => {
    f.contexto = suporte('read');
    comConexao();
    expect((await post(ADD)).status).toBe(403);
    expect(auditorias()).toMatchObject([{ target_type: 'extensao_radar:adicionar', target_id: 'MLB32466350', result: 'denied' }]);
    expect(fetchMl).not.toHaveBeenCalled();
  });

  it('suporte full: já no radar → ok jaExistia, auditado succeeded', async () => {
    f.contexto = suporte('full');
    comConexao();
    expect(await (await post(ADD)).json()).toEqual({ estado: 'ok', jaExistia: true });
    expect(auditorias()).toMatchObject([{ target_type: 'extensao_radar:adicionar', result: 'succeeded' }]);
  });

  it('ficha inexistente no ML: estado próprio, auditado failed, nada gravado', async () => {
    f.contexto = suporte('full');
    comConexao();
    fetchMl.mockImplementation(async () => new Response('{}', { status: 404 }));
    expect(await (await post(ADD)).json()).toEqual({ estado: 'ficha_inexistente' });
    expect(auditorias()).toMatchObject([{ result: 'failed' }]);
    expect(f.ops.filter((o) => o.tabela === 'pulse_produtos')).toEqual([]);
  });

  it('acima de 10 por hora: estado limite com o teto, auditado failed, sem ML', async () => {
    f.contexto = suporte('full');
    comConexao();
    vi.mocked(redisIncrComTTL).mockResolvedValue(11);
    expect(await (await post(ADD)).json()).toEqual({ estado: 'limite', maximoPorHora: 10 });
    expect(auditorias()).toMatchObject([{ result: 'failed' }]);
    expect(fetchMl).not.toHaveBeenCalled();
  });
});

describe('extensao — protocolo 2 (identidade, sessao, sem_acesso)', () => {
  const P2 = { protocolo: 2 };
  it('protocolo 2: sucesso vem em { identidade, dados }', async () => {
    const r = await post({ acao: 'buscar_sku', termo: 'abc', ...P2 });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ identidade: 'user-1:org-1:', dados: { itens: [] } });
    f.contexto = suporte('read');
    expect(await (await post({ acao: 'buscar_sku', termo: 'abc', ...P2 })).json())
      .toEqual({ identidade: 'admin-1:org-1:req-1', dados: { itens: [] } });
  });

  // Referência FIXA: snapshots gerados rodando este mesmo teste contra o handler de a08ae74a (antes do protocolo 2).
  it('sem protocolo: status e corpo idênticos aos da versão anterior (sucesso e erros)', async () => {
    const bruto = async (r: Promise<Response>) => { const x = await r; return { status: x.status, corpo: await x.text() }; };
    // identidadeEsperada sem protocolo é ignorada, como na 0.2.1.
    expect(await bruto(post({ ...ANALISAR, identidadeEsperada: 'outra:org:' }))).toMatchInlineSnapshot(`
      {
        "corpo": "{"proprio":false,"catalogoCriadoEm":null,"vendedor":null,"margem":{"preco":100,"classico":{"estado":"indisponivel","motivo":"Confirme as alíquotas de imposto em Configurações"},"premium":{"estado":"indisponivel","motivo":"Confirme as alíquotas de imposto em Configurações"}},"custo":{"fonte":"nenhuma","variacaoId":null,"codigo":null,"origem":null,"unidadesPorPacote":null,"unidadesSku":null,"custoSku":null,"fator":null,"faltaUnidades":null,"custoPacote":null},"parametros":{"aliquotas":{"confirmada":false,"nacional":null,"importado":null},"classico":{"estado":"indisponivel","motivo":"Conecte o Mercado Livre à organização"},"premium":{"estado":"indisponivel","motivo":"Conecte o Mercado Livre à organização"},"frete":{"estado":"indisponivel","motivo":"Conecte o Mercado Livre à organização"}}}",
        "status": 200,
      }
    `);
    expect(await bruto(post({ ...ANALISAR, preco: 0 }))).toMatchInlineSnapshot(`
      {
        "corpo": "{"erro":"payload_invalido"}",
        "status": 400,
      }
    `);
    vi.mocked(requireUserOrg).mockRejectedValueOnce(new Response('{}', { status: 403 }));
    expect(await bruto(post(ANALISAR))).toMatchInlineSnapshot(`
      {
        "corpo": "{"erro":"interno"}",
        "status": 403,
      }
    `);
    vi.mocked(exigirModulo).mockResolvedValue(false);
    expect(await bruto(post(ANALISAR))).toMatchInlineSnapshot(`
      {
        "corpo": "{"erro":"modulo_desligado"}",
        "status": 403,
      }
    `);
  });

  it.each([['null', null], ['número', 1], ['vazio', '']])('protocolo 2 com identidadeEsperada %s → 400 payload_invalido, nada executado', async (_, v) => {
    const r = await post({ ...REMOVER, ...P2, identidadeEsperada: v });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ erro: 'payload_invalido', identidade: 'user-1:org-1:' });
    expect(escritas()).toEqual([]);
    expect(exigirModulo).not.toHaveBeenCalled();
  });

  it('identidadeEsperada divergente → 409 identidade_mudou e nada executado', async () => {
    f.contexto = suporte('full');
    const r = await post({ ...REMOVER, ...P2, identidadeEsperada: 'admin-1:org-2:req-1' });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ erro: 'identidade_mudou', identidade: 'admin-1:org-1:req-1' });
    expect(escritas()).toEqual([]);
    expect(auditorias()).toEqual([]);
    expect(exigirModulo).not.toHaveBeenCalled();
  });

  it('identidadeEsperada fora do formato → 400 payload_invalido com identidade', async () => {
    const r = await post({ ...REMOVER, ...P2, identidadeEsperada: 'x y' });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ erro: 'payload_invalido', identidade: 'user-1:org-1:' });
    expect(escritas()).toEqual([]);
  });

  it('sessao: nome/email de profiles e orgNome da org efetiva; sem cota nem registro de uso', async () => {
    f.linhas = { profiles: { nome: 'Diego', email: 'd@x.com' }, organizations: { nome: 'Avil' } };
    f.contexto = suporte('read');
    const r = await post({ acao: 'sessao', ...P2, identidadeEsperada: 'admin-1:org-1:req-1' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ identidade: 'admin-1:org-1:req-1', dados: { nome: 'Diego', email: 'd@x.com', orgNome: 'Avil' } });
    expect(f.eqs).toEqual(expect.arrayContaining([['profiles', 'id', 'admin-1'], ['organizations', 'id', 'org-1']]));
    expect(redisIncrComTTL).not.toHaveBeenCalled();
    expect(f.rpcs).toEqual([]);
  });

  it('sessao sem linhas → nulls', async () => {
    f.linhas = { profiles: null, organizations: null };
    const j = await (await post({ acao: 'sessao', ...P2 })).json();
    expect(j).toEqual({ identidade: 'user-1:org-1:', dados: { nome: null, email: null, orgNome: null } });
  });

  it('módulo desligado com protocolo 2 → { erro: modulo_desligado, identidade }', async () => {
    vi.mocked(exigirModulo).mockResolvedValue(false);
    const r = await post({ ...ANALISAR, ...P2 });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ erro: 'modulo_desligado', identidade: 'user-1:org-1:' });
  });

  it('403 do requireUserOrg sem marca → sem_acesso (protocolo 2, sem identidade); legado continua interno', async () => {
    vi.mocked(requireUserOrg).mockRejectedValue(new Response('{}', { status: 403 }));
    const r = await post({ ...ANALISAR, ...P2 });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ erro: 'sem_acesso' });
    expect(await (await post(ANALISAR)).json()).toEqual({ erro: 'interno' });
  });

  it('401 com protocolo 2: corpo atual, sem identidade', async () => {
    vi.mocked(requireUserOrg).mockRejectedValue(new Response('{}', { status: 401 }));
    expect(await (await post({ ...ANALISAR, ...P2 })).json()).toEqual({ erro: 'sessao_expirada' });
  });
});

describe('extensao — frete cotado da oferta (auditoria × Avant, 0.3.1)', () => {
  const P2 = { protocolo: 2 };
  const fetchMl = vi.fn();
  const chamadasShipping = () => fetchMl.mock.calls.filter(([u]) => String(u).includes('/shipping_options'));
  beforeEach(() => {
    vi.mocked(resolverConexao).mockResolvedValue({ contaExternaId: 555 } as never);
    vi.mocked(getValidAccessTokenConexao).mockResolvedValue('tok');
    vi.mocked(buscarListingPrice).mockResolvedValue({ sale_fee_amount: 12, sale_fee_details: { percentage_fee: 12, fixed_fee: 0 } });
    vi.mocked(buscarFreteVendedorComProveniencia).mockResolvedValue({ valor: 20, proveniencia: 'official' } as never);
    vi.mocked(mlGet).mockResolvedValue(null);
    fetchMl.mockReset();
    fetchMl.mockImplementation(async () => new Response(JSON.stringify({ options: [{ list_cost: 32.45, display: 'recommended' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMl);
  });

  it('cliente legado (sem protocolo): sem cotação e sem o campo freteOferta', async () => {
    const corpo = await (await post(ANALISAR)).json();
    expect(corpo).not.toHaveProperty('freteOferta');
    expect(chamadasShipping()).toHaveLength(0);
    expect(corpo.parametros.frete).toMatchObject({ estado: 'ok', valor: 20 });
  });

  it('protocolo 2: cota com o token, CEP de referência, 2,5 s sem retry; cache por conta + org + item', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const r = await (await post({ ...ANALISAR, ...P2 })).json();
    expect(r.dados.freteOferta).toEqual({ estado: 'ok', valor: 32.45 });
    expect(r.dados.parametros.frete).toMatchObject({ estado: 'ok', valor: 20 }); // margem segue o frete da conta
    expect(chamadasShipping()).toHaveLength(1);
    const [url, init] = chamadasShipping()[0] as [string, RequestInit];
    expect(url).toBe('https://api.mercadolibre.com/items/MLB1/shipping_options?zip_code=01310100');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok');
    expect(timeout).toHaveBeenCalledWith(2500);
    expect(vi.mocked(redisSet).mock.calls.map(([k]) => k)).toContain('ext:frof:v2:555:org-1:MLB1:01310100');
    timeout.mockRestore();
  });

  it('429 ou falha de rede: uma tentativa só, indisponível (nunca zero)', async () => {
    fetchMl.mockImplementation(async () => new Response('{}', { status: 429 }));
    const r = await (await post({ ...ANALISAR, ...P2 })).json();
    expect(r.dados.freteOferta).toEqual({ estado: 'indisponivel', motivo: 'frete da oferta indisponível' });
    expect(chamadasShipping()).toHaveLength(1);
    fetchMl.mockReset();
    fetchMl.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    const t = await (await post({ ...ANALISAR, ...P2 })).json();
    expect(t.dados.freteOferta).toEqual({ estado: 'indisponivel', motivo: 'frete da oferta indisponível' });
    expect(fetchMl).toHaveBeenCalledTimes(1);
  });

  it('busca (analisar_busca): analisa os cards sem cotar o frete da oferta', async () => {
    f.dados.variacoes = [{
      id: 'v1', codigo: '001', nome: 'X', custo: 10, peso_gramas: 500, altura_cm: 10, largura_cm: 10, comprimento_cm: 10, atualizado_em: '2026-10-01',
      familias: { origem: 'nacional', kit_multiplicador: null, nome_pai: null, codigo_pai: 'P1', atributos_ml: null },
    }];
    vi.mocked(mlGet).mockResolvedValue({ results: [{ item_id: 'MLB1', category_id: 'MLB5' }], paging: { total: 1 } });
    const r = await (await post({ acao: 'analisar_busca', eanDaBusca: null, itens: [{ itemId: 'MLB1', catalogProductId: 'MLB42', preco: 100 }], ...P2 })).json();
    expect(r.dados.itens[0]).toMatchObject({ itemId: 'MLB1', estado: 'ok' });
    expect(buscarListingPrice).toHaveBeenCalled();
    expect(chamadasShipping()).toHaveLength(0);
    expect(vi.mocked(mlGet).mock.calls.some(([u]) => String(u).includes('/shipping_options'))).toBe(false);
  });
});
