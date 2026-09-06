export type Month = string;
export type Cents = number;

export type CommercialTermsInput = {
  org_id: string;
  starts_on: string;
  modality: 1 | 2;
  monthly_fee_cents: Cents;
  revenue_bps: number;
  sonar_unit_cents: Cents;
  setup_fee_cents: Cents;
  setup_due_month: Month | null;
  reason: string;
};

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
  sonar_units: number;
  sonar_cents: Cents;
  lines: BillingLine[];
  total_cents: Cents;
  credit_cents: Cents;
  revision: string;
  blockers: Array<{ code: string; message: string; sale_id?: string }>;
};

export type BillingStatement = BillingPreview & {
  id: string;
  closed_at: string;
  closed_by: string;
};

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
  warnings: string[];
};

export type OrgSummary = {
  id: string;
  nome: string;
  slug: string;
  is_test: boolean;
  modality: 1 | 2 | null;
  metrics: OrgMetrics | null;
  forecast_cents: Cents | null;
  billable_units: number;
  daludi_searches: number;
  pending_count: number;
};

export type Page<T> = { rows: T[]; total: number; page: number; page_size: number };

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
