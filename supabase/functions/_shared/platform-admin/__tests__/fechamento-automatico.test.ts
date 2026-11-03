// ADR-0193 D-10/D-11: fechamento automático (decisão por org) + aviso de fechamento mensal.
// Banco falso em memória com filtros genéricos; Telegram via fetch stubado.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  competenciaAnterior, fecharOrg, mesesEntre, montarAviso, type DepsFechamento, type PreviewMin,
} from '../fechamento-automatico.ts';
import { validarAssinaturaAviso } from '../validation.ts';
import { AguardandoOrgs, EntradaInvalida, RETRIES_AVISO, processarJobFechamento, type CtxFechamento } from '../fechamento-automatico-io.ts';

const ATOR = '00000000-0000-4000-8000-000000000001';
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';
const MES = '2026-10';

type Row = Record<string, unknown>;
type Erro = { message: string; code?: string };

function previewOk(total = 12345, revision = 'r1'): PreviewMin {
  return { terms: { id: 't' }, blockers: [], revision, total_cents: total };
}

/** Banco falso: tabelas como arrays; rpc configurável por org. */
function fakeDb(init: { orgs?: Row[]; terms?: Row[]; statements?: Row[]; profiles?: Row[] } = {}) {
  const t: Record<string, Row[]> = {
    organizations: init.orgs ?? [], platform_commercial_terms: init.terms ?? [],
    platform_billing_statements: init.statements ?? [], profiles: init.profiles ?? [], platform_audit_events: [],
  };
  const previews = new Map<string, () => PreviewMin>();
  const closes = new Map<string, (rev: string) => Row>();
  let seq = 0;
  const writes: string[] = [];

  function query(table: string) {
    const preds: Array<(r: Row) => boolean> = [];
    let single = false; let lim = Infinity; let de = 0;
    const val = (r: Row, col: string) => col === 'details->>run_id' ? (r.details as Row | undefined)?.run_id : r[col];
    const exec = (): { data: unknown; error: Erro | null } => {
      const rows = t[table].filter((r) => preds.every((p) => p(r))).slice(de, de + lim);
      return { data: single ? rows[0] ?? null : rows, error: null };
    };
    // deno-lint-ignore no-explicit-any
    const q: any = {
      select: () => q, order: () => q,
      // PostgREST: max_rows = 1000 por requisição, mesmo com range maior.
      range: (a: number, b: number) => { de = a; lim = Math.min(b - a + 1, 1000); return q; },
      limit: (n: number) => { lim = n; return q; },
      eq: (c: string, v: unknown) => { preds.push((r) => val(r, c) === v); return q; },
      lte: (c: string, v: string) => { preds.push((r) => String(r[c]) <= v); return q; },
      lt: (c: string, v: string) => { preds.push((r) => String(r[c]) < v); return q; },
      in: (c: string, vs: unknown[]) => { preds.push((r) => vs.includes(r[c])); return q; },
      is: (c: string, v: unknown) => { preds.push((r) => (r[c] ?? null) === v); return q; },
      contains: (c: string, vs: unknown[]) => { preds.push((r) => vs.every((v) => ((r[c] as unknown[]) ?? []).includes(v))); return q; },
      maybeSingle: () => { single = true; return q; },
      update: () => { writes.push(`update:${table}`); return q; },
      upsert: () => { writes.push(`upsert:${table}`); return q; },
      insert: (row: Row) => {
        writes.push(`insert:${table}`);
        if (table === 'platform_audit_events' && row.action === 'fechamento_mensal_aviso'
          && t[table].some((r) => r.action === row.action && r.target === row.target)) {
          return Promise.resolve({ error: { message: 'duplicate key', code: '23505' } });
        }
        t[table].push({ ...row, occurred_at: new Date(Date.UTC(2026, 10, 1, 9, 0, seq++)).toISOString() });
        return Promise.resolve({ error: null });
      },
      then: (ok: (x: unknown) => unknown) => Promise.resolve(exec()).then(ok),
    };
    return q;
  }

  const admin = {
    from: (table: string) => { if (!(table in t)) throw new Error(`tabela inesperada ${table}`); return query(table); },
    rpc: async (fn: string, args: Row) => {
      const org = args.p_org as string;
      if (fn === 'platform_billing_preview') return { data: (previews.get(org) ?? (() => previewOk()))(), error: null };
      if (fn === 'platform_billing_close') {
        writes.push('close');
        try {
          const st = (closes.get(org) ?? (() => ({ id: `st-${org}`, total_cents: 12345 })))(args.p_expected_revision as string);
          t.platform_billing_statements.push({ org_id: org, month: args.p_month, ...st });
          return { data: st, error: null };
        } catch (e) { return { data: null, error: { message: (e as Error).message, code: 'P0001' } }; }
      }
      throw new Error(`rpc inesperado ${fn}`);
    },
  };
  return { admin, t, previews, closes, writes };
}

