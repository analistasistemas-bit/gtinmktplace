// Painel de Ads (I2, ADR-0179): período BRT, janela de vendas BRT e leitura da RPC `ads_painel`.
import { supabase } from '@/lib/supabase';
import type { FontePainelAds, LucroFamilia } from '@/lib/ads-painel';
import type { Janela, Periodo } from '@/lib/metricas';
import { diaBRT } from '@/lib/calendario-brt';
import { agruparPorFamilia, type LinhaSku } from '@/lib/vendas-sku';
import { fimDiasAds } from '@/lib/sku-ads';

export type DiasAds = 7 | 30 | 90;
const somarDias = (dia: string, n: number) =>
  new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** N dias BRT inteiros terminando no último dia coletado (`fimDiasAds`): o Ads não tem hoje (spike 053 §3.2)
 *  e, antes da coleta do dia, nem ontem — as vendas seguem o mesmo recorte. */
export function periodoAds(dias: DiasAds, agora: Date, ultimoOkEm: string | null): { desde: string; ate: string } {
  const ate = fimDiasAds(agora, ultimoOkEm);
  return { desde: somarDias(ate, -(dias - 1)), ate };
}

export type PeriodoAds = Extract<
  Periodo,
  { tipo: 'preset' } | { tipo: 'mes_atual' }
>;

export type JanelaDiasAds = {
  desde: string;
  ate: string;
};

export type ResolucaoPeriodoAds =
  | { tipo: 'pronto'; janela: JanelaDiasAds }
  | {
      tipo: 'aguardando_mes';
      janela: null;
      inicioMes: string;
      fimDisponivel: string;
    };

/** Período padrão da tela /ads: decisão do Diego (2026-10-05). Preferência salva vence. */
export const PERIODO_PADRAO_ADS: PeriodoAds = {
  tipo: 'mes_atual',
};

/** Mês atual = mês civil BRT até o último dia coletado (`fimDiasAds`). Antes do 1º dia coletado do mês,
 *  `aguardando_mes` — nunca intervalo invertido nem mês anterior. Presets delegam a `periodoAds`. */
export function resolverPeriodoAds(
  periodo: PeriodoAds,
  agora: Date,
  ultimoOkEm: string | null,
): ResolucaoPeriodoAds {
  if (periodo.tipo === 'preset') {
    return {
      tipo: 'pronto',
      janela: periodoAds(periodo.dias, agora, ultimoOkEm),
    };
  }

  const inicioMes = `${diaBRT(agora.getTime()).slice(0, 7)}-01`;
  const fimDisponivel = fimDiasAds(agora, ultimoOkEm);

  if (fimDisponivel < inicioMes) {
    return {
      tipo: 'aguardando_mes',
      janela: null,
      inicioMes,
      fimDisponivel,
    };
  }

  return {
    tipo: 'pronto',
    janela: { desde: inicioMes, ate: fimDisponivel },
  };
}

/** Dias BRT → janela ISO com offset fixo (Brasil sem horário de verão desde 2019): não depende do fuso do navegador. */
export function janelaBRT(desde: string, ate: string): Janela {
  return { desde: new Date(`${desde}T00:00:00-03:00`).toISOString(), ate: new Date(`${ate}T23:59:59.999-03:00`).toISOString() };
}

/** codigoPai → lucro do período. Usado pelo hook e pelo teste de integração (mesma fiação). */
export function lucroPorFamilia(linhas: LinhaSku[]): Map<string, LucroFamilia> {
  return new Map(agruparPorFamilia(linhas).map((f) =>
    [f.codigoPai, { nome: f.nomeFamilia, lucro: f.m.lucro, brutoComCusto: f.acc.brutoComCusto, fonteCusto: f.m.fonteCusto,
      markup: f.m.markup }]));
}

const num = (v: unknown) => Number(v ?? 0);
export async function buscarPainelAds(desde: string, ate: string): Promise<FontePainelAds> {
  const { data, error } = await supabase.rpc('ads_painel', { p_desde: desde, p_ate: ate });
  if (error) throw new Error(error.message);
  const r = data as { sync: FontePainelAds['sync']; conta: Record<string, unknown>[]; grupos: Record<string, unknown>[] };
  return {
    sync: r.sync,
    conta: r.conta.map((d) => ({ dia: String(d.dia), cost: num(d.cost), clicks: num(d.clicks), prints: num(d.prints),
      direct_amount: num(d.direct_amount), indirect_amount: num(d.indirect_amount), total_amount: num(d.total_amount),
      coletado_em: String(d.coletado_em) })),
    grupos: r.grupos.map((g) => ({ ad_group_id: num(g.ad_group_id), tipo: g.tipo as 'ITEM' | 'FAMILY' | 'CATALOG',
      status: String(g.status), cost: num(g.cost), clicks: num(g.clicks), prints: num(g.prints),
      direct_amount: num(g.direct_amount), indirect_amount: num(g.indirect_amount), total_amount: num(g.total_amount),
      membros: (g.membros as string[]) ?? [] })),
  };
}
