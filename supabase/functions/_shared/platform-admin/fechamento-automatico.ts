// Fechamento automático do demonstrativo (ADR-0193 D-10) e aviso de fechamento mensal (D-11).
// Lógica pura: decide o resultado de uma org a partir de prévia/fechamento injetados e formata o
// aviso. Sem Deno, sem QStash, sem banco — o IO fica em fechamento-automatico-io.ts.
import { brl } from '../notificacoes/gerencial/mensagens.ts';

/** Categoria de PLATAFORMA (não entra em CATEGORIAS_NOTIFICACAO, que é por org): só super-admin assina. */
export const CATEGORIA_FECHAMENTO = 'fechamento_mensal';
export const ORIGEM = 'fechamento_automatico';
export const ACAO_RESULTADO = 'fechamento_automatico';
export const ACAO_AVISO = 'fechamento_mensal_aviso';

export type Resultado =
  | 'fechada' | 'ja_fechada' | 'pendencia' | 'mes_anterior_aberto' | 'conflito' | 'erro' | 'ignorada'
  | 'fecharia'; // só no dry_run

export interface ResultadoOrg {
  resultado: Resultado;
  total_cents: number | null;
  motivo: string | null;
  statement_id: string | null;
  tentativas: number;
}

// Mensagens de `raise exception` de platform_billing_close (migration 20260918010100_platform_billing_tiers.sql).
// Três causas usam o mesmo errcode 23514 — por isso a classificação é pelo texto.
export const ERRO_CONFLITO = 'billing revision conflict';
export const ERRO_MES_ANTERIOR = 'previous billing month must be closed first';
export const ERRO_PENDENCIA = 'billing preview has blockers';
export const ERRO_SEM_CONDICOES = 'commercial terms required';

export interface PreviewMin {
  terms: unknown;
  blockers: Array<{ code?: string; message?: string }>;
  revision: string;
  total_cents: number;
}

export interface DepsFechamento {
  /** Statement já fechado de (org, mês), ou null. */
  statementDoMes(): Promise<{ id: string; total_cents: number } | null>;
  preview(): Promise<PreviewMin>;
  /** platform_billing_close; erro do RPC lança Error(message). */
  close(revision: string): Promise<{ id: string; total_cents: number }>;
  /** Só no dry_run: algum mês desde o 1º contrato até o anterior está sem statement? (o close checa sozinho) */
  mesAnteriorAberto(): Promise<boolean>;
}

const res = (resultado: Resultado, extra: Partial<ResultadoOrg> = {}): ResultadoOrg =>
  ({ resultado, total_cents: null, motivo: null, statement_id: null, tentativas: 0, ...extra });

const semCondicoes = (p: PreviewMin) => p.terms == null;

function motivoPendencia(p: PreviewMin): string {
  const msgs = [...new Set(p.blockers.map((b) => b.message || b.code || 'pendência'))];
  const n = p.blockers.length;
  return `${n} ${n === 1 ? 'pendência' : 'pendências'}: ${msgs.join('; ')}`;
}

/** Decide e (fora do dry_run) fecha uma org. Ordem: já fechada → sem condições → pendência → close.
 *  Conflito de revisão → nova prévia e 1 retry. Qualquer exceção inesperada → 'erro'. */
export async function fecharOrg(deps: DepsFechamento, dryRun: boolean): Promise<ResultadoOrg> {
  try {
    const existente = await deps.statementDoMes();
    if (existente) return res('ja_fechada', { total_cents: existente.total_cents, statement_id: existente.id });

    let preview = await deps.preview();
    if (semCondicoes(preview)) return res('ignorada');
    if (preview.blockers.length > 0) return res('pendencia', { motivo: motivoPendencia(preview) });

    if (dryRun) {
      if (await deps.mesAnteriorAberto()) return res('mes_anterior_aberto', { motivo: 'mês anterior aberto' });
      return res('fecharia', { total_cents: preview.total_cents });
    }

    for (let tentativa = 1; ; tentativa++) {
      try {
        const st = await deps.close(preview.revision);
        return res('fechada', { total_cents: st.total_cents, statement_id: st.id, tentativas: tentativa });
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        if (msg.includes(ERRO_MES_ANTERIOR)) return res('mes_anterior_aberto', { motivo: 'mês anterior aberto', tentativas: tentativa });
        if (msg.includes(ERRO_PENDENCIA)) return res('pendencia', { motivo: 'pendência surgiu durante o fechamento', tentativas: tentativa });
        if (msg.includes(ERRO_SEM_CONDICOES)) return res('ignorada', { tentativas: tentativa });
        if (!msg.includes(ERRO_CONFLITO)) return res('erro', { motivo: msg, tentativas: tentativa });
        if (tentativa >= 2) return res('conflito', { motivo: 'revisão mudou durante o fechamento (2 tentativas)', tentativas: tentativa });
        preview = await deps.preview();
        if (semCondicoes(preview)) return res('ignorada', { tentativas: tentativa });
        if (preview.blockers.length > 0) return res('pendencia', { motivo: motivoPendencia(preview), tentativas: tentativa });
      }
    }
  } catch (e) {
    return res('erro', { motivo: (e as Error).message ?? String(e) });
  }
}

