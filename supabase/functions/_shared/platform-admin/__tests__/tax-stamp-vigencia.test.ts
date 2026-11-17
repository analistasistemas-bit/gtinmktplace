// ADR-0208 Task 4: a Central e o relatório mensal leem `aliquotas_vigencia` e assinam a lista no
// `tax_config_stamp`. Falha ao ler vigências NUNCA cai na alíquota atual (reaplicaria a nova às
// vendas antigas): `configErrored`, `rates = null`, mês fechado não é materializado.
import { describe, expect, it, vi } from 'vitest';
import {
  carregarContexto, ContextoIndisponivel, loadConfigState, materializeMonth, readMonthSeries, taxConfigStamp,
  type MetricsDb,
} from '../metrics-repository.ts';

type Row = Record<string, unknown>;
type Tables = Record<string, { rows?: Row[]; error?: string }>;

/** Fake mínimo: tabelas com `rows`/`error`; registra `order` e a coluna lida de `aliquotas_vigencia`. */
function dbFor(tables: Tables) {
  const calls: Array<{ table: string; op: string; value?: unknown }> = [];
  const db: MetricsDb = {
    rpc(name) {
      const source = tables[name] ?? {};
      if (source.error) return Promise.resolve({ data: null, error: { message: source.error } });
      return Promise.resolve({ data: source.rows ?? [], error: null });
    },
    from(table) {
      const filters: Array<(row: Row) => boolean> = [];
      let head = false;
      const query = {
        select(columns: string, options?: { head?: boolean }) {
          calls.push({ table, op: 'select', value: columns });
          head = !!options?.head;
          return query;
        },
        // `select('id', { count, head })` aguardado direto: contagem antes de paginar (readMonthSeries)
        then(resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
          const source = tables[table] ?? {};
          if (!head) return Promise.reject(new Error('fake: await sem head')).then(resolve, reject);
          return Promise.resolve(source.error ? { count: null, error: { message: source.error } }
            : { count: (source.rows ?? []).filter((row) => filters.every((f) => f(row))).length, error: null }).then(resolve, reject);
        },
        eq(column: string, value: unknown) { filters.push((row) => row[column] === value); return query; },
        in(column: string, values: unknown[]) { filters.push((row) => values.includes(row[column])); return query; },
        gte(column: string, value: unknown) { filters.push((row) => String(row[column] ?? '') >= String(value)); return query; },
        lt(column: string, value: unknown) { filters.push((row) => String(row[column] ?? '') < String(value)); return query; },
        order(column: string, options: { ascending: boolean }) {
          calls.push({ table, op: 'order', value: [column, options.ascending] });
          return query;
        },
        async range(from: number, to: number) {
          const source = tables[table] ?? {};
          if (source.error) return { data: null, error: { message: source.error } };
          return { data: (source.rows ?? []).filter((row) => filters.every((f) => f(row))).slice(from, to + 1), error: null };
        },
        async upsert(row: Row) { calls.push({ table, op: 'upsert', value: row }); return { error: null }; },
      };
      return query as unknown as ReturnType<MetricsDb['from']>;
    },
  };
  return { db, calls };
}

const config: Row[] = [{ org_id: 'org-a', aliquota_nacional_pct: 6.5, aliquota_importado_pct: 0,
  uf_empresa: 'PE', aliquota_interna_pct: 6.5, aliquotas_confirmadas_em: '2026-11-17T12:40:00Z' }];
const vig = (desde: string, pct: number, id: string): Row => ({
  id, org_id: 'org-a', vigente_desde: desde, nacional_pct: pct, importado_pct: 0, uf_empresa: 'PE', interna_pct: pct,
});
const antiga = vig('1970-01-01T00:00:00+00:00', 4, 'v-1');
const nova = vig('2026-11-17T12:40:00+00:00', 6.5, 'v-2');

const catalog: Row[] = [{ id: 'c1', org_id: 'org-a', custo: 60, peso_gramas: 100, ml_variation_id: '1',
  gtin: 'EAN', codigo: 'SKU', atualizado_em: '2026-01-01', ml_item_id: 'MLB1', origem: 'nacional' }];
const venda = (): Row => ({
  id: 'sale-1', org_id: 'org-a', order_id: 1, pack_id: null, status: 'paid', date_closed: '2026-10-10T12:00:00-03:00',
  date_created: '2026-10-10T12:00:00-03:00', uf: 'PE', total_amount: 100, liquido: 80, sale_fee_total: 20,
  frete_vendedor: null, estorno: null, atualizado_em: '2026-10-10T12:00:00-03:00', shipping_id: null,
  itens: [{ id: 'i', ml_item_id: 'MLB1', variation_id: 1, codigo: 'SKU', ean: null, quantity: 1, unit_price: 100,
    sale_fee: 0, venda_id: 'sale-1', org_id: 'org-a' }],
  custos: [{ org_id: 'org-a', venda_id: 'sale-1', ml_item_id: 'MLB1', variation_id: 1, custo_unitario: 50 }],
});
const base = (patch: Tables = {}): Tables => ({
  platform_org_cost_catalog: { rows: catalog }, configuracoes: { rows: config },
  aliquotas_vigencia: { rows: [antiga] }, ml_vendas: { rows: [venda()] }, ...patch,
});
const NOW = new Date('2026-11-20T12:00:00-03:00');

