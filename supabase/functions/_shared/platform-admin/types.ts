export type Month = string;
export type Cents = number;

export type CommercialTermsInput = {
  org_id: string;
  starts_on: string;
  modality: 1 | 2;
  monthly_fee_cents: Cents;
  revenue_bps_t1: number;
  revenue_bps_t2: number;
  revenue_bps_t3: number;
  revenue_bps_t4: number;
  sonar_unit_cents: Cents;
  setup_fee_cents: Cents;
  setup_due_month: Month | null;
  reason: string;
  /** Dia do vencimento no mês seguinte à competência (1..28, padrão 5 — ADR-0193 D-9). */
  due_day: number;
};

export type PixKeyType = 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';

/** Dados de recebimento da Daludi (ADR-0193 D-9): linha única, só service_role. */
export type PaymentProfileInput = {
  beneficiary_name: string;
  document: string;
  bank_name: string;
  branch: string;
  account: string;
  pix_key_type: PixKeyType;
  pix_key: string;
  city: string;
};

export type PaymentProfile = PaymentProfileInput & { updated_at: string; updated_by: string };

export type CommercialTerms = CommercialTermsInput & {
  id: string;
  version: number;
  timezone: 'America/Fortaleza';
  created_at: string;
  created_by: string;
};

export type RevenueReconciliationInput = {
  org_id: string;
  sale_id: string;
  source_updated_at: string;
  refunded_product_cents: Cents;
  reason: string;
};

export type BillingLine = {
  key: string;
  label: string;
  quantity: number | null;
  unit_cents: Cents | null;
  amount_cents: Cents;
  source_type: string;
  source_id: string | null;
};

export type BillingPreview = {
  org_id: string;
  org_name: string;
  month: Month;
  timezone: string;
  terms: CommercialTerms | null;
  gross_cents: Cents;
  refund_cents: Cents;
  base_cents: Cents;
  fee_cents: Cents;
  applied_bps: number | null;
  applied_tier: 1 | 2 | 3 | 4 | null;
  sonar_units: number;
  sonar_cents: Cents;
  lines: BillingLine[];
  total_cents: Cents;
  credit_cents: Cents;
  credit_balance_cents: Cents;
  adjustments: Array<{ origin_statement_id: string; amount_cents: Cents }>;
  sources: Array<{
    sale_id: string;
    source_updated_at: string;
    gross_cents: Cents;
    refunded_product_cents: Cents;
    recognized_base_cents: Cents;
  }>;
  revision: string;
  /** ADR-0193 D-4: Σ cupons do vendedor do mês (informativo). Ausente em snapshot anterior à Fatia 2a. */
  seller_coupon_cents?: Cents | null;
  /** ADR-0193 D-9: vencimento dos termos. Ausente em snapshot antigo (ler com `?? 5`). */
  due_day?: number | null;
  blockers: Array<{
    code: string;
    message: string;
    sale_id?: string;
    order_ref?: string | null;
    source_updated_at?: string;
    gross_cents?: Cents;
    status?: string;
    refunded_product_cents?: Cents | null;
  }>;
};

export type BillingStatement = BillingPreview & {
  id: string;
  closed_at: string;
  closed_by: string;
};

/** `error` = falha de leitura (não sabemos o dado real); `warning` = ausência esperada e
 *  acionável (o dado é conhecido: falta cadastro). As duas nunca compartilham cor na UI. */
export type MetricsWarning = { code: string; severity: 'error' | 'warning'; message: string };

export type OrgMetrics = {
  org_id: string;
  month: Month;
  gross_cents: Cents;
  orders: number;
  ticket_cents: Cents;
  markup: number | null;
  cost_covered_orders: number;
  total_orders: number;
  active_ads: number | null;
  publications: number | null;
  pending_operations: number | null;
  updated_at: string | null;
  previous: { gross_cents: Cents; orders: number; markup: number | null } | null;
  series: Array<{ month: Month; gross_cents: Cents; markup: number | null }>;
  warnings: MetricsWarning[];
};

