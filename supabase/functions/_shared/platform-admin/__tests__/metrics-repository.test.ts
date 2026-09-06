import { describe, expect, it } from 'vitest';
import { readOrgMetrics } from '../metrics-repository.ts';

type Row = Record<string, unknown>;
type TableData = Record<string, { rows?: Row[]; error?: string }>;

function dbFor(tables: TableData) {
  const calls: Array<{ table: string; op: string; column?: string; value?: unknown }> = [];
  return {
    calls,
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const query = {
        select: () => query,
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

const costs: Row[] = [{ id: 'v1', org_id: 'org-a', custo: 60, peso_gramas: 100, ml_variation_id: 1,
  gtin: 'EAN', codigo: 'SKU', atualizado_em: '2026-01-01', familias: { ml_item_id: 'MLB1', origem: 'nacional', org_id: 'org-a' } }];
const config: Row[] = [{ org_id: 'org-a', aliquota_nacional_pct: 8, aliquota_importado_pct: 16, uf_empresa: 'CE', aliquota_interna_pct: 8 }];

describe('readOrgMetrics', () => {
  it('pagina mais de mil vendas e aplica org_id a todas as tabelas', async () => {
    const rows = Array.from({ length: 1001 }, (_, n) => sale(`sale-${n + 1}`, '2026-10-02T12:00:00-03:00'));
    const db = dbFor({ ml_vendas: { rows }, variacoes: { rows: costs }, configuracoes: { rows: config } });
    const metrics = await readOrgMetrics(db, 'org-a', '2026-10', new Date('2026-10-31T00:00:00Z'));
    expect(metrics.gross_cents).toBe(10_010_000);
    expect(db.calls.filter((call) => call.op === 'eq')).toEqual(expect.arrayContaining([
      { table: 'ml_vendas', op: 'eq', column: 'org_id', value: 'org-a' },
      { table: 'variacoes', op: 'eq', column: 'org_id', value: 'org-a' },
      { table: 'configuracoes', op: 'eq', column: 'org_id', value: 'org-a' },
    ]));
    expect(db.calls.filter((call) => call.table === 'ml_vendas' && call.op === 'range')).toHaveLength(2);
  });

  it('isola organização e descarta filhos incompatíveis', async () => {
    const own = sale('sale-1', '2026-10-02T12:00:00-03:00', 'org-a', {
      itens: [item({ venda_id: 'sale-1', org_id: 'org-b' })],
      custos: [{ org_id: 'org-b', venda_id: 'sale-1', ml_item_id: 'MLB1', variation_id: 1, custo_unitario: 1 }],
    });
    const db = dbFor({ ml_vendas: { rows: [own, sale('sale-2', '2026-10-02T12:00:00-03:00', 'org-b')] },
      variacoes: { rows: [...costs, { ...costs[0], id: 'v2', org_id: 'org-b' }] }, configuracoes: { rows: config } });
    const metrics = await readOrgMetrics(db, 'org-a', '2026-10', new Date('2026-10-15T12:00:00-03:00'));
    expect(metrics.gross_cents).toBe(10_000);
    expect(metrics.markup).toBeNull();
  });

  it('calcula seis meses e período anterior equivalente em mês corrente', async () => {
    const rows = [sale('sale-1', '2026-02-10T12:00:00-03:00'), sale('sale-2', '2026-03-10T12:00:00-03:00'),
      sale('sale-3', '2026-03-25T12:00:00-03:00')];
    const db = dbFor({ ml_vendas: { rows }, variacoes: { rows: costs }, configuracoes: { rows: config } });
    const metrics = await readOrgMetrics(db, 'org-a', '2026-03', new Date('2026-03-15T12:00:00-03:00'));
    expect(metrics.series).toHaveLength(6);
    expect(metrics.series.at(-1)?.gross_cents).toBe(10_000);
    expect(metrics.previous?.gross_cents).toBe(10_000);
  });

  it('retorna zeros sem vendas e indisponibiliza markup em falha de custo ou config', async () => {
    const empty = await readOrgMetrics(dbFor({ ml_vendas: {}, variacoes: { rows: costs }, configuracoes: { rows: config } }),
      'org-a', '2026-10', new Date('2026-10-15T12:00:00-03:00'));
    expect(empty.gross_cents).toBe(0);
    expect(empty.orders).toBe(0);
    expect(empty.series).toHaveLength(6);

    for (const failed of ['variacoes', 'configuracoes']) {
      const db = dbFor({ ml_vendas: { rows: [sale('sale-1', '2026-10-02T12:00:00-03:00')] },
        variacoes: failed === 'variacoes' ? { error: 'sem custos' } : { rows: costs },
        configuracoes: failed === 'configuracoes' ? { error: 'sem config' } : { rows: config } });
      const metrics = await readOrgMetrics(db, 'org-a', '2026-10', new Date('2026-10-15T12:00:00-03:00'));
      expect(metrics.markup).toBeNull();
      expect(metrics.warnings.join(' ')).toMatch(/indisponíveis|indisponível/);
    }
  });
});
