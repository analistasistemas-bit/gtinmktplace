import type { MetricsWarning, OrgMetrics } from './types.ts';
import { calcularResumo, type ResumoVendas } from './sales-summary.ts';
import { montarAliquotaResolver, montarCustoResolver, montarMapasCusto, montarPesoResolver } from './sales-costs.ts';
import { comCustoCongelado, type CustoCongeladoRow, type Venda, type VendaItem } from './sales-types.ts';

type DbError = { message: string } | null;
type Page = { data: Record<string, unknown>[] | null; error: DbError };
type Query = {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  gte(column: string, value: unknown): Query;
  lt(column: string, value: unknown): Query;
  order(column: string, options: { ascending: boolean }): Query;
  range(from: number, to: number): Promise<Page>;
  upsert(row: Record<string, unknown>, options?: { onConflict: string }): Promise<{ error: DbError }>;
};
type RpcResult = { data: unknown; error: DbError };
export type MetricsDb = {
  from(table: string): Query;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
};

const PAGE_SIZE = 1000;
const BRT_OFFSET = '-03:00';
const CACHE_TABLE = 'platform_org_month_metrics';
const VALIDATION_RPC = 'platform_org_month_validation';
const CACHE_COLUMNS = 'org_id,month,gross_cents,orders,ticket_cents,markup,cost_covered_orders,total_orders,'
  + 'updated_at,source_count,source_max_updated_at,tax_config_stamp';

/** Perf FASE 2.1: lista mínima que `readOrgMetrics`/`calcularResumo` de fato leem — não a de
 *  `buscarVendas` (`src/lib/faturamento.ts`), que alimenta telas com mais colunas (Publicados,
 *  Faturamento, Financeiro). `org_id` é obrigatório: `normalizeSales` descarta toda linha sem ele
 *  (`normalizeSales`, abaixo). `custos:venda_item_custo(...)` é obrigatório: sem ele o custo
 *  congelado (ADR-0109) some e o markup histórico muda. `select('*')` traria `ml_vendas.raw`
 *  (~4 MB por render da carteira) que ninguém lê (ADR-0158 §4).
 *  Cortado (conferido em `sales-summary.ts`/`sales-costs.ts`: nenhum leitor usa): status_detail,
 *  comprador_nick/nome/id, cidade, paid_amount, money_release_date, sacado_em, sacado_por, currency,
 *  shipping_status/substatus/logistic, tracking_number, is_publiai, tem_devolucao, kit_item_id da
 *  venda; id, titulo, cor, sale_fee, is_publiai do item (`titulo` alimenta `descricaoVenda`, mas o
 *  resultado vai para `summary.vendas`, que este arquivo descarta). */
const SALES_COLUMNS = 'id, org_id, order_id, pack_id, status, date_closed, date_created, uf, total_amount, '
  + 'sale_fee_total, frete_vendedor, liquido, estorno, atualizado_em, shipping_id, '
  + 'itens:ml_vendas_itens(ml_item_id, variation_id, codigo, ean, quantity, unit_price), '
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

/** Perf FASE 3.3: mês fechado (regra de gravação, 3.1) é `value < currentMonth`. Elegível para
 *  LEITURA do cache é mais estrito: exclui também o mês imediatamente anterior ao real — medido em
 *  produção que 486 vendas de meses fechados foram tocadas em setembro (devolução/estorno tardios),
 *  e é justo esse mês que ainda recebe a maior parte das correções. Continua podendo ser GRAVADO
 *  (write gate, `isClosed`) para já chegar pronto quando deixar de ser "anterior". */
function isClosed(value: string, now: Date): boolean {
  return value < currentMonth(now);
}
function isCacheEligible(value: string, now: Date): boolean {
  return isClosed(value, now) && value !== addMonths(currentMonth(now), -1);
}

