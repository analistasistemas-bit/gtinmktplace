import { describe, it, expect } from 'vitest';
import { processarAcao, type CtxAcao } from '../acoes';

// Fake do PostgREST com escrita: select/insert/update/upsert/delete + eq/in/is/limit, e as
// unicidades que importam aqui (23505 como no Postgres).
type Linha = Record<string, any>;
const UNICOS: Record<string, string[][]> = {
  pedidos_compra: [['ref_aprovacao']],
  fornecedores: [['org_id', 'nome_normalizado']],
  notificacoes: [['user_id', 'chave']],
  pedidos_compra_itens: [['pedido_id', 'codigo']],
  reposicao_config: [['org_id']],
  reposicao_nao_repor: [['org_id', 'escopo', 'codigo_pai', 'codigo', 'cor']],
};
// Índice com coalesce(col, ''): null conta como '' e também colide.
const COALESCE = new Set(['reposicao_nao_repor']);
const val = (r: Linha, k: string) => k.split('.').reduce((a: any, p) => a?.[p], r);
type Rpc = (args: Linha) => { data: unknown; error: { code?: string; message: string } | null };
function fakeDb(t: Record<string, Linha[]>, rpcs: Record<string, Rpc> = {}) {
  let seq = 0;
  const chamadas: Array<{ nome: string; args: Linha }> = [];
  // Cada consulta executada com os filtros eq, as chaves de ordem e o cursor (gt), para provar filtro de org e chaves.
  const consultas: Array<{ tabela: string; op: string; eqs: Record<string, unknown>; orders: string[]; gts: string[] }> = [];
  const viola = (tabela: string, r: Linha, ignorar?: Linha) => (UNICOS[tabela] ?? []).some((cols) => COALESCE.has(tabela)
    ? (t[tabela] ?? []).some((x) => x !== ignorar && cols.every((c) => (x[c] ?? '') === (r[c] ?? '')))
    : cols.every((c) => r[c] != null) && (t[tabela] ?? []).some((x) => x !== ignorar && cols.every((c) => x[c] === r[c])));
  const db: any = {
    t,
    chamadas,
    consultas,
    /** Teto do PostgREST simulado (linhas por select). */
    teto: Infinity,
    /** Gancho chamado antes de cada consulta (simula escrita concorrente entre páginas). */
    antes: null as null | ((tabela: string, op: string) => void),
    rpc: async (nome: string, args: Linha) => { chamadas.push({ nome, args }); return rpcs[nome] ? rpcs[nome](args) : { data: null, error: null }; },
    from: (tabela: string) => {
      t[tabela] ??= [];
      let op = 'select'; let payload: any; let opts: any = {};
      const preds: Array<(r: Linha) => boolean> = [];
      const eqs: Record<string, unknown> = {};
      let faixa: [number, number] | null = null;
      let limite = Infinity;
      const orders: string[] = [];
      const gts: string[] = [];
      const run = () => {
        db.antes?.(tabela, op);
        consultas.push({ tabela, op, eqs, orders, gts });
        if (consultas.length > 500) throw new Error('fake: consultas demais (laço de paginação?)');
        const alvo = () => t[tabela].filter((r) => preds.every((p) => p(r)));
        if (op === 'select') {
          // order de verdade (asc, estável), depois offset/limit e o teto do servidor.
          const d = alvo().sort((a, b) => {
            for (const k of orders) { const x = String(val(a, k)); const y = String(val(b, k)); if (x !== y) return x < y ? -1 : 1; }
            return 0;
          });
          const de = faixa ? faixa[0] : 0;
          const n = Math.min(faixa ? faixa[1] - faixa[0] + 1 : Infinity, limite, db.teto);
          return { data: d.slice(de, de + n), error: null };
        }
        if (op === 'delete') { const fora = alvo(); t[tabela] = t[tabela].filter((r) => !fora.includes(r)); return { data: fora, error: null }; }
        if (op === 'update') {
          const linhas = alvo();
          for (const r of linhas) if (viola(tabela, { ...r, ...payload }, r)) return { data: null, error: { code: '23505', message: 'duplicate' } };
          for (const r of linhas) Object.assign(r, payload);
          return { data: linhas, error: null };
        }
        const rows = (Array.isArray(payload) ? payload : [payload]).map((r: Linha) => ({ id: r.id ?? `00000000-0000-4000-9000-${String(++seq).padStart(12, '0')}`, ...r }));
        const feitas: Linha[] = [];
        for (const r of rows) {
          if (op === 'upsert') {
            const cols = String(opts.onConflict).split(',');
            const ex = t[tabela].find((x) => cols.every((c) => x[c] === r[c]));
            if (ex) { if (!opts.ignoreDuplicates) { const { id: _id, ...resto } = r; Object.assign(ex, resto); feitas.push(ex); } continue; }
          }
          if (viola(tabela, r)) return { data: null, error: { code: '23505', message: 'duplicate' } };
          t[tabela].push(r); feitas.push(r);
        }
        return { data: feitas, error: null };
      };
      const c: any = {
        select: () => c,
        insert: (p: any) => { op = 'insert'; payload = p; return c; },
        update: (p: any) => { op = 'update'; payload = p; return c; },
        upsert: (p: any, o: any) => { op = 'upsert'; payload = p; opts = o ?? {}; return c; },
        delete: () => { op = 'delete'; return c; },
        eq: (k: string, v: unknown) => { eqs[k] = v; preds.push((r) => val(r, k) === v); return c; },
        in: (k: string, vs: unknown[]) => { preds.push((r) => vs.includes(val(r, k))); return c; },
        is: (k: string, v: unknown) => { preds.push((r) => (val(r, k) ?? null) === v); return c; },
        range: (de: number, ate: number) => { faixa = [de, ate]; return c; },
        gt: (k: string, v: unknown) => { gts.push(k); preds.push((r) => String(val(r, k)) > String(v)); return c; },
        order: (k: string) => { orders.push(k); return c; },
        limit: (n: number) => { limite = n; return c; },
        // Como o supabase-js: mais de uma linha é erro de cardinalidade.
        maybeSingle: async () => {
          const r = run();
          if ((r.data?.length ?? 0) > 1) return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
          return { data: r.data?.[0] ?? null, error: r.error };
        },
        single: async () => { const r = run(); return r.error ? r : { data: r.data?.[0] ?? null, error: null }; },
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      };
      return c;
    },
  };
  return db;
}

