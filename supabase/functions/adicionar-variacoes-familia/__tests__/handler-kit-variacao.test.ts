// ADR-0200 (Task 7): o saldo da cópia de SKU em kit com variação é gravado pelo trigger
// `variacoes_kit_saldo_copia` (supabase/tests/kit_variacao_guards.sql). Com transferência aberta o
// insert é recusado: o handler desfaz família e lote e devolve 409, sem publicar.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { lerPrecoBaseVivo } from '../../_shared/preco/preco-base-vivo.ts';

type Linha = Record<string, unknown>;
const f = vi.hoisted(() => ({
  serve: vi.fn(),
  erroVariacoes: null as { code: string; message: string } | null,
  // Erros por tentativa (consumidos em ordem); vazio cai em `erroVariacoes`.
  errosVariacoes: [] as Array<{ code: string; message: string }>,
  escritas: [] as Array<{ tabela: string; op: string }>,
  variacoesInseridas: [] as Array<Record<string, unknown>>,
  up: false,
}));

const ANTERIOR = {
  id: 'fam-ant', codigo_pai: '00000010', ncm: '61091000', genero: null, grade_tamanho: null,
  criado_em: '2026-01-01T00:00:00Z', ml_item_id: 'MLB1',
};

function builder(tabela: string) {
  const filtros: Record<string, unknown> = {};
  let op = 'select';
  const resolver = (): { data: unknown; error: unknown } => {
    if (op !== 'select') {
      f.escritas.push({ tabela, op });
      if (tabela === 'variacoes' && op === 'insert') {
        const e = f.errosVariacoes.shift() ?? f.erroVariacoes;
        if (e) return { data: null, error: e };
      }
      return { data: { id: 'novo' }, error: null };
    }
    // codigosJaUsados: `.in(...)` sem colisão.
    if (Array.isArray(filtros.codigo_pai) || Array.isArray(filtros.codigo)) return { data: [], error: null };
    if (tabela === 'familias') {
      if ('chave_cadastro' in filtros) return { data: null, error: null };
      if ('codigo_pai' in filtros) return { data: ANTERIOR, error: null };
      if ('id' in filtros) return { data: { codigo_pai: '00000010' }, error: null };
    }
    if (tabela === 'variacoes') {
      return { data: [{ codigo: '00000001', cor: 'Preto', tamanho: null, excluida_da_publicacao: false, imagem_path: null, ml_picture_id: null, estoque: 3 }], error: null };
    }
    // Família User Products: raiz + 1 item filho vivo (f.up). Sem isso é Legacy.
    if (f.up && tabela === 'anuncios_externos') return { data: { id: 'raiz-1' }, error: null };
    if (f.up && tabela === 'anuncios_externos_itens') return { data: [{ item_externo_id: 'MLB1' }], error: null };
    if (tabela === 'lotes' || tabela === 'anuncios_externos' || tabela === 'anuncios_externos_itens') return { data: [], error: null };
    return { data: null, error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => { filtros[c] = v; return q; },
    in: (c: string, v: unknown) => { filtros[c] = v; return q; },
    not: (c: string, _o: string, v: unknown) => { filtros[`not:${c}`] = v; return q; },
    neq: () => q, gte: () => q, lt: () => q, gt: () => q, is: () => q,
    order: () => q, limit: () => q, range: () => q,
    insert: (linhas: unknown) => {
      op = 'insert';
      if (tabela === 'variacoes') f.variacoesInseridas.push(...(Array.isArray(linhas) ? linhas : [linhas]) as Array<Record<string, unknown>>);
      return q;
    },
    update: () => { op = 'update'; return q; },
    delete: () => { op = 'delete'; return q; },
    maybeSingle: async () => resolver(),
    single: async () => resolver(),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, ko),
  };
  return q;
}

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn().mockResolvedValue({ userId: 'user-1', orgId: 'org-1', isAdmin: true, support: null }),
}));
vi.mock('../../_shared/supabase.ts', () => ({
  adminClient: () => ({
    from: (t: string) => builder(t),
    rpc: async (nome: string, args: { p_codigos?: string[] }) => {
      if (nome === 'ncm_consultar') return { data: (args.p_codigos ?? []).map((codigo) => ({ codigo, vigente: true })), error: null };
      return { data: null, error: null };
    },
  }),
}));
vi.mock('../../_shared/support-audit.ts', () => ({ auditarOperacaoSuporte: vi.fn() }));
// Preço base vivo das irmãs no ML (leitura nova do handler): aqui, sempre 69,90.
vi.mock('../../_shared/canais/conexao.ts', () => ({ resolverConexao: vi.fn(async () => ({ id: 'conn-1' })) }));
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: vi.fn(async () => 'tok') }));
vi.mock('../../_shared/preco/preco-base-vivo.ts', () => ({ lerPrecoBaseVivo: vi.fn(async () => 69.9) }));
vi.mock('../../_shared/produto/modulo.ts', () => ({ exigirModulo: vi.fn(async () => true) }));

