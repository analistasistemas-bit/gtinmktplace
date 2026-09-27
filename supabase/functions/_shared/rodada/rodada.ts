// ADR-0173: protocolo compartilhado de execução por (job, org) do fan-out de workers agendados.
// Puro — sem Deno/npm — pra ser testável direto por vitest. Contrato do banco: cabeçalho de
// supabase/migrations/20260927205804_worker_rodadas.sql (posse com lease, CAS do cursor,
// notificação durável). Fiação real (Supabase + QStash) em deps.ts (Task 3 liga o worker nela).

export type Job = 'pulse-completo' | 'pulse-quente' | 'backfill' | 'backfill-recuperacao' | 'reconciliar';
export type Acumulado = Record<string, number>;
export type ResultadoMsg =
  | 'executado' | 'continua' | 'obsoleta' | 'concluida' | 'sem_acesso' | 'ocupada' | 'erro' | 'repetir';

export interface MsgOrg<P extends Record<string, unknown> = Record<string, unknown>> {
  modo: 'org';
  job: Job;
  org_id: string;
  ciclo: string;
  params: P;
}

/** Token/conexão inválidos (ou org sem acesso ao canal): a rodada fecha como `sem_acesso`. */
export class SemAcessoRodada extends Error {}

export interface Cursor { etapa: string; pos: string }

export function lerCursor(c: string | null | undefined): Cursor | null {
  if (c == null) return null;
  const i = c.indexOf('|');
  // Cursor malformado NUNCA reinicia o ciclo em silêncio — isso perderia o progresso sem avisar.
  if (i === -1) throw new Error(`cursor inválido: ${c}`);
  return { etapa: c.slice(0, i), pos: c.slice(i + 1) };
}

export const gravarCursor = (c: Cursor): string => `${c.etapa}|${c.pos}`;

export const cicloDiaBrt = (d: Date): string => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

export const cicloHoraUtc = (d: Date): string => d.toISOString().slice(0, 13);

/** Chave de deduplicação do QStash: identifica (fn, job, org, ciclo, cursor) pra não republicar o
 *  MESMO lote duas vezes. NÃO impede uma entrega duplicada de bifurcar a cadeia em duas execuções
 *  paralelas — quem garante isso é o lease/CAS de executarMensagem, não este dedup. */
export const dedupMsg = (fn: string, m: Pick<MsgOrg, 'job' | 'org_id' | 'ciclo'>, cursor: string | null) =>
  `${fn}:${m.job}:${m.org_id}:${m.ciclo}:${cursor ?? 'inicio'}`.replace(/[^A-Za-z0-9_-]/g, '_');

const JOBS: readonly Job[] = ['pulse-completo', 'pulse-quente', 'backfill', 'backfill-recuperacao', 'reconciliar'];

export function ehMsgOrg(x: unknown): x is MsgOrg {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return o.modo === 'org'
    && typeof o.job === 'string' && (JOBS as readonly string[]).includes(o.job)
    && typeof o.org_id === 'string'
    && typeof o.ciclo === 'string'
    && typeof o.params === 'object' && o.params !== null;
}

export type Rota = 'org' | 'invalida' | 'disparo' | 'legado' | 'manual';

/** Decide o caminho de uma requisição de worker em fan-out. Sem assinatura QStash → manual (JWT). */
export function rotear(temAssinatura: boolean, parsed: unknown, flagAtiva: boolean): Rota {
  if (!temAssinatura) return 'manual';
  if (ehMsgOrg(parsed)) return 'org';
  // `modo:'org'` malformado NUNCA cai no disparador/legado global: 400 e log (guarda permanente).
  if (parsed && typeof parsed === 'object' && (parsed as { modo?: unknown }).modo === 'org') return 'invalida';
  return flagAtiva ? 'disparo' : 'legado';
}

export interface EntradaPasso<P extends Record<string, unknown> = Record<string, unknown>> {
  cursor: string | null;
  acumulado: Acumulado;
  params: P;
}

/** `parcial` = a rodada termina com pendência de pedido não resolvida (só lido quando `proximo === null`). */
export interface ResultadoPasso { proximo: string | null; acumulado: Acumulado; parcial?: string | null }

export type Passo<P extends Record<string, unknown> = Record<string, unknown>> =
  (e: EntradaPasso<P>) => Promise<ResultadoPasso>;

export interface Abertura {
  resultado: 'executar' | 'ocupada' | 'obsoleta' | 'concluida' | 'notificar_anterior';
  lease: string | null;
  estado: string;
  ciclo: string;
  cursor: string | null;
  acumulado: Acumulado;
  params: Record<string, unknown>;
  notificarPendente: boolean;
}

