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
  if (den.valor <= 0) return { ...SEM_DENOMINADOR };
  return { valor: num.valor / den.valor, motivo: null };
}

export function indicadoresAds(
  resumo: BlocoAdsMetricas['resumo'],
  /** Número cru (faturamento conhecido) ou ValorAds já com motivo (ex.: 'sem_historico'); null = sem faturamento. */
  faturamentoConta: number | ValorAds | null,
): Record<string, ValorAds> {
  const cost = campo(resumo, 'cost');
  const receita = campo(resumo, 'total_amount');
  const prints = campo(resumo, 'prints');
  const clicks = campo(resumo, 'clicks');
  // Faturamento ausente, não positivo ou sem histórico: o TACOS não é presumido (o motivo do insumo propaga).
  const f = typeof faturamentoConta === 'number' ? { valor: faturamentoConta, motivo: null } : faturamentoConta;
  const fatura: ValorAds = f === null || (f.valor !== null && !Number.isFinite(f.valor)) ? { ...SEM_DENOMINADOR } : f;
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

// Comparação entre períodos (plano §4.7): a direção da seta é separada do tom. Só o `sentido` do indicador
// (ROAS/conversão ↑ bom, ACOS ↓ bom) e uma comparação NÃO provisória podem colorir; o resto é neutro.
export type UnidadeAds = 'moeda' | 'quantidade' | 'razao' | 'percentual';
export type SentidoAds = 'maior_melhor' | 'menor_melhor' | 'neutro';
export interface ComparacaoAds {
  texto: string;
  direcao: 'up' | 'down' | 'neutral';
  tom: 'success' | 'danger' | 'neutral';
}

const SEM_COMPARACAO: ComparacaoAds = { texto: 'Sem comparação', direcao: 'neutral', tom: 'neutral' };
const SEM_BASE: ComparacaoAds = { texto: 'Sem base de comparação', direcao: 'neutral', tom: 'neutral' };

const fmt = (n: number, casas: number) =>
  Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

export function compararIndicadorAds(
  atual: ValorAds,
  anterior: ValorAds,
  unidade: UnidadeAds,
  provisoria: boolean,
  sentido: SentidoAds = 'neutro',
): ComparacaoAds {
  const a = atual.valor;
  const b = anterior.valor;
  if (a === null || b === null) return SEM_COMPARACAO;

  let delta: number; // já na escala exibida (p.p., % ou R$)
  let texto: (sinal: string) => string;
  if (b === 0) return SEM_BASE;
  if (unidade === 'percentual') {
    delta = Math.round((a - b) * 1000) / 10;
    texto = (s) => `${s}${fmt(delta, 1)} p.p.`;
  } else if (b < 0 && unidade === 'moeda') {
    delta = Math.round((a - b) * 100) / 100;
    texto = (s) => `${s}R$ ${fmt(delta, 2)}`;
  } else if (b <= 0) {
    return SEM_BASE;
  } else {
    delta = Math.round(((a - b) / b) * 100);
    texto = (s) => `${s}${fmt(delta, 0)}%`;
  }

  const direcao = delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral';
  const sinal = delta > 0 ? '+' : delta < 0 ? '-' : '';
  let tom: ComparacaoAds['tom'] = 'neutral';
  if (!provisoria && direcao !== 'neutral' && sentido !== 'neutro') {
    tom = (direcao === 'up') === (sentido === 'maior_melhor') ? 'success' : 'danger';
  }
  return { texto: texto(sinal), direcao, tom };
}
