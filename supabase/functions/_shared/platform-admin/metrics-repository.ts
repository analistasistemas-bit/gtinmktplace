import type { MetricsWarning, OrgMetrics } from './types.ts';
import { calcularResumo, type ResumoVendas } from './sales-summary.ts';
import { montarAliquotaResolver, montarCustoResolver, montarMapasCusto, montarPesoResolver } from './sales-costs.ts';
import { comCustoCongelado, type CustoCongeladoRow, type Venda, type VendaItem } from './sales-types.ts';

type DbError = { message: string } | null;
type Page = { data: Record<string, unknown>[] | null; error: DbError };
type Query = {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  gte(column: string, value: unknown): Query;
  lt(column: string, value: unknown): Query;
  order(column: string, options: { ascending: boolean }): Query;
  range(from: number, to: number): Promise<Page>;
};
type RpcResult = { data: unknown; error: DbError };
export type MetricsDb = {
  from(table: string): Query;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
};

const PAGE_SIZE = 1000;
const BRT_OFFSET = '-03:00';

/** Mesma lista de colunas de `buscarVendas` (`src/lib/faturamento.ts`), mais `org_id` — que
 *  `normalizeSales` usa para descartar linha de outra organização e NÃO está na lista do app.
 *  `select('*')` traria `ml_vendas.raw` (~4 MB por render da carteira) que ninguém lê (ADR-0156 §4). */
const SALES_COLUMNS = 'id, org_id, order_id, pack_id, status, status_detail, date_closed, date_created, '
  + 'comprador_nick, comprador_nome, comprador_id, uf, cidade, total_amount, paid_amount, sale_fee_total, '
  + 'frete_vendedor, liquido, estorno, money_release_date, sacado_em, sacado_por, atualizado_em, currency, '
  + 'shipping_id, shipping_status, shipping_substatus, shipping_logistic, tracking_number, is_publiai, '
  + 'tem_devolucao, kit_item_id, '
  + 'itens:ml_vendas_itens(id, ml_item_id, variation_id, titulo, codigo, cor, ean, quantity, unit_price, sale_fee, is_publiai), '
  + 'custos:venda_item_custo(ml_item_id, variation_id, custo_unitario)';

