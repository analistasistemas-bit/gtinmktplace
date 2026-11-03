// ADR-0193: formatação da aba Resultados. Só apresenta o que o contrato `MonthlyReport` entrega —
// nada aqui recalcula dinheiro. Desconhecido (null) vira "—", nunca zero. Os textos espelham os do
// PDF mensal (`pdf-relatorio-mensal.ts`), que fica fora deste módulo para não puxar o jsPDF ao bundle.
import { fmtBRL } from '@/lib/formato';

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const MES_VALIDO = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "2026-10" → "Outubro de 2026". Valor fora do formato volta como veio (nunca lança). */
export function mesPorExtenso(month: string): string {
  const m = MES_VALIDO.exec(month);
  return m ? `${MESES[Number(m[2]) - 1]} de ${m[1]}` : month;
}

/** "2026-10" → "outubro" (minúsculo, para "vs setembro"). */
export function nomeDoMes(month: string): string {
  const m = MES_VALIDO.exec(month);
  return m ? MESES[Number(m[2]) - 1].toLowerCase() : month;
}

/** "2026-10" → "out/26". */
export function mesCurto(month: string): string {
  const m = MES_VALIDO.exec(month);
  return m ? `${MES_CURTO[Number(m[2]) - 1]}/${m[1].slice(2)}` : month;
}

/** Soma `n` meses a "YYYY-MM". */
export function somarMeses(month: string, n: number): string {
  const m = MES_VALIDO.exec(month);
  if (!m) return month;
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** Meses selecionáveis: `quantidade` terminando em `atual` (mais recente primeiro), sempre com o mês selecionado. */
export function opcoesDeMes(atual: string, selecionado: string, quantidade = 24): string[] {
  const lista = Array.from({ length: quantidade }, (_, i) => somarMeses(atual, -i));
  return lista.includes(selecionado) ? lista : [selecionado, ...lista];
}

/** Dias do mês "YYYY-MM". */
export function diasDoMes(month: string): number {
  const m = MES_VALIDO.exec(month);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate() : 0;
}

export const MOTIVO_APOS_ADS: Record<string, string> = {
  lucro_indisponivel: 'lucro não calculável no mês',
  lucro_parcial: 'há itens sem lucro calculável',
  ads_indisponivel: 'dados de Ads indisponíveis',
  ads_cobertura_parcial: 'Ads sem cobertura completa do mês',
};

export const brl = (cents: number | null | undefined) => (cents == null ? '—' : fmtBRL(cents / 100));
export const pct = (fracao: number | null | undefined, casas = 1) =>
  fracao == null ? '—' : `${(fracao * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

export type Variacao = { texto: string; tendencia: 'up' | 'down' | 'neutral'; bom: boolean } | null;

const um = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Variação relativa em %. Base anterior zero/ausente → null (nunca "∞"). `inverso`: subir é ruim. */
export function variacaoRel(atual: number | null | undefined, anterior: number | null | undefined, inverso = false): Variacao {
  if (atual == null || anterior == null || anterior === 0) return null;
  const v = (atual - anterior) / Math.abs(anterior);
  const arred = Math.round(Math.abs(v) * 1000) / 10;
  if (arred === 0) return { texto: '0,0%', tendencia: 'neutral', bom: true };
  return { texto: `${v > 0 ? '+' : '−'}${um(arred)}%`, tendencia: v > 0 ? 'up' : 'down', bom: inverso ? v < 0 : v > 0 };
}

/** Variação de razões (margem, markup) em pontos percentuais. */
export function variacaoPp(atual: number | null | undefined, anterior: number | null | undefined): Variacao {
  if (atual == null || anterior == null) return null;
  const pp = Math.round((atual - anterior) * 1000) / 10;
  if (pp === 0) return { texto: '0,0 p.p.', tendencia: 'neutral', bom: true };
  return { texto: `${pp > 0 ? '+' : '−'}${um(Math.abs(pp))} p.p.`, tendencia: pp > 0 ? 'up' : 'down', bom: pp > 0 };
}

/** "01/11" de um instante ISO, no fuso de Fortaleza. */
export function diaMesBr(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit' }).format(new Date(iso));
}

/** "02/11 12:30" de um instante ISO, no fuso de Fortaleza. */
export function dataHoraBr(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso)).replace(',', '');
}