/** `YYYY-MM-DD` (coluna `date`) ou `YYYY-MM` → sempre `YYYY-MM`. */
function monthKey(value: unknown): string {
  return String(value).slice(0, 7);
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

/** Perf FASE 2.2: uma leitura por mês-calendário, em paralelo, em vez de um único `range` sequencial
 *  sobre a janela inteira. NÃO é count + offsets paralelos (proposta rejeitada na revisão): sem
 *  snapshot comum, venda inserida no meio deslocaria offsets e duplicaria/perderia linha, alterando
 *  número financeiro. Cada mês é uma faixa `gte/lt` fechada e independente de offset. */
async function readSalesByMonth(
  db: MetricsDb, orgId: string, months: string[],
): Promise<{ rows: Record<string, unknown>[]; error: DbError }> {
  const perMonth = await Promise.all(months.map((monthValue) => readPages(() => db.from('ml_vendas')
    .select(SALES_COLUMNS)
    .eq('org_id', orgId).gte('date_closed', startOf(monthValue)).lt('date_closed', startOf(addMonths(monthValue, 1)))
    .order('date_closed', { ascending: true }).order('id', { ascending: true }))));
  const failed = perMonth.find((page) => page.error);
  if (failed) return { rows: [], error: failed.error };
  return { rows: perMonth.flatMap((page) => page.rows), error: null };
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

type Rates = { nacional: number; importado: number; ufEmpresa: string | null; internaPct: number | null };

function summarize(
  sales: Venda[], maps: ReturnType<typeof montarMapasCusto> | undefined, rates: Rates | null,
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

// ---------------------------------------------------------------------------------------------
// Perf FASE 3 (ADR-0159): configuração tributária é lida UMA vez por chamada (não muda por mês) e
// reaproveitada tanto pelos meses ao vivo quanto por `materializeMonth`/`resolveMonth` abaixo.
// ---------------------------------------------------------------------------------------------
type ConfigState = { configAvailable: boolean; rates: Rates | null; configErrored: boolean; errorMessage: string | null };

async function loadConfigState(db: MetricsDb, orgId: string): Promise<ConfigState> {
  const configResult = await readPages(() => db.from('configuracoes')
    .select('org_id,aliquota_nacional_pct,aliquota_importado_pct,uf_empresa,aliquota_interna_pct,aliquotas_confirmadas_em')
    .eq('org_id', orgId).order('org_id', { ascending: true }));
  // ADR-0158 §6: alíquota nunca é presumida. Sem linha em `configuracoes`, sem
  // `aliquotas_confirmadas_em` ou sem as alíquotas, o markup sai `null` — jamais 8/16 % (ADR-0055).
  const config = configResult.error ? null : configResult.rows.find((row) => row.org_id === orgId) ?? null;
  const configAvailable = !configResult.error && config != null && config.aliquotas_confirmadas_em != null
    && config.aliquota_nacional_pct != null && config.aliquota_importado_pct != null;
  const rates: Rates | null = configAvailable && config != null
    ? {
      nacional: Number(config.aliquota_nacional_pct), importado: Number(config.aliquota_importado_pct),
      ufEmpresa: typeof config.uf_empresa === 'string' ? config.uf_empresa : null,
      internaPct: config.aliquota_interna_pct != null ? Number(config.aliquota_interna_pct) : null,
    }
    : null;
  return { configAvailable, rates, configErrored: !!configResult.error, errorMessage: configResult.error?.message ?? null };
}

/** Assinatura da config usada no cálculo — grava na linha (`tax_config_stamp`) e invalida o cache
 *  se mudar. `'unconfirmed'` cobre tanto "sem confirmação" quanto "leitura falhou": nos dois casos
 *  o cálculo ao vivo também produz `markup: null`, então servir uma linha antiga com esse carimbo
 *  nunca diverge do que o cálculo ao vivo daria hoje. */
function taxConfigStamp(configState: ConfigState): string {
  if (!configState.configAvailable || !configState.rates) return 'unconfirmed';
  const r = configState.rates;
  return JSON.stringify([r.nacional, r.importado, r.ufEmpresa, r.internaPct]);
}

type MonthComputed = {
  gross_cents: number; orders: number; ticket_cents: number; markup: number | null;
  cost_covered_orders: number; total_orders: number; updated_at: string | null;
  source_count: number; source_max_updated_at: string | null;
  costsAvailable: boolean; catalogErrorMessage: string | null;
};

/** Núcleo único de cálculo de um mês (ou fração de mês, via `end`): busca as vendas de
 *  `[startOf(month), end)`, o catálogo de custo (`p_since = startOf(month)` — ver prova em
 *  `platform_org_cost_catalog`: o `IN` do catálogo é por chave, não por linha, então restringir a
 *  janela ao próprio mês nunca troca o vencedor de uma chave referenciada por uma venda desse mês)
 *  e resume com `calcularResumo`. `materializeMonth`, o job e o read-through convergem aqui — é
 *  isso que garante paridade por construção (perf FASE 3.2). */
async function computeMonth(
  db: MetricsDb, orgId: string, month: string, now: Date, end: string, configState: ConfigState,
): Promise<MonthComputed> {
  const salesResult = await readPages(() => db.from('ml_vendas').select(SALES_COLUMNS)
    .eq('org_id', orgId).gte('date_closed', startOf(month)).lt('date_closed', end)
    .order('date_closed', { ascending: true }).order('id', { ascending: true }));
  if (salesResult.error) throw new Error(salesResult.error.message);
  const sales = normalizeSales(salesResult.rows, orgId);

  const catalogResult = await db.rpc('platform_org_cost_catalog', { p_org: orgId, p_since: startOf(month) });
  const catalogRows = Array.isArray(catalogResult.data) ? catalogResult.data as Record<string, unknown>[] : null;
  const costsAvailable = !catalogResult.error && catalogRows != null;
  const maps = catalogRows == null || catalogResult.error ? undefined : montarMapasCusto(
    catalogRows.filter((row) => sameOrg(row, orgId))
      .map((row) => ({ ...row, familias: { ml_item_id: row.ml_item_id, origem: row.origem } })),
  );

  const summary = summarize(sales, maps, configState.rates, now, costsAvailable, configState.configAvailable);
  const updated = sales.map((sale) => sale.atualizado_em).filter(Boolean).sort().at(-1) ?? null;

  return {
    gross_cents: cents(summary.bruto), orders: summary.pedidos, ticket_cents: cents(summary.ticket),
    markup: summary.markup, cost_covered_orders: summary.vendasComCusto, total_orders: summary.totalVendas,
    updated_at: updated, source_count: sales.length, source_max_updated_at: updated,
    costsAvailable,
    catalogErrorMessage: catalogResult.error?.message ?? (catalogRows == null ? 'catálogo em formato inesperado' : null),
  };
}

export type MaterializedMonth = {
  org_id: string; month: string; gross_cents: number; orders: number; ticket_cents: number;
  markup: number | null; cost_covered_orders: number; total_orders: number; updated_at: string | null;
  source_count: number; source_max_updated_at: string | null; tax_config_stamp: string;
  /** Íntegro o bastante p/ persistir (nunca grava um mês calculado sob falha — ver `resolveMonth`). */
  costs_ok: boolean; config_ok: boolean;
};

/** Perf FASE 3.2: `readOrgMetrics` restrito a UM mês fechado — mesmo `computeMonth` que alimenta o
 *  read-through (`resolveMonth`), então o job (`materializar-metricas`) e a leitura ao vivo nunca
 *  podem divergir por implementação duplicada. Usado standalone pelo job e testado contra
 *  `readOrgMetrics` (paridade, com cache vazio) no teste de unidade. */
export async function materializeMonth(db: MetricsDb, orgId: string, month: string, now: Date): Promise<MaterializedMonth> {
  const configState = await loadConfigState(db, orgId);
  const computed = await computeMonth(db, orgId, month, now, startOf(addMonths(month, 1)), configState);
  return {
    org_id: orgId, month, gross_cents: computed.gross_cents, orders: computed.orders,
    ticket_cents: computed.ticket_cents, markup: computed.markup, cost_covered_orders: computed.cost_covered_orders,
    total_orders: computed.total_orders, updated_at: computed.updated_at, source_count: computed.source_count,
    source_max_updated_at: computed.source_max_updated_at, tax_config_stamp: taxConfigStamp(configState),
    costs_ok: computed.costsAvailable, config_ok: !configState.configErrored,
  };
}

type CachedMonthRow = {
  gross_cents: number; orders: number; ticket_cents: number; markup: number | null;
  cost_covered_orders: number; total_orders: number; updated_at: string | null;
  source_count: number; source_max_updated_at: string | null; tax_config_stamp: string;
};
type MonthValidation = { count: number; maxUpdatedAt: string | null };

/** Cache carregado para um conjunto de organizações + mês exibido — ver `loadMetricsCache`. */
export type MetricsCache = { cachedRows: Map<string, CachedMonthRow>; validation: Map<string, MonthValidation> };
const EMPTY_CACHE: MetricsCache = { cachedRows: new Map(), validation: new Map() };
const cacheKey = (orgId: string, month: string) => `${orgId}|${month}`;

/** PostgREST devolve `numeric`/`bigint` como número JSON, não como string — o `Number()` aqui é
 *  defensivo (inofensivo se o valor já vier numérico), não uma correção de tipo necessária. */
function toCachedRow(row: Record<string, unknown>): CachedMonthRow {
  return {
    gross_cents: Number(row.gross_cents), orders: Number(row.orders), ticket_cents: Number(row.ticket_cents),
    markup: row.markup == null ? null : Number(row.markup),
    cost_covered_orders: Number(row.cost_covered_orders), total_orders: Number(row.total_orders),
    updated_at: row.updated_at == null ? null : String(row.updated_at),
    source_count: Number(row.source_count),
    source_max_updated_at: row.source_max_updated_at == null ? null : String(row.source_max_updated_at),
    tax_config_stamp: String(row.tax_config_stamp),
  };
}

/** Perf FASE 3.3: UMA leitura da tabela materializada + (só se houver linha candidata) UMA
 *  validação por RPC, para a CARTEIRA INTEIRA (`orgIds` de mais de uma organização, `p_org: null` —
 *  nunca por org). Sem linha candidata, a validação nem roda: nada a validar, tudo cai no cálculo
 *  ao vivo, sem round-trip extra (é o caso de hoje, cache frio — mantém os testes antigos intactos).
 *  Nunca lança: qualquer falha devolve cache vazio e tudo vira ao vivo (nunca zero silencioso). */
export async function loadMetricsCache(db: MetricsDb, orgIds: string[], month: string, now: Date): Promise<MetricsCache> {
  if (!orgIds.length) return EMPTY_CACHE;
  const seriesMonths = Array.from({ length: 6 }, (_, index) => addMonths(month, index - 5));
  const eligible = seriesMonths.filter((value) => isCacheEligible(value, now));
  if (!eligible.length) return EMPTY_CACHE;
  try {
    // A coluna `month` é `date` (`YYYY-MM-DD`) — postgres não aceita `YYYY-MM` como literal de data,
    // então o filtro precisa do dia (`-01`); as chaves internas do cache continuam em `YYYY-MM`
    // (`monthKey`, abaixo), formato de todo o resto deste arquivo.
    const cached = await readPages(() => db.from(CACHE_TABLE).select(CACHE_COLUMNS)
      .in('org_id', orgIds).in('month', eligible.map((value) => `${value}-01`))
      .order('org_id', { ascending: true }).order('month', { ascending: true }));
    if (cached.error || cached.rows.length === 0) return EMPTY_CACHE;
    const cachedRows = new Map<string, CachedMonthRow>();
    for (const row of cached.rows) cachedRows.set(cacheKey(String(row.org_id), monthKey(row.month)), toCachedRow(row));

    const validationResult = await db.rpc(VALIDATION_RPC, {
      p_org: orgIds.length === 1 ? orgIds[0] : null, p_since: startOf(seriesMonths[0]),
    });
    if (validationResult.error || !Array.isArray(validationResult.data)) return { cachedRows, validation: new Map() };
    const validation = new Map<string, MonthValidation>();
    for (const row of validationResult.data as Record<string, unknown>[]) {
      validation.set(cacheKey(String(row.org_id), monthKey(row.month)), {
        count: Number(row.source_count),
        maxUpdatedAt: row.source_max_updated_at == null ? null : String(row.source_max_updated_at),
      });
    }
    // A RPC agrupa por venda existente: um mês sem nenhuma venda não gera grupo. Com a RPC OK, a
    // ausência de grupo é "0 vendas", não "não sei" — senão um mês de 0 vendas nunca bate o cache.
    for (const orgId of orgIds) {
      for (const value of eligible) {
        const key = cacheKey(orgId, value);
        if (!validation.has(key)) validation.set(key, { count: 0, maxUpdatedAt: null });
      }
    }
    return { cachedRows, validation };
  } catch {
    return EMPTY_CACHE;
  }
}

type ResolvedMonth = {
  gross_cents: number; orders: number; ticket_cents: number; markup: number | null;
  cost_covered_orders: number; total_orders: number; updated_at: string | null;
  costsAvailable: boolean; catalogErrorMessage: string | null;
};

async function upsertMonth(
  db: MetricsDb, orgId: string, month: string, computed: MonthComputed, stamp: string, now: Date,
): Promise<void> {
  await db.from(CACHE_TABLE).upsert({
    org_id: orgId, month: `${month}-01`, gross_cents: computed.gross_cents, orders: computed.orders,
    ticket_cents: computed.ticket_cents, markup: computed.markup, cost_covered_orders: computed.cost_covered_orders,
    total_orders: computed.total_orders, updated_at: computed.updated_at, source_count: computed.source_count,
    source_max_updated_at: computed.source_max_updated_at, tax_config_stamp: stamp, computed_at: now.toISOString(),
  }, { onConflict: 'org_id,month' });
}

/** Perf FASE 3.3: resolve UM mês fechado — cache válido → usa; ausente ou inválido →
 *  `computeMonth` (mesmo núcleo de `materializeMonth`) + upsert. Gravar só quando custo E config
 *  vieram íntegros: uma falha transitória de catálogo geraria `markup: null` "congelado" para
 *  sempre num mês que nunca mais recalcula sozinho (config-inconfirmada já se autocorrige pelo
 *  carimbo, catálogo não tem carimbo equivalente). Nunca lança: erro no upsert é best-effort. */
async function resolveMonth(
  db: MetricsDb, orgId: string, value: string, now: Date, cache: MetricsCache, configState: ConfigState,
): Promise<ResolvedMonth> {
  if (isCacheEligible(value, now)) {
    const key = cacheKey(orgId, value);
    const cached = cache.cachedRows.get(key);
    const validation = cache.validation.get(key);
    if (cached && validation && cached.source_count === validation.count
      && cached.source_max_updated_at === validation.maxUpdatedAt
      && cached.tax_config_stamp === taxConfigStamp(configState)) {
      return {
        gross_cents: cached.gross_cents, orders: cached.orders, ticket_cents: cached.ticket_cents,
        markup: cached.markup, cost_covered_orders: cached.cost_covered_orders, total_orders: cached.total_orders,
        updated_at: cached.updated_at, costsAvailable: true, catalogErrorMessage: null,
      };
    }
  }
  const computed = await computeMonth(db, orgId, value, now, startOf(addMonths(value, 1)), configState);
  if (isClosed(value, now) && computed.costsAvailable && !configState.configErrored) {
    try {
      await upsertMonth(db, orgId, value, computed, taxConfigStamp(configState), now);
    } catch { /* best-effort: o valor ao vivo já está correto, só o pré-aquecimento falhou */ }
  }
  return computed;
}

/** Perf FASE 3.4: pré-aquecimento (job `materializar-metricas`, QStash diário). Materializa, para
 *  UMA organização, os últimos 6 meses fechados que estiverem ausentes ou inválidos — inclui o mês
 *  anterior real (write gate = `isClosed`, mais amplo que a leitura), para já chegar pronto quando
 *  ele deixar de ser "anterior". Sem o job o sistema continua correto (o read-through materializa
 *  na hora); ele só evita que o primeiro operador a abrir o mês pague o cálculo ao vivo. Nunca
 *  lança: falha de leitura do cache vira "materializar tudo de novo", falha de materialização de UM
 *  mês vira "pular esse mês e seguir os outros". */
export async function materializeRecentMonths(
  db: MetricsDb, orgId: string, now: Date,
): Promise<{ materialized: string[]; skipped: string[] }> {
  const cur = currentMonth(now);
  const months = Array.from({ length: 6 }, (_, index) => addMonths(cur, -(index + 1)));
  const configState = await loadConfigState(db, orgId);
  const stamp = taxConfigStamp(configState);

  const cachedRows = new Map<string, CachedMonthRow>();
  const validation = new Map<string, MonthValidation>();
  try {
    const cached = await readPages(() => db.from(CACHE_TABLE).select(CACHE_COLUMNS)
      .eq('org_id', orgId).in('month', months.map((value) => `${value}-01`)));
    if (!cached.error) for (const row of cached.rows) cachedRows.set(monthKey(row.month), toCachedRow(row));
    if (cachedRows.size > 0) {
      const validationResult = await db.rpc(VALIDATION_RPC, { p_org: orgId, p_since: startOf(months[months.length - 1]) });
      if (!validationResult.error && Array.isArray(validationResult.data)) {
        for (const row of validationResult.data as Record<string, unknown>[]) {
          validation.set(monthKey(row.month), {
            count: Number(row.source_count),
            maxUpdatedAt: row.source_max_updated_at == null ? null : String(row.source_max_updated_at),
          });
        }
        // RPC OK: mês sem grupo = 0 vendas, não "não sei" (mesmo raciocínio de `loadMetricsCache`).
        for (const value of months) {
          if (!validation.has(value)) validation.set(value, { count: 0, maxUpdatedAt: null });
        }
      }
    }
  } catch { /* cache ilegível: trata como tudo ausente, materializa de novo — nunca falha o job */ }

  const materialized: string[] = [];
  const skipped: string[] = [];
  await Promise.all(months.map(async (value) => {
    const cached = cachedRows.get(value);
    const check = validation.get(value);
    const valid = !!cached && !!check && cached.source_count === check.count
      && cached.source_max_updated_at === check.maxUpdatedAt && cached.tax_config_stamp === stamp;
    if (valid) return;
    try {
      const computed = await computeMonth(db, orgId, value, now, startOf(addMonths(value, 1)), configState);
      if (computed.costsAvailable && !configState.configErrored) {
        await upsertMonth(db, orgId, value, computed, stamp, now);
        materialized.push(value);
      } else {
        skipped.push(value);
      }
    } catch {
      skipped.push(value);
    }
  }));
  return { materialized, skipped };
}

export async function readOrgMetrics(
  db: MetricsDb, orgId: string, month: string, now: Date, cache?: MetricsCache,
): Promise<OrgMetrics> {
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('month inválido');
  if (!orgId) throw new Error('org_id inválido');

  const seriesMonths = Array.from({ length: 6 }, (_, index) => addMonths(month, index - 5));
  const isCurrent = month === currentMonth(now);
  const previousMonth = addMonths(month, -1);
  const selectedEnd = isCurrent ? now.toISOString() : startOf(addMonths(month, 1));

  const [configState, effectiveCache] = await Promise.all([
    loadConfigState(db, orgId),
    cache ?? loadMetricsCache(db, [orgId], month, now),
  ]);

  let selected: ResolvedMonth;
  let previous: ResolvedMonth;
  // Mapa dos 6 meses da série já resolvidos (evita recomputar `month`/`previousMonth`).
  const seriesByMonth = new Map<string, ResolvedMonth>();

  if (isCurrent) {
    // Perf FASE 3.3: mês corrente e mês anterior real são SEMPRE ao vivo — nunca lidos do cache,
    // mesmo que uma linha exista e valide (a leitura simplesmente não tenta: `isCacheEligible`
    // exclui os dois). `previousMonth` é buscado UMA vez (mês cheio) e fatiado de duas formas: para
    // `.previous` (parcial, mesmo tempo decorrido do mês corrente) e para a última posição "cheia"
    // da série — herda a estrutura do código anterior à FASE 3, só com a janela de busca reduzida a
    // estes 2 meses (os outros 4 resolvem por `resolveMonth`, abaixo).
    const salesResult = await readSalesByMonth(db, orgId, [previousMonth, month]);
    if (salesResult.error) throw new Error(salesResult.error.message);
    const sales = normalizeSales(salesResult.rows, orgId);
    const catalogResult = await db.rpc('platform_org_cost_catalog', { p_org: orgId, p_since: startOf(previousMonth) });
    const catalogRows = Array.isArray(catalogResult.data) ? catalogResult.data as Record<string, unknown>[] : null;
    const costsAvailable = !catalogResult.error && catalogRows != null;
    const maps = catalogRows == null || catalogResult.error ? undefined : montarMapasCusto(
      catalogRows.filter((row) => sameOrg(row, orgId))
        .map((row) => ({ ...row, familias: { ml_item_id: row.ml_item_id, origem: row.origem } })),
    );
    const catalogErrorMessage = catalogResult.error?.message ?? (catalogRows == null ? 'catálogo em formato inesperado' : null);

    const toResolved = (rows: Venda[]): ResolvedMonth => {
      const summary = summarize(rows, maps, configState.rates, now, costsAvailable, configState.configAvailable);
      const updated = rows.map((sale) => sale.atualizado_em).filter(Boolean).sort().at(-1) ?? null;
      return {
        gross_cents: cents(summary.bruto), orders: summary.pedidos, ticket_cents: cents(summary.ticket),
        markup: summary.markup, cost_covered_orders: summary.vendasComCusto, total_orders: summary.totalVendas,
        updated_at: updated, costsAvailable, catalogErrorMessage,
      };
    };

    selected = toResolved(rangeSales(sales, startOf(month), selectedEnd));
    const elapsed = Date.parse(selectedEnd) - Date.parse(startOf(month));
    const previousFullEnd = Date.parse(startOf(month));
    const previousEndMs = Math.min(Date.parse(startOf(previousMonth)) + elapsed, previousFullEnd);
    previous = toResolved(rangeSales(sales, startOf(previousMonth), new Date(previousEndMs).toISOString()));
    seriesByMonth.set(month, selected);
    seriesByMonth.set(previousMonth, toResolved(rangeSales(sales, startOf(previousMonth), startOf(month))));
  } else {
    // Mês exibido é um mês fechado normal: `month` e `previousMonth` passam pelo mesmo resolvedor
    // de cache/materialização que qualquer outro ponto da série (nenhum dos dois precisa de
    // fatiamento parcial fora do caso "mês corrente" acima).
    [selected, previous] = await Promise.all([
      resolveMonth(db, orgId, month, now, effectiveCache, configState),
      resolveMonth(db, orgId, previousMonth, now, effectiveCache, configState),
    ]);
    seriesByMonth.set(month, selected);
    seriesByMonth.set(previousMonth, previous);
  }

  const seriesResolved = await Promise.all(seriesMonths.map((value) =>
    seriesByMonth.get(value) ?? resolveMonth(db, orgId, value, now, effectiveCache, configState)));

  // Falha de leitura (não sabemos o custo/alíquota real) é `error`; ausência esperada e acionável
  // (organização sem confirmar a alíquota) é `warning` — a UI não pode misturar as duas na mesma
  // cor. Derivadas do mês EXIBIDO (`selected`): um cache hit não tentou ler catálogo nesta chamada,
  // logo não há o que reportar como falha — `warnings` continua sendo do leitor, nunca da tabela.
  const warnings: MetricsWarning[] = [];
  if (!selected.costsAvailable) {
    warnings.push({
      code: 'cost_catalog_read_failed', severity: 'error',
      message: `Falha ao carregar os custos: ${selected.catalogErrorMessage ?? 'catálogo em formato inesperado'}`,
    });
  }
  if (configState.configErrored) {
    warnings.push({
      code: 'tax_config_read_failed', severity: 'error',
      message: `Falha ao carregar a configuração tributária: ${configState.errorMessage}`,
    });
  } else if (!configState.configAvailable) {
    warnings.push({ code: 'tax_config_unconfirmed', severity: 'warning', message: 'Configuração tributária não confirmada' });
  }

  return {
    org_id: orgId, month, gross_cents: selected.gross_cents, orders: selected.orders,
    ticket_cents: selected.ticket_cents, markup: selected.markup,
    cost_covered_orders: selected.cost_covered_orders, total_orders: selected.total_orders,
    active_ads: null, publications: null, pending_operations: null, updated_at: selected.updated_at,
    previous: { gross_cents: previous.gross_cents, orders: previous.orders, markup: previous.markup },
    series: seriesMonths.map((value, index) => ({ month: value, gross_cents: seriesResolved[index].gross_cents, markup: seriesResolved[index].markup })),
    warnings,
  };
}