function ctx(over: Partial<CtxFechamento> = {}): CtxFechamento & { publicar: ReturnType<typeof vi.fn> } {
  return {
    agora: new Date('2026-11-01T09:00:00Z'), ator: ATOR, tokenTelegram: 'BOT', linkCentral: 'https://app/#/admin',
    url: 'https://fn/fechar-mes-plataforma', retried: 0, publicar: vi.fn(async (msgs: unknown[]) => msgs.map((_, i) => ({ messageId: `m${i}` }))), novoId: () => 'run-1', ...over,
  } as CtxFechamento & { publicar: ReturnType<typeof vi.fn> };
}

const ORGS = [
  { id: A, nome: 'Avil', is_test: false, arquivada_em: null },
  { id: B, nome: 'Beta', is_test: false, arquivada_em: null },
  { id: C, nome: 'Teste', is_test: true, arquivada_em: null },
];
const TERMS = [A, B, C].map((org_id) => ({ org_id, starts_on: '2026-10-01' }));
const SUPER = { id: 'u1', is_super_admin: true, is_active: true, telegram_chat_id: '111', telegram_categorias: ['fechamento_mensal'] };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const chatsEnviados = () => fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string).chat_id);

describe('fecharOrg (decisão)', () => {
  const deps = (over: Partial<DepsFechamento> = {}): DepsFechamento => ({
    statementDoMes: async () => null, preview: async () => previewOk(), mesAnteriorAberto: async () => false,
    close: async () => ({ id: 'st', total_cents: 500 }), ...over,
  });

  it('sem pendência → fecha com o total do statement', async () => {
    expect(await fecharOrg(deps(), false)).toMatchObject({ resultado: 'fechada', total_cents: 500, statement_id: 'st', tentativas: 1 });
  });
  it('já fechada vem antes de tudo (close não é chamado)', async () => {
    const close = vi.fn();
    expect(await fecharOrg(deps({ statementDoMes: async () => ({ id: 'x', total_cents: 9 }), close }), false))
      .toMatchObject({ resultado: 'ja_fechada', total_cents: 9 });
    expect(close).not.toHaveBeenCalled();
  });
  it('sem condições → ignorada (mesmo com o blocker commercial_terms_required)', async () => {
    const p = { ...previewOk(), terms: null, blockers: [{ code: 'commercial_terms_required', message: 'Condição comercial ausente' }] };
    expect((await fecharOrg(deps({ preview: async () => p }), false)).resultado).toBe('ignorada');
  });
  it('blockers → pendência com motivo, sem close', async () => {
    const close = vi.fn();
    const p = { ...previewOk(), blockers: [{ message: 'Devolução exige conciliação' }, { message: 'Devolução exige conciliação' }] };
    expect(await fecharOrg(deps({ preview: async () => p, close }), false))
      .toMatchObject({ resultado: 'pendencia', motivo: '2 pendências: Devolução exige conciliação' });
    expect(close).not.toHaveBeenCalled();
  });
  it('close recusa por mês anterior aberto', async () => {
    const r = await fecharOrg(deps({ close: async () => { throw new Error('previous billing month must be closed first'); } }), false);
    expect(r.resultado).toBe('mes_anterior_aberto');
  });
  it('conflito de revisão → nova prévia e 1 retry que fecha', async () => {
    const preview = vi.fn().mockResolvedValueOnce(previewOk(1, 'r1')).mockResolvedValueOnce(previewOk(2, 'r2'));
    const close = vi.fn().mockRejectedValueOnce(new Error('billing revision conflict')).mockResolvedValueOnce({ id: 'st', total_cents: 2 });
    expect(await fecharOrg(deps({ preview, close }), false)).toMatchObject({ resultado: 'fechada', total_cents: 2, tentativas: 2 });
    expect(close.mock.calls.map((c) => c[0])).toEqual(['r1', 'r2']);
  });
  it('conflito duas vezes → conflito (sem 3ª tentativa)', async () => {
    const close = vi.fn(async () => { throw new Error('billing revision conflict'); });
    expect(await fecharOrg(deps({ close }), false)).toMatchObject({ resultado: 'conflito', tentativas: 2 });
    expect(close).toHaveBeenCalledTimes(2);
  });
  it('erro inesperado → erro com a mensagem', async () => {
    expect(await fecharOrg(deps({ preview: async () => { throw new Error('preview: timeout'); } }), false))
      .toMatchObject({ resultado: 'erro', motivo: 'preview: timeout' });
  });
  it('dry_run nunca chama close e detecta mês anterior aberto', async () => {
    const close = vi.fn();
    expect(await fecharOrg(deps({ close }), true)).toMatchObject({ resultado: 'fecharia', total_cents: 12345 });
    expect(await fecharOrg(deps({ close, mesAnteriorAberto: async () => true }), true)).toMatchObject({ resultado: 'mes_anterior_aberto' });
    expect(close).not.toHaveBeenCalled();
  });
});

