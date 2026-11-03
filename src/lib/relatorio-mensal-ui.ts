// ADR-0193: formatação da aba Resultados. Só apresenta o que o contrato `MonthlyReport` entrega —
// nada aqui recalcula dinheiro. Desconhecido (null) vira "—", nunca zero. Os textos espelham os do
// PDF mensal (`pdf-relatorio-mensal.ts`), que fica fora deste módulo para não puxar o jsPDF ao bundle.
import { fmtBRL } from '@/lib/formato';
import type { PeriodKpis, SeriesPoint } from '@/lib/platform-admin';

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

// ---------------------------------------------------------------------------------------------
// Cascata e série (tela e PDF usam as mesmas funções): só leem campos do contrato.
// ---------------------------------------------------------------------------------------------
export type LinhaCascata = {
  chave: 'bruto' | 'canal' | 'imposto' | 'liquido' | 'custo' | 'lucro' | 'ads' | 'apos_ads';
  rotulo: string; valor: number | null; sub?: string; tipo: 'total' | 'menos' | 'final';
  /** Saldo de onde a saída parte e onde termina (centavos do contrato); null = indisponível. */
  de: number | null; ate: number | null;
};

/** Linhas da cascata pelos saldos do contrato. Custo só encadeia com lucro de cobertura total: com lucro
 *  parcial o custo é só dos itens calculáveis e não fecha com o líquido de todos os itens. */
export function linhasCascata(k: PeriodKpis): LinhaCascata[] {
  const total = (valor: number | null) => ({ de: valor == null ? null : 0, ate: valor });
  return [
    { chave: 'bruto', rotulo: 'Faturamento da loja', valor: k.gross_cents, tipo: 'total', ...total(k.gross_cents) },
    { chave: 'canal', rotulo: 'Comissão e frete do ML', valor: k.channel_costs_cents, tipo: 'menos', de: k.gross_cents, ate: k.net_cents },
    { chave: 'imposto', rotulo: 'Imposto', valor: k.tax_cents, sub: k.tax_cents == null ? 'alíquota não confirmada' : undefined, tipo: 'menos', de: k.net_cents, ate: k.net_after_tax_cents },
    { chave: 'liquido', rotulo: 'Líquido', valor: k.net_after_tax_cents, tipo: 'total', ...total(k.net_after_tax_cents) },
    { chave: 'custo', rotulo: 'Custo dos produtos', valor: k.cost_cents, tipo: 'menos', de: k.net_after_tax_cents, ate: k.profit_partial ? null : k.profit_cents },
    { chave: 'lucro', rotulo: k.profit_partial ? 'Lucro (parcial)' : 'Lucro', valor: k.profit_cents, tipo: 'total', ...total(k.profit_cents) },
    { chave: 'ads', rotulo: 'Ads da conta', valor: k.ads_cost_cents, sub: k.ads_cost_cents == null ? 'indisponível' : undefined, tipo: 'menos', de: k.profit_cents, ate: k.profit_after_ads_cents },
    {
      chave: 'apos_ads', rotulo: 'Lucro após Ads', valor: k.profit_after_ads_cents, tipo: 'final', ...total(k.profit_after_ads_cents),
      sub: k.profit_after_ads_cents == null ? (MOTIVO_APOS_ADS[k.unavailable_reason ?? ''] ?? 'indisponível') : undefined,
    },
  ];
}

/** Geometria da barra em frações do faturamento: [min(de, ate), max(de, ate)] limitado a [0, 1].
 *  Saldo indisponível → null (sem barra; o valor ainda aparece em texto). */
export function barraCascata(l: LinhaCascata, grossCents: number): { esq: number; larg: number } | null {
  if (l.valor == null || l.de == null || l.ate == null) return null;
  const g = Math.max(grossCents, 1);
  const lim = (v: number) => Math.max(0, Math.min(v, g));
  const lo = lim(Math.min(l.de, l.ate));
  const hi = lim(Math.max(l.de, l.ate));
  return { esq: lo / g, larg: (hi - lo) / g };
}

/** Lucro e margem de um mês da série: após Ads quando o contrato tem; senão antes de Ads (marcado). */
export function lucroDoMes(p: SeriesPoint): { lucro: number | null; margem: number | null; aposAds: boolean } {
  const aposAds = p.profit_after_ads_cents != null;
  return aposAds
    ? { lucro: p.profit_after_ads_cents, margem: p.margin_after_ads, aposAds }
    : { lucro: p.profit_cents, margem: p.margin, aposAds };
}

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