export interface DepsRodada {
  abrir(m: MsgOrg): Promise<Abertura>;
  avancar(m: MsgOrg, lease: string, cursorNovo: string, acumulado: Acumulado): Promise<boolean>;
  concluir(m: MsgOrg, lease: string, estado: 'ok' | 'parcial' | 'sem_acesso', erro: string | null,
    acumulado: Acumulado | null, notificar: boolean): Promise<boolean>;
  liberar(m: MsgOrg, lease: string, erro: string | null): Promise<void>;
  marcarNotificado(m: MsgOrg, lease: string): Promise<boolean>;
  publicar(m: MsgOrg, cursor: string): Promise<void>;
}

export interface OpcoesMsg {
  precisaNotificar?: (acumulado: Acumulado) => boolean;
  /** Grava in-app com chave idempotente de (job, org, ciclo) e LANÇA se não conseguir; Telegram é
   *  melhor esforço (ver Task 3). Lança → 500 e retry. */
  notificar?: (acumulado: Acumulado, ciclo: string) => Promise<void>;
}

const msgErro = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function executarMensagem<P extends Record<string, unknown> = Record<string, unknown>>(
  deps: DepsRodada,
  m: MsgOrg<P>,
  passo: Passo<P>,
  op: OpcoesMsg = {},
): Promise<ResultadoMsg> {
  const a = await deps.abrir(m);
  if (a.resultado === 'obsoleta' || a.resultado === 'concluida' || a.resultado === 'ocupada') return a.resultado;
  const lease = a.lease!;
  const log = (ev: string, extra: Record<string, unknown> = {}) =>
    console.log(`[rodada] ${ev}`, { job: m.job, org_id: m.org_id, ciclo: m.ciclo, ...extra });

  // Notificação pendente (deste ciclo, ou do anterior antes de abrir o novo). A posse é nossa.
  if (a.resultado === 'notificar_anterior' || a.estado !== 'rodando') {
    try {
      if (a.notificarPendente && op.notificar) await op.notificar(a.acumulado, a.ciclo);
      await deps.marcarNotificado(m, lease);
    } catch (e) {
      await deps.liberar(m, lease, msgErro(e));
      log('notificacao falhou', { ciclo_notificado: a.ciclo, erro: msgErro(e) });
      return 'erro';
    }
    return a.resultado === 'notificar_anterior' ? 'repetir' : 'executado'; // repetir → 500 → abre o ciclo novo
  }

  const inicio = Date.now();
  let r: ResultadoPasso;
  try {
    r = await passo({ cursor: a.cursor, acumulado: a.acumulado, params: a.params as P });
  } catch (e) {
    if (e instanceof SemAcessoRodada) {
      // false = a posse venceu durante o lote. NÃO retorna 'sem_acesso' por cima: sem o commit, a
      // linha fica presa em 'rodando' e o retorno enganaria o caller com um 200 que não aconteceu.
      if (!(await deps.concluir(m, lease, 'sem_acesso', msgErro(e), null, false))) return 'erro';
      log('sem_acesso', { erro: msgErro(e) });
      return 'sem_acesso';
    }
    await deps.liberar(m, lease, msgErro(e));
    log('lote falhou', { cursor: a.cursor, erro: msgErro(e) });
    return 'erro';
  }
  log('lote', { cursor: a.cursor, proximo: r.proximo, ms: Date.now() - inicio });

  if (r.proximo === null) {
    const estado = r.parcial ? 'parcial' : 'ok';
    const notificar = !!op.precisaNotificar?.(r.acumulado);
    // false = a posse venceu durante o lote. NÃO é 'obsoleta': o retry refaz o último lote (idempotente).
    if (!(await deps.concluir(m, lease, estado, r.parcial ?? null, r.acumulado, notificar))) return 'erro';
    if (!notificar || !op.notificar) return 'executado';
    try { await op.notificar(r.acumulado, m.ciclo); await deps.marcarNotificado(m, lease); return 'executado'; }
    catch (e) { await deps.liberar(m, lease, msgErro(e)); log('notificacao falhou', { erro: msgErro(e) }); return 'erro'; }
  }

  if (!(await deps.avancar(m, lease, r.proximo, r.acumulado))) return 'erro'; // posse venceu → retry refaz
  try {
    await deps.publicar(m, r.proximo);
  } catch (e) {
    // Cursor já avançou no banco. O retry desta mensagem lê o cursor novo e segue a cadeia.
    await deps.liberar(m, lease, msgErro(e));
    log('publicar falhou', { proximo: r.proximo, erro: msgErro(e) });
    return 'erro';
  }
  await deps.liberar(m, lease, null);
  return 'continua';
}

export const statusHttp = (r: ResultadoMsg): number => (r === 'erro' || r === 'ocupada' || r === 'repetir' ? 500 : 200);