// ---- competência (BRT = UTC-3 fixo, como gerencial/janelas.ts) ----

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const mesValido = (m: unknown): m is string => typeof m === 'string' && MONTH.test(m);

function mesBrt(agora: Date, delta: number): string {
  const brt = new Date(agora.getTime() - 3 * 3_600_000);
  const d = new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth() + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
/** Mês corrente em BRT (`YYYY-MM`). */
export const mesAtualBrt = (agora: Date) => mesBrt(agora, 0);
/** Competência que o disparo do dia 01 fecha: o mês anterior em BRT. */
export const competenciaAnterior = (agora: Date) => mesBrt(agora, -1);

/** Meses `YYYY-MM` de `desde` (inclusive) até `ate` (exclusive). */
export function mesesEntre(desde: string, ate: string): string[] {
  const out: string[] = [];
  let [a, m] = desde.split('-').map(Number);
  for (;;) {
    const k = `${a}-${String(m).padStart(2, '0')}`;
    if (k >= ate) return out;
    out.push(k);
    if (++m > 12) { m = 1; a++; }
  }
}

// ---- agregação e mensagem ----

export interface EventoResultado { org_id: string; result: string; reason: string | null; details: Record<string, unknown> | null; occurred_at: string }

/** Último resultado por org (eventos de uma rodada; retry do QStash pode gravar mais de um). */
export function ultimoPorOrg(eventos: EventoResultado[]): Map<string, EventoResultado> {
  const out = new Map<string, EventoResultado>();
  for (const e of [...eventos].sort((x, y) => x.occurred_at.localeCompare(y.occurred_at))) out.set(e.org_id, e);
  return out;
}

/** Org sem resultado final ainda: sem evento, ou último evento 'erro' (o QStash ainda pode retentar). */
export const aguardando = (orgIds: string[], ultimos: Map<string, EventoResultado>) =>
  orgIds.filter((id) => !ultimos.has(id) || ultimos.get(id)!.result === 'erro');

export interface LinhaAviso { nome: string; resultado: Resultado | 'sem_resultado'; total_cents: number | null; motivo: string | null }

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const rotuloCompetencia = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;

const COM_VALOR = new Set(['fechada', 'ja_fechada', 'fecharia']);

function linha(l: LinhaAviso): string {
  const valor = brl((l.total_cents ?? 0) / 100);
  switch (l.resultado) {
    case 'fechada': return `✅ ${l.nome} · ${valor}`;
    case 'ja_fechada': return `✅ ${l.nome} · ${valor} (já fechada)`;
    case 'fecharia': return `🟢 ${l.nome} · ${valor}`;
    case 'pendencia': return `⏸ ${l.nome} · ${l.motivo ?? 'pendência'}`;
    case 'mes_anterior_aberto': return `⏸ ${l.nome} · mês anterior aberto`;
    case 'conflito': return `⚠️ ${l.nome} · conflito de revisão, fechar na Central`;
    case 'sem_resultado': return `⚠️ ${l.nome} · sem resultado (ver auditoria)`;
    default: return `⚠️ ${l.nome} · erro: ${l.motivo ?? 'desconhecido'}`;
  }
}

/** Texto do aviso (pt-BR, texto puro). Orgs ignoradas (sem condições) ficam fora. */
export function montarAviso(mes: string, linhas: LinhaAviso[], linkCentral: string, simulacao = false): string {
  const visiveis = linhas.filter((l) => l.resultado !== 'ignorada').sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const comValor = visiveis.filter((l) => COM_VALOR.has(l.resultado));
  const total = comValor.reduce((s, l) => s + (l.total_cents ?? 0), 0);
  const n = comValor.length;
  const verbo = simulacao ? (n === 1 ? 'fecharia' : 'fechariam') : (n === 1 ? 'fechada' : 'fechadas');
  const cabecalho = `${simulacao ? '🧪 Simulação · ' : '📒 '}Fechamento de ${rotuloCompetencia(mes)} · ${n} ${n === 1 ? 'org' : 'orgs'} ${verbo} · total a receber ${brl(total / 100)}`;
  return [cabecalho, '', ...(visiveis.length ? visiveis.map(linha) : ['Nenhuma organização com condições comerciais.']), '', `Central: ${linkCentral}`].join('\n');
}