export type OrgSummary = {
  id: string;
  nome: string;
  slug: string;
  is_test: boolean;
  modality: 1 | 2 | null;
  metrics: OrgMetrics | null;
  /** Só com condição comercial vigente e sem bloqueio (ADR-0158 §3). */
  forecast_cents: Cents | null;
  /** Consumo Sonar do mês; contável mesmo sem contrato (ADR-0158 §3). */
  billable_units: number | null;
  daludi_searches: number | null;
  /** Bloqueios da prévia do mês (ADR-0158 §2), não buscas Sonar em voo. `null` = prévia indisponível. */
  pending_count: number | null;
  /** Início da próxima vigência (`YYYY-MM-01`) quando o mês exibido NÃO tem condição vigente e a
   *  organização já tem contrato para um mês futuro (ADR-0155: renegociação vale do mês seguinte).
   *  `null` quando há condição vigente, quando não existe contrato nenhum ou quando a prévia falhou —
   *  "não sei" nunca vira "começa em". Opcional de propósito: a Edge Function precisa ir ao ar antes
   *  do frontend, e no intervalo a resposta antiga não traz o campo. */
  next_terms_starts_on?: string | null;
  /** ADR-0175: data em que a organização foi arquivada; `null`/ausente = ativa. */
  arquivada_em?: string | null;
};

export type Page<T> = { rows: T[]; total: number; page: number; page_size: number };

export type WalletTotals = {
  gross_cents: Cents | null;
  forecast_cents: Cents | null;
  orgs_without_terms: number;
  /** Subconjunto de `orgs_without_terms` que já tem contrato com vigência futura: fora do total da
   *  previsão pelo mesmo motivo, mas sem ação pendente. Opcional pelo mesmo motivo de
   *  `next_terms_starts_on`: a resposta anterior ao deploy não traz o campo. */
  orgs_future_terms?: number;
  org_count: number;
  pending_count: number | null;
  orders: number | null;
  warnings: string[];
};

export type Wallet = Page<OrgSummary> & { totals: WalletTotals };

export type AuditRow = {
  id: string;
  org_id: string;
  actor_id: string | null;
  actor_name: string | null;
  at: string;
  category: 'admin' | 'billing' | 'pulse' | 'support';
  action: string;
  result: string;
  target: string | null;
  reason: string | null;
  details: Record<string, unknown>;
};

export type PulseUsageRow = {
  id: string;
  org_id: string;
  actor_id: string;
  actor_name: string | null;
  at: string;
  query: string;
  query_type: 'termo' | 'ean';
  origin: 'cliente' | 'daludi';
  result: string;
  exempt_reason: string | null;
  units: number;
  total_cents: Cents;
  result_id: string | null;
};

export type PulseUsage = Page<PulseUsageRow> & {
  client_units: number;
  client_cents: Cents;
  daludi_searches: number;
  failures: number;
  reopens: number;
  measured_cost_cents: Cents | null;
  tracked_since: string | null;
};

/** Uso da Extensão PubliAI por organização e mês (ADR-0189 D-19, Task 25): contagem diária e erros de leitura. */
export type ExtensaoUsoPessoa = { actor_id: string; actor_name: string | null; analises: number; ultimo_dia: string };
export type ExtensaoErroLeitura = {
  dia: string; tipo_pagina: string; versao: string; motivo: string; ocorrencias: number; ultimo_ml_item_id: string | null;
};
export type ExtensaoUsage = {
  analises: number;
  por_tipo: { anuncio: number; busca: number; catalogo: number };
  pessoas_ativas: number;
  dias_com_uso: number;
  /** Vínculos manuais de produto da org (total, não do mês); null = contagem indisponível. */
  vinculos: number | null;
  pessoas: ExtensaoUsoPessoa[];
  erros: ExtensaoErroLeitura[];
  erros_total: number;
  primeiro_uso: string | null;
};

// ---------------------------------------------------------------------------------------------
// ADR-0193 (Fatia 1): relatório mensal do cliente. Fonte única do PDF e da aba Resultados — a UI
// nunca recalcula dinheiro. `null` = indisponível (com motivo), nunca zero.
// ---------------------------------------------------------------------------------------------
/** Faturamento (centavos) dos itens faturáveis sem lucro calculável, por motivo (ADR-0193 D-3). */
export type ProfitExclusions = { sem_custo: Cents; aliquota_nao_confirmada: Cents; frete_nao_lido: Cents };
export type AfterAdsUnavailableReason =
  | 'lucro_indisponivel' | 'lucro_parcial' | 'ads_indisponivel' | 'ads_cobertura_parcial';

