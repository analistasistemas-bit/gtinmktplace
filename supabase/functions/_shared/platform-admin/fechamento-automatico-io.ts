// IO do fechamento automático (ADR-0193 D-10/D-11). Fan-out por org no molde do resumo-diario
// (ADR-0173 sem worker_rodadas: cada job é 1 preview + 1 close, idempotente por (org, mês) porque o
// close devolve o statement existente). Três mensagens:
//  - disparo (sem orgId/aviso): fixa a competência, publica 1 job por org + 1 aviso atrasado.
//    Com dry_run: calcula tudo AQUI, sem publicar, sem auditar, sem enviar.
//  - org {orgId, month, run_id}: decide/fecha e grava o resultado em platform_audit_events.
//  - aviso {aviso, month, run_id, orgIds}: espera todas as orgs da rodada (500 → QStash retenta),
//    reserva a chave da competência e manda o Telegram com o bot da PLATAFORMA aos super-admins.
import { enviarTelegram } from '../notificacoes/telegram.ts';
import { chatPrivado } from '../notificacoes/destinatario.ts';
import {
  ACAO_AVISO, ACAO_RESULTADO, CATEGORIA_FECHAMENTO, ORIGEM, aguardando, competenciaAnterior, fecharOrg, mesAtualBrt,
  mesValido, mesesEntre, montarAviso, ultimoPorOrg,
  type DepsFechamento, type EventoResultado, type LinhaAviso, type PreviewMin, type ResultadoOrg,
} from './fechamento-automatico.ts';

// deno-lint-ignore no-explicit-any
type Admin = any;

export interface JobFechamento {
  month?: string;
  dry_run?: boolean;
  orgId?: string;
  run_id?: string;
  aviso?: boolean;
  orgIds?: string[];
}

export interface MsgQstash { url: string; body: unknown; retries: number; delay?: number }

export interface CtxFechamento {
  agora: Date;
  ator: string;
  tokenTelegram: string | null;
  linkCentral: string;
  url: string;
  /** Header Upstash-Retried da entrega atual (0 na 1ª). */
  retried: number;
  publicar(msgs: MsgQstash[]): Promise<unknown>;
  novoId(): string;
}

/** Erro de entrada → 400 no index. */
export class EntradaInvalida extends Error {}
/** Aviso chegou antes de todas as orgs terem resultado → 500 para o QStash retentar. */
export class AguardandoOrgs extends Error {}

const RETRIES_ORG = 3;
// Retries do aviso: backoff do QStash ≈ 12 s, 2,5 min, 30 min, 6 h — cobre os 3 retries das orgs.
export const RETRIES_AVISO = 4;
const ATRASO_AVISO_S = 300;

function falhou(onde: string, error: { message: string } | null) {
  if (error) throw new Error(`${onde}: ${error.message}`);
}

/** Orgs do fechamento: não arquivadas, não de teste (filtro padrão da carteira) e com contrato
 *  que começa até a competência. Sem contrato vigente na competência o preview diz 'ignorada'. */
async function orgsDoFechamento(admin: Admin, month: string): Promise<Array<{ id: string; nome: string }>> {
  const { data: termos, error: e1 } = await admin.from('platform_commercial_terms').select('org_id')
    .lte('starts_on', `${month}-01`).order('org_id').range(0, 999);
  falhou('contratos', e1);
  const ids = [...new Set(((termos ?? []) as Array<{ org_id: string }>).map((t) => t.org_id))];
  if (ids.length === 0) return [];
  const { data, error } = await admin.from('organizations').select('id,nome')
    .in('id', ids).eq('is_test', false).is('arquivada_em', null).order('id');
  falhou('organizações', error);
  return (data ?? []) as Array<{ id: string; nome: string }>;
}