const ORG = 'org-1';
const P1 = '00000000-0000-4000-8000-000000000001';
const NOVO = '00000000-0000-4000-8000-0000000000aa';
const ctx = (over: Partial<CtxAcao> = {}): CtxAcao => ({
  orgId: ORG, userId: 'u-admin', isAdmin: true, support: null, hoje: '2026-11-16', agora: '2026-11-16T15:00:00Z', ...over,
});
const deps = (db: any, modulo = true) => ({ db, moduloHabilitado: async () => modulo });

function cenario(rpcs: Record<string, Rpc> = {}) {
  return fakeDb({
    reposicao_config: [{ org_id: ORG, prazo_dias: 15, cobertura_dias: 30 }],
    fornecedores: [{ id: 'fo1', org_id: ORG, nome: 'Fornecedor A', nome_normalizado: 'fornecedor a', cnpj: null }],
    pedidos_compra: [{ id: P1, org_id: ORG, fornecedor_id: 'fo1', status: 'rascunho', previsto_para: null, enviado_em: null, ref_aprovacao: null }],
    pedidos_compra_itens: [{ pedido_id: P1, org_id: ORG, codigo: 'A', codigo_pai: 'P1', quantidade: 4, sugerida: 4, recebida: 0, encerrado: false }],
    pedidos_compra_recebimentos: [],
    profiles: [
      { id: 'u-admin', org_id: ORG, is_active: true, is_admin: true, telegram_categorias: [] },
      { id: 'u-membro', org_id: ORG, is_active: true, is_admin: false, telegram_categorias: ['reposicao'] },
      { id: 'u-inativo', org_id: ORG, is_active: false, is_admin: true, telegram_categorias: ['reposicao'] },
      { id: 'u-outra', org_id: 'org-2', is_active: true, is_admin: true, telegram_categorias: [] },
    ],
    notificacoes: [],
    reposicao_nao_repor: [],
  }, rpcs);
}

