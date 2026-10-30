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

export type EscopoAdsMetricas = 'conta' | 'campanhas' | 'campanha' | 'competitividade';

export interface PedidoAdsMetricas {
  desde: string;
  ate: string;
  comparar: 'anterior' | 'nenhum';
  escopo: EscopoAdsMetricas;
  campanhaId?: number;
  fresco?: boolean;
}

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

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 86_400_000;

/**
 * Série diária E2/E4 (`results[].date` + métricas no próprio dia). Cada dia da janela aparece uma vez:
 * dia repetido, fora da janela, malformado ou com `cost` inválido invalida a série; lacuna mantém os dias
 * lidos com completo=false. Nunca preenche dia faltante com zero.
 */
export function parseSerieMetricas(
  corpo: unknown,
  janela: JanelaAdsMetricas,
): { serie: DiaAdsMetricas[]; completo: boolean } {
  const invalida = () => ({ serie: [] as DiaAdsMetricas[], completo: false });
  const ehObj = typeof corpo === 'object' && corpo !== null && !Array.isArray(corpo);
  const results = ehObj ? (corpo as Record<string, unknown>).results : null;
  if (!Array.isArray(results)) return invalida();
  const porDia = new Map<string, DiaAdsMetricas>();
  for (const r of results) {
    if (typeof r !== 'object' || r === null || Array.isArray(r)) return invalida();
    const date = (r as Record<string, unknown>).date;
    if (typeof date !== 'string') return invalida();
    const dia = date;
    if (!diaReal(dia) || dia < janela.desde || dia > janela.ate || porDia.has(dia)) return invalida();
    const metricas = parseMetricasResumo(r);
    if (metricas.cost?.motivo !== null) return invalida();
    porDia.set(dia, { dia, metricas });
  }
  // Compara o conjunto de dias esperado com o recebido (não só a contagem).
  if (!diaReal(janela.desde) || !diaReal(janela.ate) || janela.desde > janela.ate) return invalida();
  let completo = true;
  for (let t = Date.parse(`${janela.desde}T00:00:00Z`); t <= Date.parse(`${janela.ate}T00:00:00Z`); t += DIA_MS) {
    if (!porDia.has(new Date(t).toISOString().slice(0, 10))) { completo = false; break; }
  }
  const serie = [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia));
  return { serie, completo };
}

// `YYYY-MM-DD` inteiro e existente no calendário (ida e volta em UTC).
function diaReal(s: string): boolean {
  if (!DIA_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

// --- URLs (só path + query; o fetch e a paginação são da camada acima). Rotas e parâmetros do spike 058. ---
// Cabeçalho `api-version: 2` vem de HEADERS_ADS (fiacao.ts). O BASE do coletor não é exportado: repetido aqui de propósito.
const BASE = '/marketplace/advertising/MLB';
const LIMITE_URL = 50;
// Spike 058 (b): `error` entra no filtro, senão some campanha com gasto.
const STATUS_HISTORICOS = 'active,paused,deleted,error';
const BASE_MET = 'clicks,prints,ctr,cost,cpc,acos,roas,cvr,sov,direct_amount,indirect_amount,total_amount';
const QTD_MET = 'direct_items_quantity,indirect_items_quantity,advertising_items_quantity,'
  + 'direct_units_quantity,indirect_units_quantity,units_quantity,'
  + 'organic_items_quantity,organic_units_quantity,organic_units_amount';
// Competitividade: 200 só em E3/E4; em E1/E2/E5 o ML responde 400.
const COMP_MET = 'impression_share,top_impression_share,lost_impression_share_by_budget,lost_impression_share_by_ad_rank';
// Anúncio (E5): mesmas famílias de métrica da conta, sem competitividade.
const METRICAS_CONTA = `${BASE_MET},${QTD_MET}`;
const METRICAS_CAMPANHA = `${METRICAS_CONTA},${COMP_MET}`;

const periodoUrl = (j: JanelaAdsMetricas) => `date_from=${j.desde}&date_to=${j.ate}`;
const listaConta = (adv: number) => `${BASE}/advertisers/${adv}/product_ads/campaigns/search`;

/** E1: campanhas + `metrics_summary`. O resumo só soma a página: `limit` 50 deve cobrir `paging.total`. */
export const urlContaResumo = (adv: number, j: JanelaAdsMetricas, offset: number) =>
  `${listaConta(adv)}?limit=${LIMITE_URL}&offset=${offset}&${periodoUrl(j)}&metrics=${METRICAS_CONTA}`
  + `&metrics_summary=true&filters[status]=${STATUS_HISTORICOS}`;

/** E2: uma linha por dia (sem `paging`). */
export const urlContaSerie = (adv: number, j: JanelaAdsMetricas) =>
  `${listaConta(adv)}?limit=${LIMITE_URL}&offset=0&${periodoUrl(j)}&metrics=${METRICAS_CONTA}`
  + `&aggregation_type=DAILY&filters[status]=${STATUS_HISTORICOS}`;

/** E3: detalhe da campanha, com competitividade. */
export const urlCampanhaDetalhe = (id: number, j: JanelaAdsMetricas) =>
  `${BASE}/product_ads/campaigns/${id}?${periodoUrl(j)}&metrics=${METRICAS_CAMPANHA}`;

/** E4: série diária da campanha, com competitividade. */
export const urlCampanhaSerie = (id: number, j: JanelaAdsMetricas) =>
  `${urlCampanhaDetalhe(id, j)}&aggregation_type=DAILY`;

/**
 * E5: métricas por anúncio (`ads/search`), confirmadas e conciliadas em centavos no spike 058.
 * Só para o detalhe da campanha; nunca fonte de total da conta (E1/E2). O chamador descarta linhas de outra campanha.
 */
export const urlAnunciosMetricas = (adv: number, j: JanelaAdsMetricas, offset: number, campanhaId?: number) =>
  `${BASE}/advertisers/${adv}/product_ads/ads/search?limit=${LIMITE_URL}&offset=${offset}&${periodoUrl(j)}`
  + `&metrics=${METRICAS_CONTA}${campanhaId === undefined ? '' : `&filters[campaign_id]=${campanhaId}`}`;
