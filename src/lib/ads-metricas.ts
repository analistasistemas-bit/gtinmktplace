// Indicadores do topo da tela /ads (plano ads-redesign §2.3–2.5).
// Quocientes sempre sobre agregados do período (nunca média diária). Vendas por Ads é a quantidade atribuída
// (`advertising_items_quantity`), separada de unidades e da receita. CVR é o nativo do ML, nunca recalculado.
// Tipos e mapa de escala vêm do contrato das edges (mesmo precedente de outros módulos de src/lib).
import {
  ESCALA_METRICA_ADS,
  type BlocoAdsMetricas,
  type MetricaBrutaAds,
  type ValorAds,
} from '../../supabase/functions/_shared/ads/metricas';

const SEM_DENOMINADOR: ValorAds = { valor: null, motivo: 'sem_denominador' };

// Lê o campo bruto e normaliza pela escala declarada (percentual 0–100 → fração); ausente = não retornada.
function campo(resumo: BlocoAdsMetricas['resumo'], nome: MetricaBrutaAds): ValorAds {
  const v = resumo[nome];
  if (!v) return { valor: null, motivo: 'nao_retornada' };
  if (v.valor === null) return { valor: null, motivo: v.motivo ?? 'nao_retornada' };
  return { valor: ESCALA_METRICA_ADS[nome] === 'percentual_0_100' ? v.valor / 100 : v.valor, motivo: null };
}

// Insumo indisponível propaga o motivo; denominador não positivo → sem_denominador.
function razao(num: ValorAds, den: ValorAds): ValorAds {
  if (num.valor === null) return num;
  if (den.valor === null) return den;
  if (den.valor === 0) return { ...SEM_DENOMINADOR };
  return { valor: num.valor / den.valor, motivo: null };
}

export function indicadoresAds(
  resumo: BlocoAdsMetricas['resumo'],
  faturamentoConta: number | null,
): Record<string, ValorAds> {
  const cost = campo(resumo, 'cost');
  const receita = campo(resumo, 'total_amount');
  const prints = campo(resumo, 'prints');
  const clicks = campo(resumo, 'clicks');
  // Faturamento ausente ou zero: o TACOS não é presumido.
  const fatura: ValorAds = faturamentoConta === null || !Number.isFinite(faturamentoConta)
    ? { ...SEM_DENOMINADOR }
    : { valor: faturamentoConta, motivo: null };
  return {
    investimento: cost,
    vendas: campo(resumo, 'advertising_items_quantity'),
    receita,
    roas: razao(receita, cost),
    acos: razao(cost, receita),
    tacos: razao(cost, fatura),
    impressoes: prints,
    cliques: clicks,
    ctr: razao(clicks, prints),
    cpc: razao(cost, clicks),
    conversao: campo(resumo, 'cvr'),
  };
}