describe('processarAcao', () => {
  it('sem o módulo reposicao → 403 em qualquer ação', async () => {
    const db = cenario();
    const r = await processarAcao(deps(db, false), ctx(), { action: 'salvar_config', prazo: 10, cobertura: 20 });
    expect(r.status).toBe(403);
    expect(db.t.reposicao_config[0].prazo_dias).toBe(15);
  });

  it('aprovar 2× com a mesma ref → uma aprovação; outra ref depois → 409', async () => {
    const db = cenario();
    const a = await processarAcao(deps(db), ctx(), { action: 'aprovar', ref: 'r-1', pedidoId: P1 });
    const b = await processarAcao(deps(db), ctx({ agora: '2026-11-16T15:00:05Z' }), { action: 'aprovar', ref: 'r-1', pedidoId: P1 });
    expect([a.status, b.status]).toEqual([200, 200]);
    const p = db.t.pedidos_compra[0];
    expect(p).toMatchObject({ status: 'aprovado', aprovado_por: 'u-admin', aprovado_em: '2026-11-16T15:00:00Z', ref_aprovacao: 'r-1' });
    // sem data no rascunho: hoje + prazo
    expect(p.previsto_para).toBe('2026-12-01');
    const c = await processarAcao(deps(db), ctx(), { action: 'aprovar', ref: 'r-2', pedidoId: P1 });
    expect(c.status).toBe(409);
  });

  it('membro não admin não aprova (403); suporte com escopo full aprova', async () => {
    const db = cenario();
    const r = await processarAcao(deps(db), ctx({ userId: 'u-membro', isAdmin: false }), { action: 'aprovar', ref: 'r', pedidoId: P1 });
    expect(r.status).toBe(403);
    expect(db.t.pedidos_compra[0].status).toBe('rascunho');
    const s = await processarAcao(deps(db), ctx({ userId: 'u-sup', isAdmin: false, support: { scope: 'full' } }), { action: 'aprovar', ref: 'r', pedidoId: P1 });
    expect(s.status).toBe(200);
  });

  it('pedido de outra org não é encontrado', async () => {
    const r = await processarAcao(deps(cenario()), ctx({ orgId: 'org-2' }), { action: 'aprovar', ref: 'r', pedidoId: P1 });
    expect(r.status).toBe(404);
  });

  // A semântica das RPCs (lock, recusa, status) está em supabase/tests/reposicao_acoes.sql; aqui, o contrato da edge.
  it('editar_pedido chama a RPC atômica; recusa dela (já houve recebimento) → 409 com a mensagem', async () => {
    const db = cenario({
      reposicao_editar_pedido: () => ({ data: null, error: { code: '23514', message: 'reposicao_editar_pedido: o pedido já teve recebimento e não pode mais ser editado' } }),
    });
    const r = await processarAcao(deps(db), ctx({ userId: 'u-membro', isAdmin: false }),
      { action: 'editar_pedido', pedidoId: P1, previstoPara: '2026-12-05', itens: [{ codigo: 'A', quantidade: 6 }] });
    expect(r).toEqual({ status: 409, body: { error: 'o pedido já teve recebimento e não pode mais ser editado' } });
    expect(db.chamadas).toEqual([{ nome: 'reposicao_editar_pedido', args: {
      p_org: ORG, p_pedido: P1, p_usuario: 'u-membro', p_previsto: '2026-12-05', p_itens: [{ codigo: 'A', quantidade: 6 }],
      p_pode_aprovado: false,
    } }]);
    const bad = await processarAcao(deps(db), ctx(), { action: 'editar_pedido', pedidoId: 'x', previstoPara: '2026-12-05', itens: [{ codigo: 'A', quantidade: 1 }] });
    expect(bad.status).toBe(404);
  });

  it('salvar_rascunho: fornecedor pelo nome normalizado, RPC atômica e aviso só aos admins ativos da org', async () => {
    const db = cenario({ reposicao_salvar_rascunho: () => ({ data: NOVO, error: null }) });
    const corpo = {
      action: 'salvar_rascunho', fornecedorNome: ' Fornecedôr  Novo ', itens: [{ codigo: 'A', codigoPai: 'P1', quantidade: 3, sugerida: 4 }],
    };
    const r = await processarAcao(deps(db), ctx({ userId: 'u-membro', isAdmin: false }), corpo);
    expect(r).toEqual({ status: 200, body: { ok: true, pedidoId: NOVO } });
    const forn = db.t.fornecedores.find((f: Linha) => f.nome_normalizado === 'fornecedor novo');
    expect(forn).toBeTruthy();
    expect(db.chamadas[0]).toEqual({ nome: 'reposicao_salvar_rascunho', args: {
      p_org: ORG, p_fornecedor: forn.id, p_pedido: null, p_usuario: 'u-membro', p_previsto: null, p_mudar_previsto: false,
      p_itens: [{ codigo: 'A', codigo_pai: 'P1', quantidade: 3, sugerida: 4 }],
    } });
    // admin não assinante recebe; membro assinante, admin inativo e admin de outra org não
    expect(db.t.notificacoes.map((n: Linha) => n.user_id)).toEqual(['u-admin']);
    expect(db.t.notificacoes[0]).toMatchObject({ categoria: 'reposicao', org_id: ORG, chave: `rascunho:${NOVO}:2026-11-16` });
    // salvar de novo no mesmo dia: mesmo fornecedor, sem segundo aviso
    await processarAcao(deps(db), ctx(), { ...corpo, fornecedorNome: 'FORNECEDOR NOVO' });
    expect(db.t.fornecedores).toHaveLength(2);
    expect(db.t.notificacoes).toHaveLength(1);
  });

  it('salvar_rascunho de pedido que deixou de ser rascunho → 409 e sem aviso', async () => {
    const db = cenario({
      reposicao_salvar_rascunho: () => ({ data: null, error: { code: '23514', message: 'reposicao_salvar_rascunho: o pedido deixou de ser rascunho (está aprovado); recarregue a tela' } }),
    });
    const r = await processarAcao(deps(db), ctx(), {
      action: 'salvar_rascunho', fornecedorNome: 'Fornecedor A', pedidoId: P1, itens: [{ codigo: 'B', codigoPai: 'P1', quantidade: 1, sugerida: 1 }],
    });
    expect(r.status).toBe(409);
    expect(db.chamadas[0].args.p_pedido).toBe(P1);
    expect(db.t.notificacoes).toHaveLength(0);
  });

  it('salvar_rascunho que esvazia o rascunho devolve pedidoId null e não avisa', async () => {
    const db = cenario({ reposicao_salvar_rascunho: () => ({ data: null, error: null }) });
    const r = await processarAcao(deps(db), ctx(), {
      action: 'salvar_rascunho', fornecedorNome: 'Fornecedor A', itens: [{ codigo: 'A', codigoPai: 'P1', quantidade: 0, sugerida: 4 }],
    });
    expect(r.body).toEqual({ ok: true, pedidoId: null });
    expect(db.t.notificacoes).toHaveLength(0);
  });

  it('encerrar_saldo e reabrir_saldo chamam as RPCs e devolvem o status delas', async () => {
    const db = cenario({
      reposicao_encerrar_saldo: () => ({ data: { status: 'saldo_encerrado', codigos: ['A'] }, error: null }),
      reposicao_reabrir_saldo: () => ({ data: null, error: { code: 'P0002', message: 'reposicao_reabrir_saldo: pedido não encontrado nesta organização' } }),
    });
    const e = await processarAcao(deps(db), ctx(), { action: 'encerrar_saldo', pedidoId: P1 });
    expect(e).toEqual({ status: 200, body: { ok: true, status: 'saldo_encerrado', codigos: ['A'] } });
    expect(db.chamadas[0]).toEqual({ nome: 'reposicao_encerrar_saldo', args: { p_org: ORG, p_pedido: P1, p_codigos: null } });
    const r = await processarAcao(deps(db), ctx(), { action: 'reabrir_saldo', pedidoId: P1, codigos: ['A'] });
    expect(r.status).toBe(404);
    expect(db.chamadas[1].args.p_codigos).toEqual(['A']);
  });

  it('erro inesperado de RPC lança (vira 500 na edge)', async () => {
    const db = cenario({ reposicao_encerrar_saldo: () => ({ data: null, error: { code: '57014', message: 'timeout' } }) });
    await expect(processarAcao(deps(db), ctx(), { action: 'encerrar_saldo', pedidoId: P1 })).rejects.toThrow('timeout');
  });

  it('nao_repor é idempotente e remover apaga', async () => {
    const db = cenario();
    const a = await processarAcao(deps(db), ctx(), { action: 'nao_repor', escopo: 'cor', codigoPai: 'P1', cor: 'Azul' });
    expect(a.status).toBe(200);
    expect(db.t.reposicao_nao_repor[0]).toMatchObject({ escopo: 'cor', codigo_pai: 'P1', cor: 'Azul', codigo: null });
    const s = await processarAcao(deps(db), ctx(), { action: 'nao_repor', escopo: 'sku', codigoPai: 'P1' });
    expect(s.status).toBe(400);
    const rm = await processarAcao(deps(db), ctx(), { action: 'remover_nao_repor', id: (a.body as { id: string }).id });
    expect(rm.status).toBe(200);
    expect(db.t.reposicao_nao_repor).toHaveLength(0);
  });

  it('editar_pedido: membro em pedido aprovado → 403 da RPC; admin e suporte full passam p_pode_aprovado', async () => {
    const db = cenario({
      reposicao_editar_pedido: (a) => (a.p_pode_aprovado ? { data: null, error: null }
        : { data: null, error: { code: '42501', message: 'reposicao_editar_pedido: só administrador altera pedido já aprovado' } }),
    });
    const corpo = { action: 'editar_pedido', pedidoId: P1, previstoPara: '2026-12-05', itens: [{ codigo: 'A', quantidade: 6 }] };
    const m = await processarAcao(deps(db), ctx({ userId: 'u-membro', isAdmin: false }), corpo);
    expect(m).toEqual({ status: 403, body: { error: 'Só administrador altera pedido já aprovado.' } });
    expect((await processarAcao(deps(db), ctx(), corpo)).status).toBe(200);
    expect((await processarAcao(deps(db), ctx({ userId: 'u-sup', isAdmin: false, support: { scope: 'full' } }), corpo)).status).toBe(200);
    expect((await processarAcao(deps(db), ctx({ userId: 'u-sup', isAdmin: false, support: { scope: 'read' } }), corpo)).status).toBe(403);
    expect(db.chamadas.map((c: { args: Linha }) => c.args.p_pode_aprovado)).toEqual([false, true, true, false]);
  });

  it('salvar_config só admin (muda a sugestão da org inteira)', async () => {
    const db = cenario();
    const r = await processarAcao(deps(db), ctx({ userId: 'u-membro', isAdmin: false }), { action: 'salvar_config', prazo: 20, cobertura: 45 });
    expect(r).toEqual({ status: 403, body: { error: 'Só administrador altera o prazo e a cobertura da reposição.' } });
    expect(db.t.reposicao_config[0]).toMatchObject({ prazo_dias: 15, cobertura_dias: 30 });
  });

  it('definir_multiplo: só admin, inteiro 1..1000, grava na família mais recente do produto na org', async () => {
    const db = cenario();
    db.t.familias = [
      { id: 'fam-velha', org_id: ORG, codigo_pai: 'P1', criado_em: '2026-01-01T00:00:00Z', multiplo_compra: 1 },
      { id: 'fam-nova', org_id: ORG, codigo_pai: 'P1', criado_em: '2026-06-01T00:00:00Z', multiplo_compra: 1 },
      { id: 'fam-outra-org', org_id: 'org-2', codigo_pai: 'P1', criado_em: '2026-09-01T00:00:00Z', multiplo_compra: 1 },
    ];
    const membro = await processarAcao(deps(db), ctx({ userId: 'u-membro', isAdmin: false }), { action: 'definir_multiplo', codigoPai: 'P1', multiplo: 6 });
    expect(membro.status).toBe(403);
    for (const multiplo of [0, 1001, 2.5, '6']) {
      expect((await processarAcao(deps(db), ctx(), { action: 'definir_multiplo', codigoPai: 'P1', multiplo })).status).toBe(400);
    }
    expect(db.t.familias.map((f: Linha) => f.multiplo_compra)).toEqual([1, 1, 1]);
    expect((await processarAcao(deps(db), ctx(), { action: 'definir_multiplo', codigoPai: 'P1', multiplo: 6 })).status).toBe(200);
    expect(db.t.familias.map((f: Linha) => f.multiplo_compra)).toEqual([1, 6, 1]);
    expect((await processarAcao(deps(db), ctx(), { action: 'definir_multiplo', codigoPai: 'NAO', multiplo: 6 })).status).toBe(404);
  });

  it('salvar_config valida os limites do banco', async () => {
    const db = cenario();
    expect((await processarAcao(deps(db), ctx(), { action: 'salvar_config', prazo: 0, cobertura: 30 })).status).toBe(400);
    expect((await processarAcao(deps(db), ctx(), { action: 'salvar_config', prazo: 20, cobertura: 45 })).status).toBe(200);
    expect(db.t.reposicao_config[0]).toMatchObject({ prazo_dias: 20, cobertura_dias: 45 });
  });

  it('marcar_enviado: só depois de aprovado; repetir é no-op', async () => {
    const db = cenario();
    expect((await processarAcao(deps(db), ctx(), { action: 'marcar_enviado', pedidoId: P1 })).status).toBe(409);
    Object.assign(db.t.pedidos_compra[0], { status: 'aprovado' });
    expect((await processarAcao(deps(db), ctx(), { action: 'marcar_enviado', pedidoId: P1 })).status).toBe(200);
    expect(db.t.pedidos_compra[0]).toMatchObject({ status: 'enviado', enviado_em: '2026-11-16T15:00:00Z' });
    expect((await processarAcao(deps(db), ctx({ agora: 'depois' }), { action: 'marcar_enviado', pedidoId: P1 })).status).toBe(200);
    expect(db.t.pedidos_compra[0].enviado_em).toBe('2026-11-16T15:00:00Z');
  });
});

