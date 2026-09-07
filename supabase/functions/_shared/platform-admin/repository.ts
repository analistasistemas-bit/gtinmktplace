import { readOrgMetrics } from './metrics-repository.ts';
import type { AuditRow, BillingPreview, BillingStatement, CommercialTerms, OrgSummary, Page, PulseUsage, PulseUsageRow } from './types.ts';

type DbResult = { data: unknown; error: { message: string } | null; count?: number | null };
type DbQuery = PromiseLike<DbResult> & {
  select(columns: string, options?: { count?: 'exact'; head?: boolean }): DbQuery;
  eq(column: string, value: unknown): DbQuery;
  order(column: string, options?: { ascending: boolean }): DbQuery;
  range(from: number, to: number): DbQuery;
  maybeSingle(): DbQuery;
  single(): DbQuery;
  in(column: string, values: unknown[]): DbQuery;
  gte(column: string, value: unknown): DbQuery;
  lt(column: string, value: unknown): DbQuery;
  like(column: string, value: string): DbQuery;
  limit(n: number): DbQuery;
};
type DbTable = { select(columns: string, options?: { count?: 'exact'; head?: boolean }): DbQuery };
type Db = { from(table: string): DbTable; rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResult> };

type OrgRow = { id: string; nome: string; slug: string; is_test: boolean };
type StatementRow = { id: string; snapshot: BillingStatement; closed_at: string; closed_by: string };
type SearchRow = {
  id: string; actor_id: string; created_at: string; normalized_query: string; query_type: string;
  origin: string; state: string; result_id: string | null;
};
type DeliveryRow = { id: string; search_id: string; units: number; total_cents: number; reason: string | null };
type DeliveryTotals = { units: number; total_cents: number };
type PlatformAuditRow = {
  id: string; org_id: string; actor_id: string; occurred_at: string; category: string;
  action: string; result: string; target: string | null; reason: string | null; details: Record<string, unknown> | null;
};
type SonarAuditRow = {
  id: string; org_id: string; actor_id: string; occurred_at: string; stage: string;
  outcome: string; reason: string | null; search_id: string | null; result_id: string | null;
};
type SupportAuditRow = {
  id: string; org_id: string; actor_id: string; created_at: string; event: string;
  result: string; target_type: string | null; target_id: string | null; support_request_id: string | null;
};

function fail(error: { message: string } | null): void { if (error) throw new Error(error.message); }
function monthDate(month: string): string { return `${month}-01`; }
function monthBounds(month: string): [string, string] {
  const [year, number] = month.split('-').map(Number); const next = new Date(Date.UTC(year, number, 1));
  return [`${month}-01T00:00:00-03:00`, `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01T00:00:00-03:00`];
}
async function mapLimit<T, R>(values: T[], limit: number, fn: (value: T) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(values.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    for (;;) { const index = cursor++; if (index >= values.length) return; result[index] = await fn(values[index]); }
  })); return result;
}
async function allRows<T>(build: (from: number, to: number) => PromiseLike<DbResult>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0;; from += 1000) {
    const { data, error } = await build(from, from + 999); fail(error); const page = (data ?? []) as T[]; rows.push(...page);
    if (page.length < 1000) return rows;
  }
}
async function exactCount(query: PromiseLike<DbResult>): Promise<number | null> {
  const result = await query; return result.error ? null : result.count ?? 0;
}

