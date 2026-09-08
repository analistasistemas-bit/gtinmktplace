import { describe, expect, it } from 'vitest';
import { readOrgMetrics } from '../metrics-repository.ts';

type Row = Record<string, unknown>;
type TableData = Record<string, { rows?: Row[]; error?: string }>;

/** Fake db. `platform_org_cost_catalog` entra em `tables` como se fosse uma tabela: a RPC devolve
 *  `rows` (array jsonb) ou `error`. */
function dbFor(tables: TableData) {
  const calls: Array<{ table: string; op: string; column?: string; value?: unknown }> = [];
  return {
    calls,
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ table: name, op: 'rpc', value: args });
      const source = tables[name] ?? {};
      if (source.error) return Promise.resolve({ data: null, error: { message: source.error } });
      return Promise.resolve({ data: source.rows ?? [], error: null });
    },
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const query = {
        select(columns: string) {
          calls.push({ table, op: 'select', value: columns });
          return query;
        },
        eq(column: string, value: unknown) {
          calls.push({ table, op: 'eq', column, value });
          filters.push((row) => row[column] === value);
          return query;
        },
        gte(column: string, value: unknown) {
          calls.push({ table, op: 'gte', column, value });
          filters.push((row) => String(row[column] ?? '') >= String(value));
          return query;
        },
        lt(column: string, value: unknown) {
          calls.push({ table, op: 'lt', column, value });
          filters.push((row) => String(row[column] ?? '') < String(value));
          return query;
        },
        order: () => query,
        async range(from: number, to: number) {
          calls.push({ table, op: 'range', value: [from, to] });
          const source = tables[table] ?? {};
          if (source.error) return { data: null, error: { message: source.error } };
          return { data: (source.rows ?? []).filter((row) => filters.every((filter) => filter(row))).slice(from, to + 1), error: null };
        },
      };
      return query;
    },
  };
}

function item(patch: Row = {}): Row {
  return { id: 'item', ml_item_id: 'MLB1', variation_id: 1, titulo: null, codigo: 'SKU', cor: null,
    ean: null, quantity: 1, unit_price: 100, sale_fee: 0, is_publiai: true, ...patch };
}

function sale(id: string, date: string, orgId = 'org-a', patch: Row = {}): Row {
  return { id, org_id: orgId, order_id: Number(id.replace(/\D/g, '')) || 1, pack_id: null, status: 'paid',
    status_detail: null, date_closed: date, date_created: date, comprador_nick: null, comprador_nome: null,
    comprador_id: null, uf: 'CE', cidade: null, total_amount: 100, paid_amount: 100, liquido: 80,
    sale_fee_total: 20, frete_vendedor: null, estorno: null, money_release_date: null, sacado_em: null,
    sacado_por: null, atualizado_em: date, currency: 'BRL', shipping_id: null, shipping_status: null,
    shipping_substatus: null, shipping_logistic: null, tracking_number: null, is_publiai: true,
    tem_devolucao: false, itens: [item({ venda_id: id, org_id: orgId })],
    custos: [{ org_id: orgId, venda_id: id, ml_item_id: 'MLB1', variation_id: 1, custo_unitario: 50 }], ...patch };
}

/** Linhas como a RPC `platform_org_cost_catalog` devolve: planas, com ml_item_id/origem da família. */
const catalog: Row[] = [{ id: 'v1', org_id: 'org-a', custo: 60, peso_gramas: 100, ml_variation_id: '1',
  gtin: 'EAN', codigo: 'SKU', atualizado_em: '2026-01-01', ml_item_id: 'MLB1', origem: 'nacional' }];
const config: Row[] = [{ org_id: 'org-a', aliquota_nacional_pct: 8, aliquota_importado_pct: 16,
  uf_empresa: 'CE', aliquota_interna_pct: 8, aliquotas_confirmadas_em: '2026-07-21T18:16:19Z' }];

const base = (patch: TableData = {}): TableData => ({
  platform_org_cost_catalog: { rows: catalog }, configuracoes: { rows: config }, ...patch,
});

