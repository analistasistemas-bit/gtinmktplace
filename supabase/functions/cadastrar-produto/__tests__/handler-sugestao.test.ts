// ADR-0181 (emenda 2026-10-17): o handler grava a sugestão de distribuição da nota em
// familias.mudanca_estrutural, compara no retry e nunca toca estoque. Banco em memória (fake).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Linha = Record<string, unknown>;
const f = vi.hoisted(() => ({
  serve: vi.fn(),
  db: {} as Record<string, Linha[]>,
  rpcs: [] as Array<{ nome: string; args: Linha }>,
  seq: 0,
}));

function builder(tabela: string) {
  const filtros: Array<(r: Linha) => boolean> = [];
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  let novos: Linha[] = [];
  let patch: Linha = {};
  let ordem: string | null = null;
  const linhas = () => (f.db[tabela] ??= []);
  const alvo = () => linhas().filter((r) => filtros.every((p) => p(r)));
  const resultado = (): Linha[] => {
    if (op === 'insert') {
      // O Postgres não garante a ordem do RETURNING: devolve invertido de propósito.
      return tabela === 'variacoes' ? [...novos].reverse() : novos;
    }
    if (op === 'update') { alvo().forEach((r) => Object.assign(r, patch)); return []; }
    if (op === 'delete') { f.db[tabela] = linhas().filter((r) => !filtros.every((p) => p(r))); return []; }
    const rs = alvo();
    return ordem ? [...rs].sort((a, b) => String(a[ordem!]).localeCompare(String(b[ordem!]))) : rs;
  };
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return q; },
    in: (c: string, vs: unknown[]) => { filtros.push((r) => vs.includes(r[c])); return q; },
    order: (c: string) => { ordem = c; return q; },
    limit: () => q,
    insert: (rows: Linha | Linha[]) => {
      op = 'insert';
      novos = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ id: `${tabela}-${++f.seq}`, ...structuredClone(r) }));
      linhas().push(...novos);
      return q;
    },
    update: (p: Linha) => { op = 'update'; patch = p; return q; },
    delete: () => { op = 'delete'; return q; },
    maybeSingle: async () => ({ data: resultado()[0] ?? null, error: null }),
    single: async () => ({ data: resultado()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve({ data: resultado(), error: null }).then(ok, ko),
  };
  return q;
}

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn().mockResolvedValue({ userId: 'user-1', orgId: 'org-1', isAdmin: false, support: null }),
}));
vi.mock('../../_shared/supabase.ts', () => ({
  adminClient: () => ({
    from: (t: string) => builder(t),
    rpc: async (nome: string, args: Linha) => {
      f.rpcs.push({ nome, args });
      if (nome === 'proximo_codigo_produto') return { data: 12, error: null }; // PAI 10, SKUs 11 e 12
      if (nome === 'proximo_numero_lote') return { data: 1, error: null };
      return { data: null, error: null };
    },
  }),
}));
vi.mock('../../_shared/support-audit.ts', () => ({ auditarOperacaoSuporte: vi.fn() }));
vi.mock('../../_shared/produto/modulo.ts', () => ({
  exigirModulo: vi.fn(async (_a: unknown, _o: string, m: string) => m === 'estoque'),
}));
vi.mock('../../_shared/produto/tipo-produto.ts', () => ({ tiposProdutoDaOrg: vi.fn().mockResolvedValue([]) }));
vi.mock('../../_shared/produto/codigos.ts', async (orig) => ({
  ...(await orig<typeof import('../../_shared/produto/codigos.ts')>()),
  codigosJaUsados: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../_shared/queue.ts', () => ({ enfileirarFamilia: vi.fn().mockResolvedValue('msg-1') }));

let handler: (req: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve });
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});
beforeEach(() => { f.db = {}; f.rpcs = []; f.seq = 0; });

const REF = `nfe:${'1'.repeat(44)}:2`;
const corpo = (quantidades: number[], extra: Linha = {}) => ({
  nomePai: 'Conjunto', origem: 'nacional', chaveCadastro: '11111111-1111-1111-1111-111111111111',
  origemNota: true, refNota: REF, fatorNota: 12,
  variacoes: [
    { nome: 'Azul', preco: 50, custo: 14.5, quantidadeNota: quantidades[0] },
    { nome: 'Rosa', preco: 50, custo: 14.5, quantidadeNota: quantidades[1] },
  ],
  ...extra,
});
const post = (b: unknown) => handler(new Request('http://localhost', { method: 'POST', body: JSON.stringify(b) }));

describe('cadastrar-produto — sugestão de distribuição da nota', () => {
  it('grava a sugestão associada aos códigos gerados (RETURNING embaralhado não importa) e devolve na resposta', async () => {
    const r = await post(corpo([5, 0]));
    expect(r.status).toBe(200);
    const body = await r.json();
    const esperada = { fator: 12, linhas: [{ codigo: '00000011', quantidade: 5 }] };
    expect(body.sugestaoDistribuicao).toEqual(esperada);
    // A variação Azul (1ª do payload) é a 00000011 — mesmo com o INSERT devolvendo invertido.
    expect(f.db.variacoes.find((v) => v.codigo === '00000011')?.nome).toBe('Azul');
    // JSON persistido, lido de volta.
    const gravada = JSON.parse(JSON.stringify(f.db.familias[0].mudanca_estrutural));
    expect(gravada).toEqual({ refNota: REF, sugestaoDistribuicao: esperada });
    // Nunca vira estoque (D-4).
    expect(f.db.variacoes.map((v) => v.estoque)).toEqual([0, 0]);
    expect(f.rpcs.some((c) => c.nome === 'registrar_entrada')).toBe(false);
    expect(f.db.estoque_movimentos ?? []).toEqual([]);
  });

  it('sem quantidades: mudanca_estrutural só com refNota e resposta com sugestão null', async () => {
    const r = await post(corpo([0, 0]));
    expect(r.status).toBe(200);
    expect((await r.json()).sugestaoDistribuicao).toBeNull();
    expect(f.db.familias[0].mudanca_estrutural).toEqual({ refNota: REF });
  });

  it('retry igual: sem efeito extra e mesma resposta; retry com quantidade diferente: 409 antes de efeitos', async () => {
    const primeira = await (await post(corpo([5, 3]))).json();
    const rpcsAntes = f.rpcs.length;
    const familiasAntes = f.db.familias.length;
    const r2 = await post(corpo([5, 3]));
    expect(r2.status).toBe(200);
    expect(await r2.json()).toEqual(primeira);
    expect(f.rpcs.length).toBe(rpcsAntes);
    expect(f.db.familias.length).toBe(familiasAntes);

    const r3 = await post(corpo([4, 4]));
    expect(r3.status).toBe(409);
    expect(f.rpcs.length).toBe(rpcsAntes);
    expect(f.db.familias[0].mudanca_estrutural).toEqual({
      refNota: REF, sugestaoDistribuicao: { fator: 12, linhas: [{ codigo: '00000011', quantidade: 5 }, { codigo: '00000012', quantidade: 3 }] },
    });
    expect(f.db.variacoes.map((v) => v.estoque)).toEqual([0, 0]);
  });

  it('quantidadeNota sem origemNota: 400', async () => {
    const r = await post(corpo([1, 0], { origemNota: undefined, refNota: undefined, fatorNota: undefined }));
    expect(r.status).toBe(400);
    expect(f.db.familias ?? []).toEqual([]);
  });
});
