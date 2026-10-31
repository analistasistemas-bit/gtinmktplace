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
  { tipo: 'preset' } | { tipo: 'mes_atual' } | { tipo: 'range' }
>;

export type JanelaDiasAds = {
  desde: string;
  ate: string;
};

export type MotivoPeriodoInvalidoAds = 'data_invalida' | 'ordem' | 'futuro' | 'fora_da_retencao';

export type ResolucaoPeriodoAds =
  | { tipo: 'pronto'; janela: JanelaDiasAds }
  | { tipo: 'invalido'; janela: null; motivo: MotivoPeriodoInvalidoAds }
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

/** Retenção medida do Mercado Ads (spike 058): date_from = hoje BRT − 91 retorna 200; hoje − 92 retorna 400. */
export const RETENCAO_ADS_DIAS = 91;

/** Texto de cada motivo de período inválido (seletor e página do /ads). */
export const MOTIVOS_PERIODO_ADS: Record<MotivoPeriodoInvalidoAds, string> = {
  data_invalida: 'Informe datas válidas nos dois campos.',
  ordem: 'A data de início não pode ser depois do fim.',
  futuro: 'O fim precisa ser até ontem (o Ads só tem dias completos).',
  fora_da_retencao: `O Mercado Ads guarda só os últimos ${RETENCAO_ADS_DIAS} dias; escolha um início mais recente.`,
};

const diaReal = (d: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && somarDias(d, 0) === d;

/** Dias completos até ONTEM em BRT; a coleta atrasada não desloca a janela (`ultimoOkEm` só mantém a assinatura).
 *  Mês atual aguarda o 1º dia fechado. `range` é validado (datas reais, ordem, ≤ ontem, dentro da retenção)
 *  e nunca vira outra janela. */
export function resolverPeriodoAds(
  periodo: PeriodoAds,
  agora: Date,
  _ultimoOkEm: string | null,
): ResolucaoPeriodoAds {
  const hoje = diaBRT(agora.getTime());
  const ontem = somarDias(hoje, -1);

  if (periodo.tipo === 'preset') {
    return { tipo: 'pronto', janela: { desde: somarDias(ontem, -(periodo.dias - 1)), ate: ontem } };
  }
  if (periodo.tipo === 'mes_atual') {
    const inicioMes = `${hoje.slice(0, 7)}-01`;
    if (ontem < inicioMes) return { tipo: 'aguardando_mes', janela: null, inicioMes, fimDisponivel: ontem };
    return { tipo: 'pronto', janela: { desde: inicioMes, ate: ontem } };
  }

  const { desde, ate } = periodo;
  if (!diaReal(desde) || !diaReal(ate)) return { tipo: 'invalido', janela: null, motivo: 'data_invalida' };
  if (desde > ate) return { tipo: 'invalido', janela: null, motivo: 'ordem' };
  if (ate > ontem) return { tipo: 'invalido', janela: null, motivo: 'futuro' };
  if (desde < somarDias(hoje, -RETENCAO_ADS_DIAS)) return { tipo: 'invalido', janela: null, motivo: 'fora_da_retencao' };
  return { tipo: 'pronto', janela: { desde, ate } };
}

/** Mesmo nº de dias completos imediatamente antes do início, sem dia compartilhado. */
export function janelaAnteriorAds(janela: JanelaDiasAds): JanelaDiasAds {
  const dias = Math.round((Date.parse(`${janela.ate}T12:00:00Z`) - Date.parse(`${janela.desde}T12:00:00Z`)) / 86_400_000) + 1;
  return { desde: somarDias(janela.desde, -dias), ate: somarDias(janela.desde, -1) };
}

export type ComparacaoAds =
  | { tipo: 'pronta'; janela: JanelaDiasAds }
  | { tipo: 'indisponivel'; motivo: 'fora_da_retencao' };

/** Janela anterior só existe inteira dentro da retenção; senão é indisponível (nunca truncada). */
export function comparacaoAds(janela: JanelaDiasAds, agora: Date): ComparacaoAds {
  const anterior = janelaAnteriorAds(janela);
  if (anterior.desde < somarDias(diaBRT(agora.getTime()), -RETENCAO_ADS_DIAS)) {
    return { tipo: 'indisponivel', motivo: 'fora_da_retencao' };
  }
  return { tipo: 'pronta', janela: anterior };
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