describe('fora_de_linha', () => {
  const P2 = '00000000-0000-4000-8000-000000000002';
  const P3 = '00000000-0000-4000-8000-000000000003';
  const P4 = '00000000-0000-4000-8000-000000000004';
  const P5 = '00000000-0000-4000-8000-000000000005';
  const PX = '00000000-0000-4000-8000-0000000000ff';
  const fam = (id: string, codigo_pai: string, criado_em: string) => ({ id, codigo_pai, criado_em });
  const item = (pedido_id: string, codigo: string, codigo_pai: string, quantidade: number, org_id = ORG) =>
    ({ pedido_id, org_id, codigo, codigo_pai, quantidade, sugerida: quantidade, recebida: 0, encerrado: false });
  const ERR = {
    P0002: { code: 'P0002', message: 'reposicao_salvar_rascunho: rascunho não encontrado nesta organização' },
    R23514: { code: '23514', message: 'reposicao_salvar_rascunho: o pedido deixou de ser rascunho (está aprovado); recarregue a tela' },
  };
  // Efeito real da RPC (migration 20261117004919): checagens, tira os itens de quantidade 0, apaga rascunho vazio.
  const rpcReal = (t: Record<string, Linha[]>): Rpc => (a) => {
    const p = t.pedidos_compra.find((x) => x.id === a.p_pedido && x.org_id === a.p_org && x.fornecedor_id === a.p_fornecedor);
    if (!p) return { data: null, error: ERR.P0002 };
    if (p.status !== 'rascunho') return { data: null, error: ERR.R23514 };
    const zero = new Set(a.p_itens.filter((i: Linha) => i.quantidade === 0).map((i: Linha) => i.codigo));
    t.pedidos_compra_itens = t.pedidos_compra_itens.filter((i) => !(i.pedido_id === p.id && zero.has(i.codigo)));
    if (t.pedidos_compra_itens.some((i) => i.pedido_id === p.id)) return { data: p.id, error: null };
    t.pedidos_compra = t.pedidos_compra.filter((x) => x !== p);
    return { data: null, error: null };
  };
  // Rascunhos P1 (fo1), P2 (fo2), P4 (fo3); P3 aprovado; PX rascunho de outra org com o mesmo produto e cor.
  // SKU-X: Branco em PA, reutilizado como Preto em família MAIS RECENTE de PB.
  // Tudo inserido FORA da ordem das chaves: o resultado só sai certo se a leitura ordenar de verdade.
  function base(envolver: (real: Rpc, t: Record<string, Linha[]>) => Rpc = (real) => real) {
    const t: Record<string, Linha[]> = {
      pedidos_compra: [
        { id: PX, org_id: 'org-2', fornecedor_id: 'fx', status: 'rascunho' },
        { id: P4, org_id: ORG, fornecedor_id: 'fo3', status: 'rascunho' },
        { id: P3, org_id: ORG, fornecedor_id: 'fo1', status: 'aprovado' },
        { id: P2, org_id: ORG, fornecedor_id: 'fo2', status: 'rascunho' },
        { id: P1, org_id: ORG, fornecedor_id: 'fo9', status: 'rascunho' },
      ],
      pedidos_compra_itens: [
        item(PX, 'PA-PRE-P', 'PA', 6, 'org-2'),
        item(P4, 'PA-PRE-P', 'PA', 1), item(P4, 'PA-BRA-M', 'PA', 2),
        item(P3, 'PA-PRE-P', 'PA', 9),
        item(P2, 'PA-PRE-G', 'PA', 4),
        item(P1, 'SKU-X', 'PA', 1), item(P1, 'PB-PRE-P', 'PB', 7), item(P1, 'PA-PRE-P', 'PA', 3), item(P1, 'PA-BRA-P', 'PA', 5),
        item(P1, 'PA-PRE-M', 'PA', 2),
      ],
      variacoes: [
        { id: 'vx2', org_id: 'org-2', codigo: 'PA-PRE-P', cor: 'Preto', familias: fam('f-x', 'PA', '2026-09-01T00:00:00Z') },
        // outra org: mesmo código com outra cor não pode influenciar
        { id: 'vx1', org_id: 'org-2', codigo: 'PA-BRA-P', cor: 'Preto', familias: fam('f-x', 'PA', '2026-09-01T00:00:00Z') },
        { id: 'v9', org_id: ORG, codigo: 'PB-PRE-P', cor: 'Preto', familias: fam('f-pb', 'PB', '2026-09-01T00:00:00Z') },
        { id: 'v8', org_id: ORG, codigo: 'SKU-X', cor: 'Preto', familias: fam('f-pb', 'PB', '2026-09-01T00:00:00Z') },
        { id: 'v7', org_id: ORG, codigo: 'SKU-X', cor: 'Branco', familias: fam('f-nova', 'PA', '2026-06-01T00:00:00Z') },
        { id: 'v6', org_id: ORG, codigo: 'PA-BRA-M', cor: 'Branco', familias: fam('f-nova', 'PA', '2026-06-01T00:00:00Z') },
        { id: 'v5', org_id: ORG, codigo: 'PA-BRA-P', cor: 'Branco', familias: fam('f-nova', 'PA', '2026-06-01T00:00:00Z') },
        { id: 'v4', org_id: ORG, codigo: 'PA-PRE-G', cor: 'Preto', familias: fam('f-nova', 'PA', '2026-06-01T00:00:00Z') },
        { id: 'v3', org_id: ORG, codigo: 'PA-PRE-P', cor: 'Preto', familias: fam('f-nova', 'PA', '2026-06-01T00:00:00Z') },
        // família antiga dizia outra cor para PA-PRE-M; vale a mais recente do produto (regra do cálculo)
        { id: 'v2', org_id: ORG, codigo: 'PA-PRE-M', cor: 'Preto', familias: fam('f-nova', 'PA', '2026-06-01T00:00:00Z') },
        { id: 'v1', org_id: ORG, codigo: 'PA-PRE-M', cor: 'Branco', familias: fam('f-velha', 'PA', '2026-01-01T00:00:00Z') },
      ],
      reposicao_nao_repor: [],
    };
    return fakeDb(t, { reposicao_salvar_rascunho: envolver(rpcReal(t), t) });
  }
  const membro = ctx({ userId: 'u-membro', isAdmin: false });
  const COR = { action: 'fora_de_linha', escopo: 'cor', codigoPai: 'PA', cor: 'Preto' };
  const FAM = { action: 'fora_de_linha', escopo: 'familia', codigoPai: 'PA' };
  const zerados = (db: any) => db.chamadas.map((c: { args: Linha }) => [c.args.p_pedido, c.args.p_itens.map((i: Linha) => i.codigo)]);
  const codigos = (db: any, pedido: string) => db.t.pedidos_compra_itens.filter((i: Linha) => i.pedido_id === pedido).map((i: Linha) => i.codigo).sort();
  const pedidos = (db: any) => db.t.pedidos_compra.map((p: Linha) => p.id).sort();
  const leituras = (db: any, tabela: string) => db.consultas.filter((q: { tabela: string; op: string }) => q.tabela === tabela && q.op === 'select');

  it('escopo cor: marca com cor e codigo nulo; tira só a cor do produto e apaga o rascunho que esvazia', async () => {
    const db = base();
    const r = await processarAcao(deps(db), membro, COR);
    expect(r.status).toBe(200);
    expect(db.t.reposicao_nao_repor).toHaveLength(1);
    expect(db.t.reposicao_nao_repor[0]).toMatchObject({ org_id: ORG, escopo: 'cor', codigo_pai: 'PA', cor: 'Preto', codigo: null, criado_por: 'u-membro' });
    expect(r.body).toEqual({ ok: true, id: db.t.reposicao_nao_repor[0].id, removidos: { rascunhos: 3, unidades: 10 } });
    // pedidos pela ordem de id, itens pela ordem de codigo (inseridos ao contrário)
    expect(zerados(db)).toEqual([[P1, ['PA-PRE-M', 'PA-PRE-P']], [P2, ['PA-PRE-G']], [P4, ['PA-PRE-P']]]);
    expect(db.chamadas[0].args).toEqual({
      p_org: ORG, p_pedido: P1, p_fornecedor: 'fo9', p_usuario: 'u-membro', p_previsto: null, p_mudar_previsto: false,
      p_itens: [{ codigo: 'PA-PRE-M', codigo_pai: 'PA', quantidade: 0, sugerida: null }, { codigo: 'PA-PRE-P', codigo_pai: 'PA', quantidade: 0, sugerida: null }],
    });
    // SKU-X é Preto só no outro produto: fica. P2 esvaziou e foi apagado. P3 (aprovado) e PX (outra org) intactos.
    expect(codigos(db, P1)).toEqual(['PA-BRA-P', 'PB-PRE-P', 'SKU-X']);
    expect(codigos(db, P4)).toEqual(['PA-BRA-M']);
    expect(pedidos(db)).toEqual([P1, P3, P4, PX]);
    expect(codigos(db, P3)).toEqual(['PA-PRE-P']);
    expect(codigos(db, PX)).toEqual(['PA-PRE-P']);
  });

  it('pagina por cursor de chave: mesmo resultado com 2 linhas por página; ordem e cursor nas chaves únicas', async () => {
    const db = base();
    db.teto = 2;
    const r = await processarAcao({ ...deps(db), tamanhoPagina: 2 }, membro, COR);
    expect(r.body).toMatchObject({ removidos: { rascunhos: 3, unidades: 10 } });
    expect(zerados(db)).toEqual([[P1, ['PA-PRE-M', 'PA-PRE-P']], [P2, ['PA-PRE-G']], [P4, ['PA-PRE-P']]]);
    const chaves = (tabela: string) => leituras(db, tabela).map((q: { orders: string[]; gts: string[] }) => [q.orders, q.gts]);
    expect(chaves('pedidos_compra')).toEqual([[['id'], []], [['id'], ['id']]]);
    // 7 variações do produto nos códigos lidos → páginas 2+2+2+1
    expect(chaves('variacoes')).toEqual([[['id'], []], [['id'], ['id']], [['id'], ['id']], [['id'], ['id']]]);
    for (const [o, g] of chaves('pedidos_compra_itens')) { expect(o).toEqual(['codigo']); expect(g.every((k: string) => k === 'codigo')).toBe(true); }
    expect(chaves('pedidos_compra_itens').some(([, g]: string[][]) => g.length)).toBe(true);
  });

  it('corrida: rascunho aprovado entre a 1ª e a 2ª página não faz pular os seguintes', async () => {
    const db = base();
    db.teto = 2;
    let paginas = 0;
    db.antes = (tabela: string, op: string) => {
      if (tabela === 'pedidos_compra' && op === 'select' && ++paginas === 2) db.t.pedidos_compra.find((p: Linha) => p.id === P1).status = 'aprovado';
    };
    const r = await processarAcao({ ...deps(db), tamanhoPagina: 2 }, membro, COR);
    expect(r.status).toBe(200);
    // P1 virou aprovado (23514, intocado); P2 e P4 processados — com offset, P4 seria pulado
    expect(zerados(db).map((z: unknown[]) => z[0])).toEqual([P1, P2, P4]);
    expect(r.body).toMatchObject({ removidos: { rascunhos: 2, unidades: 5 } });
    expect(codigos(db, P4)).toEqual(['PA-BRA-M']);
    expect(codigos(db, P1)).toContain('PA-PRE-P');
  });

  it('cor pela família mais recente do produto que contém o SKU: exclusiva de família antiga, ordem inversa e empate', async () => {
    const db = base();
    db.t.pedidos_compra.push({ id: P5, org_id: ORG, fornecedor_id: 'fo5', status: 'rascunho' });
    db.t.pedidos_compra_itens.push(
      item(P5, 'PA-R1', 'PA', 1), item(P5, 'PA-NEG', 'PA', 1), item(P5, 'PA-GG', 'PA', 1), item(P5, 'PA-EMP', 'PA', 1),
    );
    const velha = fam('f-velha', 'PA', '2026-01-01T00:00:00Z');
    const nova = fam('f-nova', 'PA', '2026-06-01T00:00:00Z');
    db.t.variacoes.push(
      // só na família antiga (não na mais nova do produto): Preto vale
      { id: 'va00', org_id: ORG, codigo: 'PA-GG', cor: 'Preto', familias: velha },
      // chegam em ordem inversa (a mais nova primeiro): "última linha vence" erraria
      { id: 'va01', org_id: ORG, codigo: 'PA-R1', cor: 'Preto', familias: nova },
      { id: 'va02', org_id: ORG, codigo: 'PA-R1', cor: 'Branco', familias: velha },
      { id: 'va03', org_id: ORG, codigo: 'PA-NEG', cor: 'Branco', familias: nova },
      { id: 'va04', org_id: ORG, codigo: 'PA-NEG', cor: 'Preto', familias: velha },
      // mesma data: desempata pelo id da família (f-emp-b > f-emp-a)
      { id: 'va05', org_id: ORG, codigo: 'PA-EMP', cor: 'Branco', familias: fam('f-emp-a', 'PA', '2026-03-01T00:00:00Z') },
      { id: 'va06', org_id: ORG, codigo: 'PA-EMP', cor: 'Preto', familias: fam('f-emp-b', 'PA', '2026-03-01T00:00:00Z') },
    );
    await processarAcao(deps(db), membro, COR);
    expect(zerados(db).find((z: unknown[]) => z[0] === P5)).toEqual([P5, ['PA-EMP', 'PA-GG', 'PA-R1']]);
    expect(codigos(db, P5)).toEqual(['PA-NEG']);
  });

  it('todas as leituras filtram a org (pedido, item, variação)', async () => {
    const db = base();
    await processarAcao(deps(db), membro, COR);
    for (const tabela of ['pedidos_compra', 'pedidos_compra_itens', 'variacoes']) {
      expect(leituras(db, tabela).length).toBeGreaterThan(0);
      for (const q of leituras(db, tabela)) expect(q.eqs.org_id).toBe(ORG);
    }
    expect(leituras(db, 'pedidos_compra')[0].eqs.status).toBe('rascunho');
  });

  it('idempotente: 23505 devolve o mesmo id e o retry não acha mais nada', async () => {
    const db = base();
    const a = await processarAcao(deps(db), membro, COR);
    const b = await processarAcao(deps(db), membro, COR);
    expect(db.t.reposicao_nao_repor).toHaveLength(1);
    expect((b.body as { id: string }).id).toBe((a.body as { id: string }).id);
    expect(b.body).toMatchObject({ removidos: { rascunhos: 0, unidades: 0 } });
    expect(db.chamadas).toHaveLength(3);
  });

  it('falha parcial: marca fica, 1º rascunho limpo; retry termina sem recriar nada', async () => {
    let quebrar = true;
    const db = base((real) => (a) => (a.p_pedido === P2 && quebrar ? { data: null, error: { code: '57014', message: 'timeout' } } : real(a)));
    await expect(processarAcao(deps(db), membro, COR)).rejects.toThrow('timeout');
    const marca = db.t.reposicao_nao_repor[0].id;
    expect(db.t.reposicao_nao_repor).toHaveLength(1);
    expect(codigos(db, P1)).toEqual(['PA-BRA-P', 'PB-PRE-P', 'SKU-X']);
    expect(codigos(db, P2)).toEqual(['PA-PRE-G']);
    quebrar = false;
    const r = await processarAcao(deps(db), membro, COR);
    expect(r.body).toEqual({ ok: true, id: marca, removidos: { rascunhos: 2, unidades: 5 } });
    expect(zerados(db).slice(2)).toEqual([[P2, ['PA-PRE-G']], [P4, ['PA-PRE-P']]]);
    expect(db.t.reposicao_nao_repor).toHaveLength(1);
    expect(pedidos(db)).toEqual([P1, P3, P4, PX]);
    expect(codigos(db, P1)).toEqual(['PA-BRA-P', 'PB-PRE-P', 'SKU-X']);
  });

  it('escopo familia: tira todos os itens do produto (inclusive SKU-X) e não toca outro produto', async () => {
    const db = base();
    const r = await processarAcao(deps(db), membro, FAM);
    expect(r.body).toMatchObject({ removidos: { rascunhos: 3, unidades: 18 } });
    expect(db.t.reposicao_nao_repor[0]).toMatchObject({ escopo: 'familia', codigo_pai: 'PA', codigo: null, cor: null });
    expect(zerados(db)).toEqual([[P1, ['PA-BRA-P', 'PA-PRE-M', 'PA-PRE-P', 'SKU-X']], [P2, ['PA-PRE-G']], [P4, ['PA-BRA-M', 'PA-PRE-P']]]);
    expect(pedidos(db)).toEqual([P1, P3, PX]);
    expect(codigos(db, P1)).toEqual(['PB-PRE-P']);
    // de novo: a marca família (codigo e cor nulos) não duplica e devolve o mesmo id
    const b = await processarAcao(deps(db), membro, FAM);
    expect(db.t.reposicao_nao_repor).toHaveLength(1);
    expect((b.body as { id: string }).id).toBe((r.body as { id: string }).id);
  });

  it('aprovado no meio (23514) e rascunho que sumiu (P0002) são ignorados sem abortar nem contar', async () => {
    const db = base((real, t) => (a) => {
      if (a.p_pedido === P1) t.pedidos_compra.find((p) => p.id === P1)!.status = 'aprovado';
      if (a.p_pedido === P2) t.pedidos_compra = t.pedidos_compra.filter((p) => p.id !== P2);
      return real(a);
    });
    const r = await processarAcao(deps(db), membro, COR);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ removidos: { rascunhos: 1, unidades: 1 } });
    expect(zerados(db).map((z: unknown[]) => z[0])).toEqual([P1, P2, P4]);
    expect(codigos(db, P1)).toContain('PA-PRE-P');
  });

  it('nenhum rascunho afetado: não chama a RPC e removidos zerado', async () => {
    const db = base();
    const r = await processarAcao(deps(db), membro, { ...COR, cor: 'preto' }); // texto exato
    expect(r.body).toMatchObject({ removidos: { rascunhos: 0, unidades: 0 } });
    const s = await processarAcao(deps(db), membro, { ...FAM, codigoPai: 'NAO' });
    expect(s.body).toMatchObject({ removidos: { rascunhos: 0, unidades: 0 } });
    expect(db.chamadas).toHaveLength(0);
  });

  it('nao_repor por SKU grava o código, o retry devolve o id DAQUELE SKU e não limpa rascunho', async () => {
    const db = base();
    const sku = (codigo: string) => processarAcao(deps(db), membro, { action: 'nao_repor', escopo: 'sku', codigoPai: 'PA', codigo });
    const p = await sku('PA-PRE-P');
    expect(p.body).toEqual({ ok: true, id: db.t.reposicao_nao_repor[0].id });
    expect(db.t.reposicao_nao_repor[0]).toMatchObject({ escopo: 'sku', codigo_pai: 'PA', codigo: 'PA-PRE-P', cor: null });
    const m = await sku('PA-PRE-M');
    expect((m.body as { id: string }).id).not.toBe((p.body as { id: string }).id);
    expect((await sku('PA-PRE-P')).body).toEqual(p.body);
    expect((await sku('PA-PRE-M')).body).toEqual(m.body);
    expect(db.t.reposicao_nao_repor).toHaveLength(2);
    expect(db.chamadas).toHaveLength(0);
  });

  it('escopo sku, escopo ausente, cor ausente ou produto ausente → 400 sem gravar', async () => {
    const db = base();
    for (const corpo of [
      { escopo: 'sku', codigoPai: 'PA', codigo: 'PA-PRE-P' }, { codigoPai: 'PA' }, { escopo: 'cor', codigoPai: 'PA' },
      { escopo: 'cor', codigoPai: 'PA', cor: ' ' }, { escopo: 'familia' },
    ]) {
      expect((await processarAcao(deps(db), membro, { action: 'fora_de_linha', ...corpo })).status).toBe(400);
    }
    expect(db.t.reposicao_nao_repor).toHaveLength(0);
    expect(db.chamadas).toHaveLength(0);
  });

  it('módulo desabilitado → 403', async () => {
    const db = base();
    expect((await processarAcao(deps(db, false), membro, FAM)).status).toBe(403);
    expect(db.t.reposicao_nao_repor).toHaveLength(0);
  });

  it('isolamento por org: outra org vê só o próprio rascunho e a própria cor', async () => {
    const db = base();
    const r = await processarAcao(deps(db), ctx({ orgId: 'org-2' }), COR);
    expect(r.body).toMatchObject({ removidos: { rascunhos: 1, unidades: 6 } });
    expect(zerados(db)).toEqual([[PX, ['PA-PRE-P']]]);
    expect(db.t.reposicao_nao_repor[0].org_id).toBe('org-2');
    expect(pedidos(db)).toEqual([P1, P2, P3, P4]);
  });
});