export function createPlatformAdminRepository(db: Db, now = () => new Date()) {
  const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.rpc(name, args); fail(error); return data as T;
  };
  const enrichOne = async (actorId: string, org: { id: string; nome: string; slug: string; is_test: boolean }, month: string): Promise<OrgSummary> => {
    const [metricsResult, previewResult, pending, daludi] = await Promise.all([
      readOrgMetrics(db as never, org.id, month, now()).then((value) => ({ value })).catch(() => ({ value: null })),
      rpc<BillingPreview>('platform_billing_preview', { p_actor: actorId, p_org: org.id, p_month: monthDate(month) }).then((value) => ({ value })).catch(() => ({ value: null })),
      exactCount(db.from('platform_sonar_searches').select('id', { count: 'exact', head: true }).eq('org_id', org.id).eq('state', 'pending')),
      exactCount(db.from('platform_sonar_searches').select('id', { count: 'exact', head: true }).eq('org_id', org.id).eq('origin', 'daludi').gte('created_at', monthBounds(month)[0]).lt('created_at', monthBounds(month)[1])),
    ]);
    const preview = previewResult.value; const validPreview = preview && preview.blockers.length === 0 ? preview : null;
    return { ...org, modality: preview?.terms?.modality ?? null, metrics: metricsResult.value,
      forecast_cents: validPreview?.total_cents ?? null, billable_units: validPreview?.sonar_units ?? null,
      daludi_searches: daludi, pending_count: pending };
  };
  const loadOrganizations = (includeTest: boolean) => allRows<OrgRow>((from, to) => {
    let query = db.from('organizations').select('id,nome,slug,is_test').order('id');
    if (!includeTest) query = query.eq('is_test', false); return query.range(from, to);
  });

  return {
    async organizationExists(orgId: string): Promise<boolean> {
      const { data, error } = await db.from('organizations').select('id').eq('id', orgId).maybeSingle(); fail(error); return !!data;
    },
    async organization(actorId: string, orgId: string, month: string): Promise<OrgSummary | null> {
      const { data, error } = await db.from('organizations').select('id,nome,slug,is_test').eq('id', orgId).maybeSingle(); fail(error);
      return data ? enrichOne(actorId, data as OrgRow, month) : null;
    },
    async list(actorId: string, input: { month: string; search?: string; include_test?: boolean; page: number; page_size: number; sort: string }): Promise<Page<OrgSummary>> {
      const needle = input.search?.trim().toLocaleLowerCase('pt-BR');
      const organizations = (await loadOrganizations(!!input.include_test)).filter((org) => !needle || org.nome.toLocaleLowerCase('pt-BR').includes(needle) || org.slug.toLocaleLowerCase('pt-BR').includes(needle));
      const summaries = await mapLimit(organizations, 4, (org) => enrichOne(actorId, org, input.month));
      summaries.sort(input.sort === 'gross_desc'
        ? (a, b) => (b.metrics?.gross_cents ?? -1) - (a.metrics?.gross_cents ?? -1) || a.nome.localeCompare(b.nome)
        : input.sort === 'slug' ? (a, b) => a.slug.localeCompare(b.slug) : (a, b) => a.nome.localeCompare(b.nome));
      const from = (input.page - 1) * input.page_size;
      return { rows: summaries.slice(from, from + input.page_size), total: summaries.length, page: input.page, page_size: input.page_size };
    },
    async overview(actorId: string, month: string, includeTest: boolean) {
      const organizations = await loadOrganizations(includeTest); const summaries = await mapLimit(organizations, 4, (org) => enrichOne(actorId, org, month));
      const completeMetrics = summaries.every((row) => row.metrics); const completeForecast = summaries.every((row) => row.forecast_cents !== null);
      return { gross_cents: completeMetrics ? summaries.reduce((sum, row) => sum + (row.metrics?.gross_cents ?? 0), 0) : null,
        forecast_cents: completeForecast ? summaries.reduce((sum, row) => sum + (row.forecast_cents ?? 0), 0) : null,
        org_count: summaries.length, pending_count: summaries.some((row) => row.pending_count === null) ? null : summaries.reduce((sum, row) => sum + (row.pending_count ?? 0), 0),
        warnings: completeMetrics ? [] : ['Métricas indisponíveis para parte da carteira'] };
    },
    metrics: (_actorId: string, orgId: string, month: string) => readOrgMetrics(db as never, orgId, month, now()),
    async terms(_actorId: string, orgId: string) { const { data, error } = await db.from('platform_commercial_terms').select('*').eq('org_id', orgId).order('starts_on', { ascending: false }).order('version', { ascending: false }); fail(error); return { rows: data ?? [] }; },
    saveTerms: (actorId: string, input: Record<string, unknown>) => rpc<CommercialTerms>('platform_save_terms', { p_actor: actorId, p_input: input }),
    preview: (actorId: string, orgId: string, month: string) => rpc<BillingPreview>('platform_billing_preview', { p_actor: actorId, p_org: orgId, p_month: monthDate(month) }),
    close: (actorId: string, orgId: string, month: string, revision: string) => rpc<BillingStatement>('platform_billing_close', { p_actor: actorId, p_org: orgId, p_month: monthDate(month), p_expected_revision: revision }),
    reconcile: (actorId: string, input: Record<string, unknown>) => rpc<{ id: string }>('platform_reconcile_revenue', { p_actor: actorId, p_input: input }),
    async statements(_actorId: string, orgId: string, page: number, pageSize: number): Promise<Page<BillingStatement>> {
      const from = (page - 1) * pageSize; const { data, error, count } = await db.from('platform_billing_statements').select('id,snapshot,closed_at,closed_by', { count: 'exact' }).eq('org_id', orgId).order('month', { ascending: false }).range(from, from + pageSize - 1); fail(error);
      return { rows: ((data ?? []) as StatementRow[]).map((row) => ({ ...row.snapshot, id: row.id, closed_at: row.closed_at, closed_by: row.closed_by })), total: count ?? 0, page, page_size: pageSize };
    },
    async statement(_actorId: string, orgId: string, statementId: string): Promise<BillingStatement> {
      const { data, error } = await db.from('platform_billing_statements').select('id,snapshot,closed_at,closed_by').eq('org_id', orgId).eq('id', statementId).single(); fail(error); const row = data as StatementRow;
      return { ...row.snapshot, id: row.id, closed_at: row.closed_at, closed_by: row.closed_by };
    },
    async pulseUsage(_actorId: string, orgId: string, month: string, page: number, pageSize: number): Promise<PulseUsage> {
      const [start, end] = monthBounds(month); const from = (page - 1) * pageSize;
      const { data, error, count } = await db.from('platform_sonar_searches').select('id,actor_id,created_at,normalized_query,query_type,origin,state,result_id', { count: 'exact' }).eq('org_id', orgId).gte('created_at', start).lt('created_at', end).order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, from + pageSize - 1); fail(error);
      const searches = (data ?? []) as SearchRow[]; const ids = searches.map((row) => row.id); let deliveries: DeliveryRow[] = [];
      if (ids.length) { const deliveryResult = await db.from('platform_sonar_deliveries').select('id,search_id,units,total_cents,reason').eq('org_id', orgId).in('search_id', ids); fail(deliveryResult.error); deliveries = (deliveryResult.data ?? []) as DeliveryRow[]; }
      const bySearch = new Map(deliveries.map((row) => [row.search_id, row]));
      const rows: PulseUsageRow[] = searches.map((row) => { const delivery = bySearch.get(row.id); return { id: row.id, org_id: orgId, actor_id: row.actor_id, actor_name: null, at: row.created_at, query: row.normalized_query, query_type: row.query_type === 'ean' ? 'ean' : 'termo', origin: row.origin === 'daludi' ? 'daludi' : 'cliente', result: row.state, exempt_reason: row.origin === 'daludi' ? 'daludi' : delivery?.reason ?? null, units: delivery?.units ?? 0, total_cents: delivery?.total_cents ?? 0, result_id: row.result_id }; });
      const [allDeliveries, daludi, failures, reopens, first] = await Promise.all([
        allRows<DeliveryTotals>((a, b) => db.from('platform_sonar_deliveries').select('units,total_cents').eq('org_id', orgId).eq('month', monthDate(month)).range(a, b)),
        exactCount(db.from('platform_sonar_searches').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('origin', 'daludi').gte('created_at', start).lt('created_at', end)),
        exactCount(db.from('platform_sonar_searches').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('state', 'failed').gte('created_at', start).lt('created_at', end)),
        exactCount(db.from('platform_sonar_searches').select('id', { count: 'exact', head: true }).eq('org_id', orgId).like('intent_key', 'reopen:%').gte('created_at', start).lt('created_at', end)),
        db.from('platform_sonar_searches').select('created_at').eq('org_id', orgId).order('created_at', { ascending: true }).limit(1),
      ]); fail(first.error);
      return { rows, total: count ?? 0, page, page_size: pageSize, client_units: allDeliveries.reduce((sum, row) => sum + Number(row.units), 0), client_cents: allDeliveries.reduce((sum, row) => sum + Number(row.total_cents), 0), daludi_searches: daludi ?? 0, failures: failures ?? 0, reopens: reopens ?? 0, measured_cost_cents: null, tracked_since: ((first.data as { created_at: string }[] | null)?.[0]?.created_at ?? null) };
    },
    async audit(_actorId: string, orgId: string, month: string, filters: { category?: string; actor_id?: string; result?: string }, page: number, pageSize: number): Promise<Page<AuditRow>> {
      const [start, end] = monthBounds(month);
      const [platform, sonar, support] = await Promise.all([
        allRows<PlatformAuditRow>((a, b) => db.from('platform_audit_events').select('id,org_id,actor_id,occurred_at,category,action,result,target,reason,details').eq('org_id', orgId).gte('occurred_at', start).lt('occurred_at', end).range(a, b)),
        allRows<SonarAuditRow>((a, b) => db.from('platform_sonar_events').select('id,org_id,actor_id,occurred_at,stage,outcome,reason,search_id,result_id').eq('org_id', orgId).gte('occurred_at', start).lt('occurred_at', end).range(a, b)),
        allRows<SupportAuditRow>((a, b) => db.from('support_audit_events').select('id,org_id,actor_id,created_at,event,result,target_type,target_id,support_request_id').eq('org_id', orgId).gte('created_at', start).lt('created_at', end).range(a, b)),
      ]);
      const rows: AuditRow[] = [
        ...platform.map((row) => ({ id: row.id, org_id: row.org_id, actor_id: row.actor_id, actor_name: null, at: row.occurred_at, category: (row.category === 'billing' || row.category === 'pulse' || row.category === 'support' ? row.category : 'admin') as AuditRow['category'], action: row.action, result: row.result, target: row.target, reason: row.reason, details: row.details ?? {} })),
        ...sonar.map((row) => ({ id: row.id, org_id: row.org_id, actor_id: row.actor_id, actor_name: null, at: row.occurred_at, category: 'pulse' as const, action: row.stage, result: row.outcome, target: row.search_id, reason: row.reason, details: { result_id: row.result_id } })),
        ...support.map((row) => ({ id: row.id, org_id: row.org_id, actor_id: row.actor_id, actor_name: null, at: row.created_at, category: 'support' as const, action: String(row.event), result: String(row.result), target: row.target_id ?? row.support_request_id, reason: null, details: { target_type: row.target_type } })),
      ].filter((row) => (!filters.category || row.category === filters.category) && (!filters.actor_id || row.actor_id === filters.actor_id) && (!filters.result || row.result === filters.result));
      rows.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)); const from = (page - 1) * pageSize;
      return { rows: rows.slice(from, from + pageSize), total: rows.length, page, page_size: pageSize };
    },
  };
}