function addMonths(month: string, delta: number): string {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, number - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function startOf(month: string): string {
  return `${month}-01T00:00:00${BRT_OFFSET}`;
}

function currentMonth(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}`;
}

async function readPages(build: () => Query): Promise<{ rows: Record<string, unknown>[]; error: DbError }> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await build().range(from, from + PAGE_SIZE - 1);
    if (page.error) return { rows: [], error: page.error };
    const values = page.data ?? [];
    rows.push(...values);
    if (values.length < PAGE_SIZE) return { rows, error: null };
  }
}

function sameOrg(row: Record<string, unknown>, orgId: string): boolean {
  return row.org_id == null || row.org_id === orgId;
}

function normalizeSales(rows: Record<string, unknown>[], orgId: string): Venda[] {
  return rows.filter((row) => row.org_id === orgId).map((row) => {
    const sale = row as unknown as Venda & { custos?: CustoCongeladoRow[] | null };
    const costs = (sale.custos ?? []).filter((cost) => {
      const scoped = cost as CustoCongeladoRow & { org_id?: string; venda_id?: string };
      return (scoped.org_id == null || scoped.org_id === orgId) && (scoped.venda_id == null || scoped.venda_id === sale.id);
    });
    const items = ((sale.itens ?? []) as Array<VendaItem & { org_id?: string; venda_id?: string }>).filter((item) =>
      (item.org_id == null || item.org_id === orgId) && (item.venda_id == null || item.venda_id === sale.id)
    );
    const { custos: _costs, ...plain } = sale;
    return { ...plain, itens: comCustoCongelado({ ...plain, itens: items, custos: costs }) };
  });
}

function rangeSales(sales: Venda[], start: string, end: string): Venda[] {
  const from = Date.parse(start);
  const to = Date.parse(end);
  return sales.filter((sale) => {
    const at = Date.parse(sale.date_closed ?? sale.date_created ?? '');
    return Number.isFinite(at) && at >= from && at < to;
  });
}

function summarize(
  sales: Venda[], maps: ReturnType<typeof montarMapasCusto> | undefined,
  rates: { nacional: number; importado: number; ufEmpresa: string | null; internaPct: number | null } | null,
  now: Date, costsAvailable: boolean, configAvailable: boolean,
): ResumoVendas {
  const summary = calcularResumo(
    sales, montarCustoResolver(maps), montarPesoResolver(maps), now.getTime(),
    configAvailable ? montarAliquotaResolver(maps, rates) : undefined,
  );
  if (!costsAvailable || !configAvailable) summary.markup = null;
  return summary;
}

function cents(value: number): number { return Math.round(value * 100); }

export async function readOrgMetrics(db: MetricsDb, orgId: string, month: string, now: Date): Promise<OrgMetrics> {
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('month inválido');
  if (!orgId) throw new Error('org_id inválido');

  const seriesMonths = Array.from({ length: 6 }, (_, index) => addMonths(month, index - 5));
  const selectedEnd = month === currentMonth(now) ? now.toISOString() : startOf(addMonths(month, 1));
  const salesResult = await readPages(() => db.from('ml_vendas')
    .select(SALES_COLUMNS)
    .eq('org_id', orgId).gte('date_closed', startOf(seriesMonths[0])).lt('date_closed', startOf(addMonths(month, 1)))
    .order('date_closed', { ascending: true }).order('id', { ascending: true }));
  if (salesResult.error) throw new Error(salesResult.error.message);
  const sales = normalizeSales(salesResult.rows, orgId);

  // ADR-0156 §5: a RPC devolve só as variações que casam com item vendido na janela da série, em UM
  // round-trip (era `variacoes` inteira, 9 páginas na Avil). Escalar jsonb de propósito: `returns
  // table` por POST seria truncado no `max_rows=1000` do PostgREST sem erro nenhum e o markup sairia
  // errado em silêncio.
  const catalogResult = await db.rpc('platform_org_cost_catalog', { p_org: orgId, p_since: startOf(seriesMonths[0]) });
  const configResult = await readPages(() => db.from('configuracoes')
    .select('org_id,aliquota_nacional_pct,aliquota_importado_pct,uf_empresa,aliquota_interna_pct,aliquotas_confirmadas_em')
    .eq('org_id', orgId).order('org_id', { ascending: true }));

  // Payload que não é array é falha, nunca catálogo vazio: catálogo vazio zera o markup em silêncio.
  const catalogRows = Array.isArray(catalogResult.data) ? catalogResult.data as Record<string, unknown>[] : null;
  const costsAvailable = !catalogResult.error && catalogRows != null;
  const maps = catalogRows == null || catalogResult.error ? undefined : montarMapasCusto(
    catalogRows.filter((row) => sameOrg(row, orgId))
      .map((row) => ({ ...row, familias: { ml_item_id: row.ml_item_id, origem: row.origem } })),
  );

  // ADR-0156 §6: alíquota nunca é presumida. Sem linha em `configuracoes`, sem
  // `aliquotas_confirmadas_em` ou sem as alíquotas, o markup sai `null` com aviso — jamais 8/16 %
  // por padrão (ADR-0055).
  const config = configResult.error ? null : configResult.rows.find((row) => row.org_id === orgId) ?? null;
  const configAvailable = !configResult.error && config != null && config.aliquotas_confirmadas_em != null
    && config.aliquota_nacional_pct != null && config.aliquota_importado_pct != null;
  const rates = configAvailable && config != null
    ? {
      nacional: Number(config.aliquota_nacional_pct),
      importado: Number(config.aliquota_importado_pct),
      ufEmpresa: typeof config.uf_empresa === 'string' ? config.uf_empresa : null,
      internaPct: config.aliquota_interna_pct != null ? Number(config.aliquota_interna_pct) : null,
    }
    : null;

  const selected = summarize(rangeSales(sales, startOf(month), selectedEnd), maps, rates, now, costsAvailable, configAvailable);
  const previousMonth = addMonths(month, -1);
  const elapsed = Date.parse(selectedEnd) - Date.parse(startOf(month));
  const previousFullEnd = Date.parse(startOf(month));
  const previousEndMs = month === currentMonth(now)
    ? Math.min(Date.parse(startOf(previousMonth)) + elapsed, previousFullEnd)
    : previousFullEnd;
  const previous = summarize(
    rangeSales(sales, startOf(previousMonth), new Date(previousEndMs).toISOString()),
    maps, rates, now, costsAvailable, configAvailable,
  );

  // Falha de leitura (não sabemos o custo/alíquota real) é `error`; ausência esperada e acionável
  // (organização sem confirmar a alíquota) é `warning` — a UI não pode misturar as duas na mesma cor.
  const warnings: MetricsWarning[] = [];
  if (!costsAvailable) {
    warnings.push({
      code: 'cost_catalog_read_failed', severity: 'error',
      message: `Falha ao carregar os custos: ${catalogResult.error?.message ?? 'catálogo em formato inesperado'}`,
    });
  }
  if (configResult.error) {
    warnings.push({
      code: 'tax_config_read_failed', severity: 'error',
      message: `Falha ao carregar a configuração tributária: ${configResult.error.message}`,
    });
  } else if (!configAvailable) {
    warnings.push({ code: 'tax_config_unconfirmed', severity: 'warning', message: 'Configuração tributária não confirmada' });
  }
  const updated = rangeSales(sales, startOf(month), selectedEnd).map((sale) => sale.atualizado_em).filter(Boolean).sort().at(-1) ?? null;

  return {
    org_id: orgId, month, gross_cents: cents(selected.bruto), orders: selected.pedidos,
    ticket_cents: cents(selected.ticket), markup: selected.markup,
    cost_covered_orders: selected.vendasComCusto, total_orders: selected.totalVendas,
    active_ads: null, publications: null, pending_operations: null, updated_at: updated,
    previous: { gross_cents: cents(previous.bruto), orders: previous.pedidos, markup: previous.markup },
    series: seriesMonths.map((value) => {
      const end = value === month ? selectedEnd : startOf(addMonths(value, 1));
      const summary = summarize(rangeSales(sales, startOf(value), end), maps, rates, now, costsAvailable, configAvailable);
      return { month: value, gross_cents: cents(summary.bruto), markup: summary.markup };
    }),
    warnings,
  };
}