describe('readOrgMetrics', () => {
  it('pagina mais de mil vendas e aplica org_id a todas as tabelas', async () => {
    const rows = Array.from({ length: 1001 }, (_, n) => sale(`sale-${n + 1}`, '2026-10-02T12:00:00-03:00'));
    const db = dbFor(base({ ml_vendas: { rows } }));
    const metrics = await readOrgMetrics(db, 'org-a', '2026-10', new Date('2026-10-31T00:00:00Z'));
    expect(metrics.gross_cents).toBe(10_010_000);
    expect(db.calls.filter((call) => call.op === 'eq')).toEqual(expect.arrayContaining([
      { table: 'ml_vendas', op: 'eq', column: 'org_id', value: 'org-a' },
      { table: 'configuracoes', op: 'eq', column: 'org_id', value: 'org-a' },
    ]));
    // Perf FASE 2.2: uma leitura por mês-calendário (6), em paralelo — outubro (as 1001 vendas)
    // pagina uma segunda vez, os outros cinco meses (vazios) fazem 1 `range` cada = 7 no total.
    const ranges = db.calls.filter((call) => call.table === 'ml_vendas' && call.op === 'range');
    expect(ranges).toHaveLength(7);
    // Seis meses-calendário distintos, não uma janela única — um bare count de 7 passaria também
    // com uma partição errada (ex.: 7 páginas da janela inteira, sem virar leitura por mês).
    const gtes = db.calls.filter((call) => call.table === 'ml_vendas' && call.op === 'gte').map((call) => call.value);
    expect(new Set(gtes).size).toBe(6);
  });

  it('lê ml_vendas por lista explícita de colunas, sem * e sem raw, mantendo org_id', async () => {
    const db = dbFor(base({ ml_vendas: { rows: [sale('sale-1', '2026-10-02T12:00:00-03:00')] } }));
    await readOrgMetrics(db, 'org-a', '2026-10', new Date('2026-10-15T12:00:00-03:00'));
    const columns = db.calls.find((call) => call.table === 'ml_vendas' && call.op === 'select')?.value as string;
    expect(columns).toBeTypeOf('string');
    expect(columns).not.toMatch(/\*/);
    expect(columns).not.toMatch(/\braw\b/);
    // `normalizeSales` filtra por `row.org_id === orgId`: sem org_id no select toda métrica zera.
    expect(columns.split(/[,(]/).map((part) => part.trim())).toContain('org_id');
    expect(columns).toContain('itens:ml_vendas_itens(');
    expect(columns).toContain('custos:venda_item_custo(');
  });

  // Perf FASE 2.1: lista definitiva do plano — nem um campo a mais (payload), nem um a menos
  // (`org_id`/`custos` zerariam a carteira ou o custo congelado; ver comentário de `SALES_COLUMNS`).
  it('projeta exatamente a lista mínima de colunas de ml_vendas', async () => {
    const db = dbFor(base({ ml_vendas: { rows: [sale('sale-1', '2026-10-02T12:00:00-03:00')] } }));
    await readOrgMetrics(db, 'org-a', '2026-10', new Date('2026-10-15T12:00:00-03:00'));
    const columns = db.calls.find((call) => call.table === 'ml_vendas' && call.op === 'select')?.value as string;
    expect(columns).toBe(
      'id, org_id, order_id, pack_id, status, date_closed, date_created, uf, total_amount, '
      + 'sale_fee_total, frete_vendedor, liquido, estorno, atualizado_em, shipping_id, '
      + 'itens:ml_vendas_itens(ml_item_id, variation_id, codigo, ean, quantity, unit_price), '
      + 'custos:venda_item_custo(ml_item_id, variation_id, custo_unitario)',
    );
  });

  it('lê o catálogo de custo pela RPC, com p_since no primeiro mês da série', async () => {
    const db = dbFor(base({ ml_vendas: { rows: [sale('sale-1', '2026-10-02T12:00:00-03:00')] } }));
    await readOrgMetrics(db, 'org-a', '2026-10', new Date('2026-10-15T12:00:00-03:00'));
    expect(db.calls.filter((call) => call.op === 'rpc')).toEqual([
      { table: 'platform_org_cost_catalog', op: 'rpc', value: { p_org: 'org-a', p_since: '2026-05-01T00:00:00-03:00' } },
    ]);
    expect(db.calls.some((call) => call.table === 'variacoes')).toBe(false);
  });

  it('isola organização e descarta filhos incompatíveis', async () => {
    const own = sale('sale-1', '2026-10-02T12:00:00-03:00', 'org-a', {
      itens: [item({ venda_id: 'sale-1', org_id: 'org-b' })],
      custos: [{ org_id: 'org-b', venda_id: 'sale-1', ml_item_id: 'MLB1', variation_id: 1, custo_unitario: 1 }],
    });
    const db = dbFor(base({
      ml_vendas: { rows: [own, sale('sale-2', '2026-10-02T12:00:00-03:00', 'org-b')] },
      platform_org_cost_catalog: { rows: [...catalog, { ...catalog[0], id: 'v2', org_id: 'org-b' }] },
    }));
    const metrics = await readOrgMetrics(db, 'org-a', '2026-10', new Date('2026-10-15T12:00:00-03:00'));
    expect(metrics.gross_cents).toBe(10_000);
    expect(metrics.markup).toBeNull();
  });

  it('calcula seis meses e período anterior equivalente em mês corrente', async () => {
    const rows = [sale('sale-1', '2026-02-10T12:00:00-03:00'), sale('sale-2', '2026-03-10T12:00:00-03:00'),
      sale('sale-3', '2026-03-25T12:00:00-03:00')];
    const db = dbFor(base({ ml_vendas: { rows } }));
    const metrics = await readOrgMetrics(db, 'org-a', '2026-03', new Date('2026-03-15T12:00:00-03:00'));
    expect(metrics.series).toHaveLength(6);
    expect(metrics.series.at(-1)?.gross_cents).toBe(10_000);
    expect(metrics.previous?.gross_cents).toBe(10_000);
  });

  it('calcula markup com alíquota confirmada e não avisa nada', async () => {
    const db = dbFor(base({ ml_vendas: { rows: [sale('sale-1', '2026-10-02T12:00:00-03:00')] } }));
    const metrics = await readOrgMetrics(db, 'org-a', '2026-10', new Date('2026-10-15T12:00:00-03:00'));
    // R$ 100 bruto, R$ 80 líquido, custo R$ 50, imposto 8 % → markup 0,44 (ADR-0109).
    expect(metrics.markup).toBeCloseTo(0.44);
    expect(metrics.warnings).toEqual([]);
  });

  it('nunca presume alíquota: sem linha ou sem confirmação o markup some com aviso', async () => {
    const semLinha = { rows: [] as Row[] };
    const semConfirmacao = { rows: [{ ...config[0], aliquotas_confirmadas_em: null }] };
    for (const configuracoes of [semLinha, semConfirmacao]) {
      const db = dbFor(base({ ml_vendas: { rows: [sale('sale-1', '2026-10-02T12:00:00-03:00')] }, configuracoes }));
      const metrics = await readOrgMetrics(db, 'org-a', '2026-10', new Date('2026-10-15T12:00:00-03:00'));
      expect(metrics.markup).toBeNull();
      expect(metrics.warnings).toContainEqual({ code: 'tax_config_unconfirmed', severity: 'warning', message: 'Configuração tributária não confirmada' });
    }
  });

  it('retorna zeros sem vendas e indisponibiliza markup em falha de custo ou config', async () => {
    const empty = await readOrgMetrics(dbFor(base({ ml_vendas: {} })), 'org-a', '2026-10', new Date('2026-10-15T12:00:00-03:00'));
    expect(empty.gross_cents).toBe(0);
    expect(empty.orders).toBe(0);
    expect(empty.series).toHaveLength(6);
    expect(empty.warnings).toEqual([]);

    for (const failed of ['platform_org_cost_catalog', 'configuracoes']) {
      const db = dbFor(base({
        ml_vendas: { rows: [sale('sale-1', '2026-10-02T12:00:00-03:00')] },
        [failed]: { error: `sem ${failed}` },
      }));
      const metrics = await readOrgMetrics(db, 'org-a', '2026-10', new Date('2026-10-15T12:00:00-03:00'));
      expect(metrics.markup).toBeNull();
      // Falha de leitura é `error` (não ausência esperada) e nunca usa a palavra "indisponível"
      // (ADR-0158/central-cockpit: essa palavra some da central).
      expect(metrics.warnings.every((warning) => warning.severity === 'error')).toBe(true);
      expect(metrics.warnings.map((warning) => warning.message).join(' ')).not.toMatch(/indisponível/i);
    }
  });

  it('trata catálogo com payload não-array como falha de custo, não como catálogo vazio', async () => {
    const inner = dbFor(base({ ml_vendas: { rows: [sale('sale-1', '2026-10-02T12:00:00-03:00')] } }));
    const db = { from: inner.from, rpc: () => Promise.resolve({ data: null, error: null }) };
    const metrics = await readOrgMetrics(db, 'org-a', '2026-10', new Date('2026-10-15T12:00:00-03:00'));
    expect(metrics.markup).toBeNull();
    expect(metrics.warnings).toContainEqual(expect.objectContaining({ code: 'cost_catalog_read_failed', severity: 'error' }));
    expect(metrics.warnings.map((warning) => warning.message).join(' ')).toMatch(/Falha ao carregar os custos/);
  });
});