let handler: (req: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => 'http://localhost' } });
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});
let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  f.erroVariacoes = null; f.errosVariacoes = []; f.escritas = []; f.variacoesInseridas = []; f.up = false;
  vi.mocked(lerPrecoBaseVivo).mockClear();
  fetchSpy = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetchSpy);
});

const post = () => handler(new Request('http://localhost', {
  method: 'POST', headers: { Authorization: 'Bearer x' },
  body: JSON.stringify({
    familia_id: 'fam-ant', chave: '11111111-1111-4111-8111-111111111111',
    variacoes: [{ codigo: '00000002', nome: 'Azul', preco: 10, estoqueInicial: 1, imagemPath: 'user-1/a.jpg' }],
  }),
}));

describe('adicionar-variacoes-familia — preço base vivo das irmãs (12/11/2026)', () => {
  it('User Products sem leitura confiável do ML → 503 e NADA é criado (nunca cai no preço local defasado)', async () => {
    f.up = true;
    vi.mocked(lerPrecoBaseVivo).mockResolvedValueOnce(null);
    const r = await post();
    expect(r.status).toBe(503);
    expect(f.escritas).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('User Products: a cor nova é gravada com o preço base lido no ML, não com o digitado (10)', async () => {
    f.up = true;
    await post();
    expect(lerPrecoBaseVivo).toHaveBeenCalledWith('tok', ['MLB1']);
    expect(f.variacoesInseridas.find((v) => v.codigo === '00000002')?.preco_publicacao).toBe(69.9);
  });

  it('Legacy (sem itens filhos): não lê o ML; a cor nova segue o preço uniforme das irmãs', async () => {
    await post();
    expect(lerPrecoBaseVivo).not.toHaveBeenCalled();
    expect(f.variacoesInseridas.find((v) => v.codigo === '00000002')?.preco_publicacao).toBe(10);
  });
});

describe('adicionar-variacoes-familia — SKU em transferência de kit com variação', () => {
  it('insert recusado pelo trigger → 409 com a mensagem, família e lote desfeitos, sem publicar', async () => {
    f.erroVariacoes = { code: '23514', message: 'sku_em_transferencia: 00000001 está em transferência de kit com variação. Repita depois que ela terminar.' };
    const r = await post();
    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain('transferência de kit com variação');
    expect(f.escritas).toEqual(expect.arrayContaining([
      { tabela: 'familias', op: 'delete' }, { tabela: 'lotes', op: 'delete' },
    ]));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Fix round 3: o trigger de cópia recusa com 40001 quando a canônica trocou durante a espera do lock.
  it('40001 na 1ª tentativa do insert: repete e segue publicando', async () => {
    f.errosVariacoes = [{ code: '40001', message: 'canonica_trocou: a cópia canônica de 00000001 mudou durante a operação. Repita.' }];
    const r = await post();
    expect(r.status).toBe(200);
    expect(f.escritas.filter((e) => e.tabela === 'variacoes' && e.op === 'insert')).toHaveLength(2);
    expect(f.escritas).not.toContainEqual({ tabela: 'familias', op: 'delete' });
  });

  it('40P01 (deadlock) três vezes: desfaz e devolve 409 para repetir', async () => {
    const dl = { code: '40P01', message: 'deadlock detected' };
    f.errosVariacoes = [dl, dl, dl];
    const r = await post();
    expect(r.status).toBe(409);
    expect(f.escritas.filter((e) => e.tabela === 'variacoes' && e.op === 'insert')).toHaveLength(3);
    expect(f.escritas).toEqual(expect.arrayContaining([{ tabela: 'familias', op: 'delete' }]));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('outro erro do insert segue 500 (regressão)', async () => {
    f.erroVariacoes = { code: '23502', message: 'null value in column' };
    const r = await post();
    expect(r.status).toBe(500);
  });
});