function depsOrg(admin: Admin, ator: string, orgId: string, month: string): DepsFechamento {
  const p = { p_actor: ator, p_org: orgId, p_month: `${month}-01` };
  return {
    async statementDoMes() {
      const { data, error } = await admin.from('platform_billing_statements').select('id,total_cents')
        .eq('org_id', orgId).eq('month', `${month}-01`).maybeSingle();
      falhou('statement', error);
      return data ? { id: data.id as string, total_cents: Number(data.total_cents) } : null;
    },
    async preview() {
      const { data, error } = await admin.rpc('platform_billing_preview', p);
      falhou('preview', error);
      return data as PreviewMin;
    },
    async close(revision: string) {
      const { data, error } = await admin.rpc('platform_billing_close', { ...p, p_expected_revision: revision });
      if (error) throw new Error(error.message);
      return { id: data.id as string, total_cents: Number(data.total_cents) };
    },
    async mesAnteriorAberto() {
      const { data: t, error: e1 } = await admin.from('platform_commercial_terms').select('starts_on')
        .eq('org_id', orgId).lte('starts_on', `${month}-01`).order('starts_on').limit(1);
      falhou('primeiro contrato', e1);
      const primeiro = (t ?? [])[0]?.starts_on as string | undefined;
      if (!primeiro) return false;
      const { data: st, error: e2 } = await admin.from('platform_billing_statements').select('month')
        .eq('org_id', orgId).lt('month', `${month}-01`).order('month').range(0, 999);
      falhou('statements anteriores', e2);
      const fechados = new Set(((st ?? []) as Array<{ month: string }>).map((s) => s.month.slice(0, 7)));
      return mesesEntre(primeiro.slice(0, 7), month).some((m) => !fechados.has(m));
    },
  };
}

async function auditarResultado(admin: Admin, ator: string, orgId: string, month: string, runId: string, r: ResultadoOrg) {
  const { error } = await admin.from('platform_audit_events').insert({
    org_id: orgId, actor_id: ator, category: 'billing', action: ACAO_RESULTADO, result: r.resultado,
    target: month, reason: r.motivo,
    details: { origin: ORIGEM, month, run_id: runId, total_cents: r.total_cents, statement_id: r.statement_id, tentativas: r.tentativas },
  });
  falhou('auditoria', error);
}

/** Destinatários revalidados NO ENVIO: super-admin ativo, assinante, chat privado (sem repetir). */
async function chatsDoAviso(admin: Admin): Promise<string[]> {
  const { data, error } = await admin.from('profiles').select('id,telegram_chat_id')
    .eq('is_super_admin', true).eq('is_active', true).contains('telegram_categorias', [CATEGORIA_FECHAMENTO])
    .order('id').range(0, 999);
  falhou('destinatários', error);
  return [...new Set(((data ?? []) as Array<{ telegram_chat_id: string | null }>)
    .map((p) => p.telegram_chat_id?.trim() ?? '').filter(chatPrivado))];
}

async function nomes(admin: Admin, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await admin.from('organizations').select('id,nome').in('id', ids);
  falhou('nomes', error);
  return new Map(((data ?? []) as Array<{ id: string; nome: string }>).map((o) => [o.id, o.nome]));
}