export type PeriodKpis = {
  /** Faturamento da loja (total_amount − cupom do vendedor) das vendas faturáveis. */
  gross_cents: Cents;
  orders: number;
  units: number;
  ticket_cents: Cents;
  unit_price_cents: Cents | null;
  cancelled_orders: number;
  /** Estornos pela data do estorno (ADR-0106); informativo — não reduz faturamento nem lucro. */
  refunds_cents: Cents | null;
  seller_coupon_cents: Cents;
  /** Líquido do ML (após comissão e frete), ANTES do imposto. */
  net_cents: Cents;
  /** null = alíquota não confirmada (nunca presumida). */
  tax_cents: Cents | null;
  /** Custo dos itens com lucro calculável (base do markup). */
  cost_cents: Cents | null;
  profit_cents: Cents | null;
  covered_gross_cents: Cents;
  /** covered ÷ faturamento dos itens faturáveis (mesmo conjunto de itens). */
  profit_coverage: number | null;
  excluded_items: number;
  exclusions: ProfitExclusions;
  /** Antes de Ads: lucro ÷ covered_gross (parcial quando `profit_partial`). */
  margin: number | null;
  markup: number | null;
  ads_cost_cents: Cents | null;
  profit_after_ads_cents: Cents | null;
  margin_after_ads: number | null;
  markup_after_ads: number | null;
  profit_partial: boolean;
  unavailable_reason: AfterAdsUnavailableReason | null;
};

export type DailyPoint = {
  day: string; gross_cents: Cents; orders: number;
  profit_after_ads_cents: Cents | null; prev_gross_cents: Cents | null;
};

export type SeriesPoint = {
  month: Month;
  gross_cents: Cents | null;
  profit_cents: Cents | null;
  ads_cost_cents: Cents | null;
  profit_after_ads_cents: Cents | null;
  margin_after_ads: number | null;
  partial: boolean;
  /** Mês não calculado (volume acima do teto ou falha de leitura): ponto indisponível, nunca zero. */
  unavailable_reason: 'volume' | 'leitura' | null;
};

export type FamilyRow = {
  key: string; name: string | null; units: number; gross_cents: Cents; share: number;
  profit_cents: Cents | null; margin: number | null; markup: number | null; partial: boolean;
  class: 'A' | 'B' | 'C' | null;
};

export type TopFamilies = {
  rows: FamilyRow[];
  top_share: number;
  universe_gross_cents: Cents;
  without_code_gross_cents: Cents;
  unknown_family_gross_cents: Cents;
};

export type AdsKpis = {
  coverage: 'complete' | 'partial' | 'none';
  days_covered: number;
  days_expected: number;
  /** Métricas só com cobertura completa; senão null (ausência de linha ≠ zero). */
  cost_cents: Cents | null;
  revenue_cents: Cents | null;
  direct_revenue_cents: Cents | null;
  roas: number | null; acos: number | null; tacos: number | null;
  prints: number | null; clicks: number | null; ctr: number | null; cpc_cents: Cents | null;
  attribution: 'final' | 'open' | null;
  /** Último dia com atribuição em aberto; prazo previsto = esse dia + 15. */
  attribution_open_until: string | null;
  attribution_expected_final_on: string | null;
};

export type TrafficKpis = {
  visits: number; listings: number; orders: number; conversion: number | null;
  days_covered: number; days_in_month: number;
};

export type MonthlyReport = {
  org: { id: string; nome: string; slug: string; modality: 1 | 2 | null };
  month: Month;
  previous_month: Month;
  generated_at: string;
  statement: { status: 'closed'; id: string; closed_at: string; snapshot: BillingStatement } | { status: 'open' };
  summary: { current: PeriodKpis; previous: PeriodKpis | null };
  daily: DailyPoint[];
  series: SeriesPoint[];
  /** null = catálogo de famílias ilegível (ver warnings). */
  top_families: TopFamilies | null;
  ads: AdsKpis | null;
  traffic: TrafficKpis | null;
  warnings: MetricsWarning[];
};
