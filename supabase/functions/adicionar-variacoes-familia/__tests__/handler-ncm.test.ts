// ADR-0187 — fronteira real do handler: NCM da família clonada fora da tabela oficial recusa
// ANTES de qualquer escrita (lote/família), e o retry idempotente nem consulta o NCM.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Linha = Record<string, unknown>;
const f = vi.hoisted(() => ({
  serve: vi.fn(),
  jaExistente: null as Linha | null,
  ncm: 'inexistente' as 'inexistente' | 'vigente' | 'erro',
  escritas: [] as Array<{ tabela: string; op: string }>,
  rpcs: [] as string[],
}));

const ANTERIOR = {
  id: 'fam-ant', codigo_pai: '00000010', ncm: '75937727', genero: null, grade_tamanho: null,
  criado_em: '2026-01-01T00:00:00Z', ml_item_id: 'MLB1',
};

function builder(tabela: string) {
  const filtros: Record<string, unknown> = {};
  let op = 'select';
  const resolver = (): { data: unknown; error: null } => {
    if (op !== 'select') { f.escritas.push({ tabela, op }); return { data: { id: 'novo' }, error: null }; }
    if (tabela === 'familias') {
      if ('chave_cadastro' in filtros) return { data: f.jaExistente, error: null };
      if ('codigo_pai' in filtros) return { data: ANTERIOR, error: null };
      if ('id' in filtros) return { data: { codigo_pai: '00000010' }, error: null };
    }
    if (tabela === 'variacoes') {
      return { data: [{ codigo: '00000001', cor: null, tamanho: null, excluida_da_publicacao: false, imagem_path: null, ml_picture_id: null, estoque: 3 }], error: null };
    }
    return { data: null, error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => { filtros[c] = v; return q; },
    in: (c: string, v: unknown) => { filtros[c] = v; return q; },
    not: (c: string, _o: string, v: unknown) => { filtros[`not:${c}`] = v; return q; },
    order: () => q, limit: () => q,
    insert: () => { op = 'insert'; return q; },
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
      f.rpcs.push(nome);
      if (nome === 'ncm_consultar') {
        if (f.ncm === 'erro') return { data: null, error: { message: 'fora do ar' } };
        const cods = args.p_codigos ?? [];
        return { data: f.ncm === 'inexistente' ? [] : cods.map((codigo) => ({ codigo, vigente: true })), error: null };
      }
      return { data: null, error: null };
    },
  }),
}));
vi.mock('../../_shared/support-audit.ts', () => ({ auditarOperacaoSuporte: vi.fn() }));
vi.mock('../../_shared/produto/modulo.ts', () => ({ exigirModulo: vi.fn(async () => true) }));

let handler: (req: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => 'http://localhost' } });
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});
beforeEach(() => { f.jaExistente = null; f.ncm = 'inexistente'; f.escritas = []; f.rpcs = []; });

const corpo = {
  familia_id: 'fam-ant', chave: '11111111-1111-4111-8111-111111111111',
  variacoes: [{ codigo: '00000002', nome: 'Azul', preco: 10, estoqueInicial: 1, imagemPath: 'user-1/a.jpg' }],
};
const post = () => handler(new Request('http://localhost', {
  method: 'POST', headers: { Authorization: 'Bearer x' }, body: JSON.stringify(corpo),
}));

describe('adicionar-variacoes-familia — NCM na tabela oficial (handler)', () => {
  it('família com NCM inexistente → 400 com a copy; zero escritas (lotes/familias) e zero reserva de código', async () => {
    const r = await post();
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('NCM 75937727 não existe na tabela oficial — corrija no botão Fiscal antes.');
    expect(f.escritas).toEqual([]);
    expect(f.rpcs).toEqual(['ncm_consultar']);
  });

  it('erro lendo a tabela de NCM → 500, zero escritas', async () => {
    f.ncm = 'erro';
    const r = await post();
    expect(r.status).toBe(500);
    expect(f.escritas).toEqual([]);
  });

  it('retry de pedido já criado (jaExistente) devolve o resultado normal sem consultar NCM', async () => {
    f.jaExistente = { id: 'fam-nova', lote_id: 'lote-1', status: 'publicado', criado_em: '2026-01-02T00:00:00Z', mudanca_estrutural: { novas: ['00000002'] } };
    const r = await post();
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ jaExistia: true, familiaId: 'fam-nova', loteId: 'lote-1' });
    expect(f.rpcs).toEqual([]);
    expect(f.escritas).toEqual([]);
  });
});