async function processarAviso(admin: Admin, job: JobFechamento, ctx: CtxFechamento) {
  const month = job.month!; const runId = job.run_id!; const orgIds = job.orgIds ?? [];
  const { data, error } = await admin.from('platform_audit_events').select('org_id,result,reason,details,occurred_at')
    .eq('action', ACAO_RESULTADO).eq('target', month).eq('details->>run_id', runId).order('occurred_at').range(0, 999);
  falhou('resultados', error);
  const ultimos = ultimoPorOrg((data ?? []) as EventoResultado[]);
  const faltam = aguardando(orgIds, ultimos);
  if (faltam.length > 0 && ctx.retried < RETRIES_AVISO) throw new AguardandoOrgs(`${faltam.length} org(s) sem resultado final`);

  const nomePor = await nomes(admin, orgIds);
  const linhas: LinhaAviso[] = orgIds.map((id) => {
    const e = ultimos.get(id);
    return {
      nome: nomePor.get(id) ?? id,
      resultado: (e?.result ?? 'sem_resultado') as LinhaAviso['resultado'],
      total_cents: e?.details?.total_cents == null ? null : Number(e.details.total_cents),
      motivo: e?.reason ?? null,
    };
  });
  const texto = montarAviso(month, linhas, ctx.linkCentral);

  const chats = await chatsDoAviso(admin);
  if (chats.length === 0) return { enviados: 0, motivo: 'sem destinatário' };
  if (!ctx.tokenTelegram) { console.error('fechar-mes-plataforma: TELEGRAM_BOT_TOKEN ausente'); return { enviados: 0, motivo: 'sem bot' }; }

  // Chave da competência: só quem insere envia (índice único parcial; 23505 = já enviado).
  const { error: eRes } = await admin.from('platform_audit_events').insert({
    org_id: null, actor_id: ctx.ator, category: 'billing', action: ACAO_AVISO, result: 'success', target: month,
    details: { origin: ORIGEM, month, run_id: runId, destinatarios: chats.length },
  });
  if (eRes) {
    if ((eRes as { code?: string }).code === '23505') return { enviados: 0, duplicado: true };
    throw new Error(`reservar aviso: ${eRes.message}`);
  }
  // ponytail: melhor esforço depois da reserva (ADR-0173 §6) — queda aqui perde o Telegram; o resultado fica na auditoria.
  let enviados = 0;
  for (const chat of chats) if (await enviarTelegram(ctx.tokenTelegram, chat, texto)) enviados += 1;
  return { enviados };
}

export async function processarJobFechamento(admin: Admin, job: JobFechamento, ctx: CtxFechamento): Promise<Record<string, unknown>> {
  if (job.aviso) {
    if (!mesValido(job.month) || !job.run_id) throw new EntradaInvalida('aviso exige month e run_id');
    return processarAviso(admin, job, ctx);
  }

  if (job.orgId) {
    if (!mesValido(job.month) || !job.run_id) throw new EntradaInvalida('job da org exige month e run_id');
    const r = await fecharOrg(depsOrg(admin, ctx.ator, job.orgId, job.month), false);
    await auditarResultado(admin, ctx.ator, job.orgId, job.month, job.run_id, r);
    // 'erro' → 500 para o QStash retentar (o close é idempotente); o aviso usa o último resultado.
    if (r.resultado === 'erro') throw new Error(`org ${job.orgId}: ${r.motivo}`);
    return { org: job.orgId, ...r };
  }

  const month = job.month ?? competenciaAnterior(ctx.agora);
  if (!mesValido(month)) throw new EntradaInvalida('month deve ser YYYY-MM');
  if (month >= mesAtualBrt(ctx.agora)) throw new EntradaInvalida('só meses encerrados podem ser fechados');
  const orgs = await orgsDoFechamento(admin, month);

  if (job.dry_run) {
    const resultados: Array<{ org: string; nome: string } & ResultadoOrg> = [];
    for (const o of orgs) resultados.push({ org: o.id, nome: o.nome, ...(await fecharOrg(depsOrg(admin, ctx.ator, o.id, month), true)) });
    const texto = montarAviso(month, resultados, ctx.linkCentral, true);
    console.log(JSON.stringify({ fn: 'fechar-mes-plataforma', dry_run: true, month, resultados, texto }));
    return { dry_run: true, month, resultados, texto };
  }

  const runId = ctx.novoId();
  const orgIds = orgs.map((o) => o.id);
  await ctx.publicar([
    ...orgIds.map((orgId) => ({ url: ctx.url, body: { orgId, month, run_id: runId }, retries: RETRIES_ORG })),
    { url: ctx.url, body: { aviso: true, month, run_id: runId, orgIds }, retries: RETRIES_AVISO, delay: ATRASO_AVISO_S },
  ]);
  return { month, run_id: runId, publicados: orgIds.length };
}
