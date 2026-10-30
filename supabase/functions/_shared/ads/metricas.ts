// Contratos de métricas por período do Mercado Ads (plano ads-redesign §5.3) e parser estrito por campo.
// Puro, nunca lança. Zero explícito é 0; ausente é null/'nao_retornada'; não numérico é null/'resposta_invalida'.
// O parser preserva a unidade do fornecedor; o front normaliza por campo via ESCALA_METRICA_ADS (sem heurística).
export type MetricaBrutaAds =
  | 'cost' | 'prints' | 'clicks'
  | 'direct_amount' | 'indirect_amount' | 'total_amount'
  | 'direct_items_quantity' | 'indirect_items_quantity'
  | 'advertising_items_quantity'
  | 'direct_units_quantity' | 'indirect_units_quantity' | 'units_quantity'
  | 'organic_items_quantity' | 'organic_units_quantity'
  | 'organic_units_amount' | 'cvr' | 'sov'
  | 'impression_share' | 'top_impression_share'
  | 'lost_impression_share_by_budget'
  | 'lost_impression_share_by_ad_rank';

export type MotivoMetricaAds =
  | 'nao_retornada'
  | 'fora_da_retencao'
  | 'sem_denominador'
  | 'resposta_invalida'
  | 'sem_permissao'
  | 'limite_de_leitura';

export interface ValorAds {
  valor: number | null;
  motivo: MotivoMetricaAds | null;
}

export interface JanelaAdsMetricas {
  desde: string;
  ate: string;
}

export interface DiaAdsMetricas {
  dia: string;
  metricas: Partial<Record<MetricaBrutaAds, ValorAds>>;
}

export interface BlocoAdsMetricas {
  janela: JanelaAdsMetricas;
  resumo: Partial<Record<MetricaBrutaAds, ValorAds>>;
  serie: DiaAdsMetricas[];
  completo: boolean;
  lidoEm: string;
}

export interface CampanhaPeriodoAds {
  id: number;
  nome: string;
  statusAtual: string;
  atual: BlocoAdsMetricas;
  anterior: BlocoAdsMetricas | null;
}

// EscopoAdsMetricas chega com a task do handler; aqui só o formato mínimo que o contrato exige.
export type EscopoAdsMetricas = { tipo: 'conta' | 'campanhas' | 'campanha' | 'competitividade'; campanhaId?: number };

export interface RespostaAdsMetricas {
  ok: true;
  estado: 'ok' | 'parcial' | 'sem_conexao' | 'sem_advertiser' | 'sem_acesso' | 'sem_permissao';
  escopo: EscopoAdsMetricas;
  atual: BlocoAdsMetricas | null;
  anterior: BlocoAdsMetricas | null;
  campanhas: CampanhaPeriodoAds[];
  comparacao: { estado: 'disponivel' | 'provisoria' | 'indisponivel' | 'desligada'; motivo: string | null };
  disponibilidade: { desde: string; ate: string; fuso: 'America/Sao_Paulo' };
  avisos: string[];
}

export type EscalaMetricaAds = 'valor' | 'percentual_0_100' | 'fracao_0_1' | 'razao' | 'nao_confirmada';

// Escalas medidas no spike 058 (anexo de classificação).
export const ESCALA_METRICA_ADS: Record<MetricaBrutaAds, EscalaMetricaAds> = {
  cost: 'valor', prints: 'valor', clicks: 'valor',
  direct_amount: 'valor', indirect_amount: 'valor', total_amount: 'valor',
  direct_items_quantity: 'valor', indirect_items_quantity: 'valor', advertising_items_quantity: 'valor',
  direct_units_quantity: 'valor', indirect_units_quantity: 'valor', units_quantity: 'valor',
  organic_items_quantity: 'valor', organic_units_quantity: 'valor', organic_units_amount: 'valor',
  cvr: 'percentual_0_100', sov: 'percentual_0_100',
  impression_share: 'fracao_0_1',
  lost_impression_share_by_budget: 'fracao_0_1',
  lost_impression_share_by_ad_rank: 'fracao_0_1',
  top_impression_share: 'nao_confirmada',
};

export const CAMPOS_METRICA_ADS = Object.keys(ESCALA_METRICA_ADS) as MetricaBrutaAds[];

const INVALIDA: ValorAds = { valor: null, motivo: 'resposta_invalida' };

function parseCampo(campo: MetricaBrutaAds, bruto: Record<string, unknown>): ValorAds {
  // Escala não confirmada no spike 058: nunca entra como número.
  if (campo === 'top_impression_share') return { ...INVALIDA };
  if (!(campo in bruto) || bruto[campo] === undefined) return { valor: null, motivo: 'nao_retornada' };
  const v = bruto[campo];
  if (typeof v !== 'number' || !Number.isFinite(v)) return { ...INVALIDA };
  return { valor: v, motivo: null };
}

export function parseMetricasResumo(corpo: unknown): Partial<Record<MetricaBrutaAds, ValorAds>> {
  const ehObj = typeof corpo === 'object' && corpo !== null && !Array.isArray(corpo);
  const saida: Partial<Record<MetricaBrutaAds, ValorAds>> = {};
  for (const c of CAMPOS_METRICA_ADS) {
    saida[c] = ehObj ? parseCampo(c, corpo as Record<string, unknown>) : { ...INVALIDA };
  }
  return saida;
}