describe('taxConfigStamp assina as vigências', () => {
  it('(a) muda quando entra uma vigência nova', async () => {
    const um = await loadConfigState(dbFor(base()).db, 'org-a');
    const dois = await loadConfigState(dbFor(base({ aliquotas_vigencia: { rows: [antiga, nova] } })).db, 'org-a');
    expect(taxConfigStamp(um)).not.toBe(taxConfigStamp(dois));
    expect(taxConfigStamp(dois)).toContain('"2026-11-17T12:40:00+00:00"');
  });

  it('inclui as alíquotas atuais e a lista de vigências, nesta ordem de campos', async () => {
    const dois = await loadConfigState(dbFor(base({ aliquotas_vigencia: { rows: [antiga, nova] } })).db, 'org-a');
    expect(taxConfigStamp(dois)).toBe(JSON.stringify([
      6.5, 0, 'PE', 6.5,
      [['1970-01-01T00:00:00+00:00', 4, 0, 'PE', 4], ['2026-11-17T12:40:00+00:00', 6.5, 0, 'PE', 6.5]],
    ]));
  });

  it('lê só as vigências da org, ordenadas por vigente_desde e id (a ordem das linhas não muda o carimbo)', async () => {
    const { db, calls } = dbFor(base({ aliquotas_vigencia: { rows: [antiga, nova, vig('2030-01-01T00:00:00+00:00', 9, 'v-0')] } }));
    const estado = await loadConfigState(db, 'org-a');
    const orders = calls.filter((c) => c.table === 'aliquotas_vigencia' && c.op === 'order').map((c) => c.value);
    expect(orders).toEqual([['vigente_desde', true], ['id', true]]);
    expect(estado.rates?.vigencias).toHaveLength(3);
    expect(estado.rates?.vigencias[0]).toEqual({
      vigenteDesde: '1970-01-01T00:00:00+00:00', nacional: 4, importado: 0, ufEmpresa: 'PE', internaPct: 4,
    });
  });
});

describe('(b) mês fechado não muda com a vigência nova', () => {
  it('imposto de out/2026 é igual com [1970: 4%] e com [1970: 4%, 2026-11-17: 6,5%]', async () => {
    const so4 = await readMonthSeries(dbFor(base()).db, 'org-a', '2026-10', NOW, 1);
    const com65 = await readMonthSeries(dbFor(base({ aliquotas_vigencia: { rows: [antiga, nova] } })).db, 'org-a', '2026-10', NOW, 1);
    expect(so4[0].componentes?.tax_cents).toBe(400); // 4% de R$ 100, não 6,5%
    expect(com65[0].componentes?.tax_cents).toBe(400);
    expect(com65[0].componentes?.profit_cents).toBe(so4[0].componentes?.profit_cents);
  });
});

describe('(c) falha ao ler aliquotas_vigencia nunca cai na alíquota atual', () => {
  const falha = base({ aliquotas_vigencia: { error: 'vig boom' } });

  it('configErrored, rates null, mensagem da falha e log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const estado = await loadConfigState(dbFor(falha).db, 'org-a');
    expect(estado.configErrored).toBe(true);
    expect(estado.configAvailable).toBe(false);
    expect(estado.rates).toBeNull();
    expect(estado.errorMessage).toContain('vig boom');
    expect(taxConfigStamp(estado)).toBe('unconfirmed');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('config e vigências com erro: as duas mensagens chegam ao errorMessage', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const estado = await loadConfigState(dbFor(base({
      configuracoes: { error: 'cfg boom' }, aliquotas_vigencia: { error: 'vig boom' },
    })).db, 'org-a');
    expect(estado.errorMessage).toContain('cfg boom');
    expect(estado.errorMessage).toContain('vig boom');
    log.mockRestore();
  });

  it('mês fechado não é materializado e o gerencial (carregarContexto) recusa seguir sem imposto', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db, calls } = dbFor(falha);
    const mes = await materializeMonth(db, 'org-a', '2026-06', NOW);
    expect(mes.config_ok).toBe(false);
    await readMonthSeries(db, 'org-a', '2026-10', NOW, 6);
    expect(calls.some((c) => c.op === 'upsert')).toBe(false);
    await expect(carregarContexto(db, 'org-a', '2026-10-01T00:00:00-03:00')).rejects.toBeInstanceOf(ContextoIndisponivel);
    log.mockRestore();
  });
});