describe('competência e mensagem', () => {
  it('dia 01 06:00 BRT fecha o mês anterior; virada de ano', () => {
    expect(competenciaAnterior(new Date('2026-11-01T09:00:00Z'))).toBe('2026-10');
    expect(competenciaAnterior(new Date('2027-01-01T09:00:00Z'))).toBe('2026-12');
    // 01/11 01:00 UTC ainda é 31/10 em BRT
    expect(competenciaAnterior(new Date('2026-11-01T01:00:00Z'))).toBe('2026-09');
  });
  it('mesesEntre', () => {
    expect(mesesEntre('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(mesesEntre('2026-10', '2026-10')).toEqual([]);
  });
  it('montarAviso: cabeçalho com total das fechadas, uma linha por org, ignorada fora, link', () => {
    const texto = montarAviso(MES, [
      { nome: 'Beta', resultado: 'pendencia', total_cents: null, motivo: '1 pendência: X' },
      { nome: 'Avil', resultado: 'fechada', total_cents: 123456, motivo: null },
      { nome: 'Zeta', resultado: 'ja_fechada', total_cents: 100, motivo: null },
      { nome: 'Sem contrato', resultado: 'ignorada', total_cents: null, motivo: null },
    ], 'https://app/#/admin');
    expect(texto).toBe([
      '📒 Fechamento de Outubro/2026 · 2 orgs fechadas · total a receber R$ 1.235,56',
      '',
      '✅ Avil · R$ 1.234,56',
      '⏸ Beta · 1 pendência: X',
      '✅ Zeta · R$ 1,00 (já fechada)',
      '',
      'Central: https://app/#/admin',
    ].join('\n'));
  });
  it('validarAssinaturaAviso exige chat privado para ativar', () => {
    expect(validarAssinaturaAviso({ chat_id: ' 123 ', ativo: true })).toEqual({ chatId: '123', ativo: true });
    expect(() => validarAssinaturaAviso({ chat_id: '-100', ativo: true })).toThrow(TypeError);
    expect(() => validarAssinaturaAviso({ chat_id: '', ativo: true })).toThrow(TypeError);
    expect(() => validarAssinaturaAviso({ chat_id: 'abc', ativo: false })).toThrow(TypeError);
    expect(validarAssinaturaAviso({ chat_id: '', ativo: false })).toEqual({ chatId: null, ativo: false });
  });
});

describe('processarJobFechamento (IO)', () => {
  it('disparo: competência anterior, 1 job por org real (sem teste) + aviso atrasado', async () => {
    const db = fakeDb({ orgs: ORGS, terms: TERMS });
    const c = ctx();
    expect(await processarJobFechamento(db.admin, {}, c)).toEqual({ month: MES, run_id: 'run-1', publicados: 2 });
    const msgs = c.publicar.mock.calls.flatMap((call) => call[0]);
    expect(msgs.map((m: { body: unknown }) => m.body)).toEqual([
      { orgId: A, month: MES, run_id: 'run-1' }, { orgId: B, month: MES, run_id: 'run-1' },
      { aviso: true, month: MES, run_id: 'run-1', orgIds: [A, B] },
    ]);
    expect(msgs[2].delay).toBeGreaterThan(0);
    // o aviso só sai depois dos jobs confirmados (chamada separada, posterior)
    expect(c.publicar.mock.calls.at(-1)![0].map((m: { body: Row }) => m.body.aviso)).toEqual([true]);
    expect(db.writes).toEqual([]);
  });

  it('disparo recusa mês corrente/futuro e mês inválido', async () => {
    const db = fakeDb();
    await expect(processarJobFechamento(db.admin, { month: '2026-11' }, ctx())).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(processarJobFechamento(db.admin, { month: '2026-13' }, ctx())).rejects.toBeInstanceOf(EntradaInvalida);
  });

  it('dry_run: calcula e relata sem publicar, fechar, auditar nem enviar', async () => {
    const db = fakeDb({ orgs: ORGS, terms: TERMS, profiles: [SUPER] });
    db.previews.set(B, () => ({ ...previewOk(), blockers: [{ message: 'Devolução' }] }));
    const c = ctx();
    const r = await processarJobFechamento(db.admin, { month: MES, dry_run: true }, c) as { resultados: Array<{ resultado: string }>; texto: string };
    expect(r.resultados.map((x) => x.resultado)).toEqual(['fecharia', 'pendencia']);
    expect(r.texto).toContain('🧪 Simulação · Fechamento de Outubro/2026 · 1 org fecharia');
    expect(db.writes).toEqual([]);
    expect(c.publicar).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('job da org: fecha e audita com origem/ator; 2ª execução = já fechada sem 2º close', async () => {
    const db = fakeDb({ orgs: ORGS, terms: TERMS });
    const job = { orgId: A, month: MES, run_id: 'run-1' };
    expect(await processarJobFechamento(db.admin, job, ctx())).toMatchObject({ resultado: 'fechada', total_cents: 12345 });
    expect(await processarJobFechamento(db.admin, job, ctx())).toMatchObject({ resultado: 'ja_fechada', total_cents: 12345 });
    expect(db.writes.filter((w) => w === 'close')).toHaveLength(1);
    expect(db.t.platform_audit_events.map((e) => e.result)).toEqual(['fechada', 'ja_fechada']);
    expect(db.t.platform_audit_events[0]).toMatchObject({
      org_id: A, actor_id: ATOR, category: 'billing', action: 'fechamento_automatico', target: MES,
      details: expect.objectContaining({ origin: 'fechamento_automatico', run_id: 'run-1', total_cents: 12345 }),
    });
  });

  it('job da org: pendência e mês anterior aberto ficam abertos (auditados, 200)', async () => {
    const db = fakeDb();
    db.previews.set(A, () => ({ ...previewOk(), blockers: [{ message: 'X' }] }));
    db.closes.set(B, () => { throw new Error('previous billing month must be closed first'); });
    expect(await processarJobFechamento(db.admin, { orgId: A, month: MES, run_id: 'r' }, ctx())).toMatchObject({ resultado: 'pendencia' });
    expect(await processarJobFechamento(db.admin, { orgId: B, month: MES, run_id: 'r' }, ctx())).toMatchObject({ resultado: 'mes_anterior_aberto' });
    expect(db.t.platform_billing_statements).toHaveLength(0);
  });

  it('job da org: conflito com 1 retry fecha', async () => {
    const db = fakeDb();
    let n = 0;
    db.closes.set(A, (rev) => { if (n++ === 0) throw new Error('billing revision conflict'); return { id: 'st', total_cents: 7, rev }; });
    expect(await processarJobFechamento(db.admin, { orgId: A, month: MES, run_id: 'r' }, ctx())).toMatchObject({ resultado: 'fechada', tentativas: 2 });
  });

  it('job da org: erro é auditado e lança (500 → QStash retenta)', async () => {
    const db = fakeDb();
    db.closes.set(A, () => { throw new Error('active platform admin required'); });
    await expect(processarJobFechamento(db.admin, { orgId: A, month: MES, run_id: 'r' }, ctx())).rejects.toThrow(/active platform admin/);
    expect(db.t.platform_audit_events[0]).toMatchObject({ result: 'erro', reason: 'active platform admin required' });
  });

  async function rodada(db: ReturnType<typeof fakeDb>) {
    for (const orgId of [A, B]) await processarJobFechamento(db.admin, { orgId, month: MES, run_id: 'run-1' }, ctx()).catch(() => {});
  }
  const aviso = { aviso: true, month: MES, run_id: 'run-1', orgIds: [A, B] };

  it('aviso: uma mensagem por competência (2ª execução não reenvia)', async () => {
    const db = fakeDb({ orgs: ORGS, profiles: [SUPER] });
    db.previews.set(B, () => ({ ...previewOk(), blockers: [{ message: 'Devolução' }] }));
    await rodada(db);
    expect(await processarJobFechamento(db.admin, aviso, ctx())).toEqual({ enviados: 1 });
    expect(chatsEnviados()).toEqual(['111']);
    const texto = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).text as string;
    expect(texto).toContain('📒 Fechamento de Outubro/2026 · 1 org fechada · total a receber R$ 123,45');
    expect(texto).toContain('⏸ Beta · 1 pendência: Devolução');
    expect(fetchMock.mock.calls[0][0]).toContain('/botBOT/');

    // 2ª rodada inteira (idempotente) + 2º aviso: já fechada, nenhuma mensagem nova.
    await rodada(db);
    expect(await processarJobFechamento(db.admin, aviso, ctx())).toEqual({ enviados: 0, duplicado: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aviso: destinatário revalidado (não super-admin, inativo, sem assinatura, grupo) não recebe', async () => {
    const db = fakeDb({
      orgs: ORGS, profiles: [
        SUPER,
        { ...SUPER, id: 'u2', telegram_chat_id: '222', is_super_admin: false },
        { ...SUPER, id: 'u3', telegram_chat_id: '333', is_active: false },
        { ...SUPER, id: 'u4', telegram_chat_id: '444', telegram_categorias: ['vendas'] },
        { ...SUPER, id: 'u5', telegram_chat_id: '-100555' },
        { ...SUPER, id: 'u6', telegram_chat_id: '111' },
      ],
    });
    await rodada(db);
    await processarJobFechamento(db.admin, aviso, ctx());
    expect(chatsEnviados()).toEqual(['111']);
  });

  it('aviso: org sem resultado final → aguarda (500); no último retry envia com "sem resultado"', async () => {
    const db = fakeDb({ orgs: ORGS, profiles: [SUPER] });
    await processarJobFechamento(db.admin, { orgId: A, month: MES, run_id: 'run-1' }, ctx());
    await expect(processarJobFechamento(db.admin, aviso, ctx())).rejects.toBeInstanceOf(AguardandoOrgs);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.t.platform_audit_events.some((e) => e.action === 'fechamento_mensal_aviso')).toBe(false);
    await processarJobFechamento(db.admin, aviso, ctx({ retried: RETRIES_AVISO }));
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).text).toContain('⚠️ Beta · sem resultado (ver auditoria)');
  });

  it('aviso sem destinatário não reserva a chave', async () => {
    const db = fakeDb({ orgs: ORGS });
    await rodada(db);
    expect(await processarJobFechamento(db.admin, aviso, ctx())).toEqual({ enviados: 0, motivo: 'sem destinatário' });
    expect(db.t.platform_audit_events.some((e) => e.action === 'fechamento_mensal_aviso')).toBe(false);
  });
});

describe('Codex Fatia 3 — achado 1: body estrito, dry_run nunca escreve', () => {
  const RUN = 'run-1';
  it.each([
    ['job da org com dry_run', { orgId: A, month: MES, run_id: RUN, dry_run: true }],
    ['job da org com dry_run false', { orgId: A, month: MES, run_id: RUN, dry_run: false }],
    ['aviso com dry_run', { aviso: true, month: MES, run_id: RUN, orgIds: [A], dry_run: true }],
    ['orgId + aviso juntos', { aviso: true, orgId: A, month: MES, run_id: RUN, orgIds: [A] }],
    ['job da org sem run_id', { orgId: A, month: MES }],
    ['job da org com orgId inválido', { orgId: 'x', month: MES, run_id: RUN }],
    ['aviso sem orgIds', { aviso: true, month: MES, run_id: RUN }],
    ['aviso com orgId inválido na lista', { aviso: true, month: MES, run_id: RUN, orgIds: ['x'] }],
    ['aviso: false', { aviso: false, month: MES }],
    ['disparo com run_id', { month: MES, run_id: RUN }],
    ['disparo com orgIds', { month: MES, orgIds: [A] }],
    ['dry_run não booleano', { month: MES, dry_run: 'true' }],
    ['chave desconhecida', { month: MES, dryRun: true }],
    ['body não-objeto (array)', [] as unknown],
    ['body null', null as unknown],
  ])('%s → EntradaInvalida sem nenhuma leitura/escrita/publicação/envio', async (_l, job) => {
    const db = fakeDb({ orgs: ORGS, terms: TERMS, profiles: [SUPER] });
    const from = vi.spyOn(db.admin, 'from'); const rpc = vi.spyOn(db.admin, 'rpc');
    const c = ctx({ retried: RETRIES_AVISO });
    // deno-lint-ignore no-explicit-any
    await expect(processarJobFechamento(db.admin, job as any, c)).rejects.toBeInstanceOf(EntradaInvalida);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
    expect(c.publicar).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Codex Fatia 3 — achado 2: batch do QStash parcial', () => {
  const ok = (msgs: unknown[]) => msgs.map((_, i) => ({ messageId: `m${i}` }));

  it('resposta mista: retenta só os jobs que falharam (mesmo run_id) e só então publica o aviso', async () => {
    const db = fakeDb({ orgs: ORGS, terms: TERMS });
    const publicar = vi.fn()
      .mockResolvedValueOnce([{ messageId: 'a' }, { error: 'rate limited' }])
      .mockImplementation(async (msgs: unknown[]) => ok(msgs));
    const c = ctx({ publicar });
    expect(await processarJobFechamento(db.admin, {}, c)).toMatchObject({ publicados: 2 });
    const bodies = publicar.mock.calls.map((call) => call[0].map((m: { body: Row }) => m.body));
    expect(bodies).toEqual([
      [{ orgId: A, month: MES, run_id: 'run-1' }, { orgId: B, month: MES, run_id: 'run-1' }],
      [{ orgId: B, month: MES, run_id: 'run-1' }],
      [{ aviso: true, month: MES, run_id: 'run-1', orgIds: [A, B] }],
    ]);
  });

  it('falha persistente de um job → lança (500 ao schedule) e o aviso NÃO é publicado', async () => {
    const db = fakeDb({ orgs: ORGS, terms: TERMS });
    const publicar = vi.fn(async (msgs: Array<{ body: Row }>) =>
      msgs.map((m, i) => (m.body.orgId === B ? { error: 'falhou' } : { messageId: `m${i}` })));
    const c = ctx({ publicar });
    await expect(processarJobFechamento(db.admin, {}, c)).rejects.toThrow(/1 job/);
    expect(publicar.mock.calls.flatMap((call) => call[0]).some((m: { body: Row }) => m.body.aviso)).toBe(false);
  });

  it('aviso recusado pelo batch → lança (500)', async () => {
    const db = fakeDb({ orgs: ORGS, terms: TERMS });
    const publicar = vi.fn(async (msgs: Array<{ body: Row }>) =>
      msgs.map((m, i) => (m.body.aviso ? { error: 'falhou' } : { messageId: `m${i}` })));
    await expect(processarJobFechamento(db.admin, {}, ctx({ publicar }))).rejects.toThrow(/aviso/);
  });
});

describe('Codex Fatia 3 — achado 3: leituras paginadas (1.001+ linhas)', () => {
  it('contratos: org com versões além da 1ª página não some', async () => {
    const terms = [...Array.from({ length: 1001 }, () => ({ org_id: A, starts_on: '2026-09-01' })), { org_id: B, starts_on: '2026-10-01' }];
    const db = fakeDb({ orgs: ORGS, terms });
    const c = ctx();
    expect(await processarJobFechamento(db.admin, {}, c)).toMatchObject({ publicados: 2 });
  });

  it('aviso: resultado mais recente além da 1ª página prevalece', async () => {
    const db = fakeDb({ orgs: ORGS, profiles: [SUPER] });
    for (let i = 0; i < 1001; i++) {
      db.t.platform_audit_events.push({ org_id: A, action: 'fechamento_automatico', target: MES, result: 'erro', reason: 'x',
        details: { run_id: 'run-1' }, occurred_at: `2026-11-01T09:00:00.${String(i).padStart(3, '0')}Z` });
    }
    db.t.platform_audit_events.push({ org_id: A, action: 'fechamento_automatico', target: MES, result: 'fechada', reason: null,
      details: { run_id: 'run-1', total_cents: 500 }, occurred_at: '2026-11-01T09:05:00.000Z' });
    expect(await processarJobFechamento(db.admin, { aviso: true, month: MES, run_id: 'run-1', orgIds: [A] }, ctx())).toEqual({ enviados: 1 });
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).text).toContain('✅ Avil · R$ 5,00');
  });
});
