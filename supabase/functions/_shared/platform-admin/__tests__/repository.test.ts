import { describe, expect, it } from 'vitest';
import { createPlatformAdminRepository } from '../repository.ts';

type Row = Record<string, unknown>;
type Tables = Record<string, { rows?: Row[]; error?: string }>;

function fakeDb(tables: Tables, previews: Record<string, Row | Error> = {}) {
  const calls: Array<{ table: string; op: string; column?: string; value?: unknown }> = [];
  return {
    calls,
    async rpc(name: string, args: Record<string, unknown>) {
      if (name !== 'platform_billing_preview') return { data: {}, error: null };
      const value = previews[String(args.p_org)];
      return value instanceof Error ? { data: null, error: { message: value.message } } : { data: value, error: null };
    },
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const orders: Array<{ column: string; ascending: boolean }> = [];
      let countRequested = false;
      let head = false;
      const execute = (from = 0, to = Number.MAX_SAFE_INTEGER) => {
        const source = tables[table] ?? {};
        if (source.error) return { data: null, error: { message: source.error }, count: null };
        let rows = (source.rows ?? []).filter((row) => filters.every((filter) => filter(row)));
        for (const order of [...orders].reverse()) rows = [...rows].sort((a, b) => {
          const left = String(a[order.column] ?? ''); const right = String(b[order.column] ?? '');
          return (left < right ? -1 : left > right ? 1 : 0) * (order.ascending ? 1 : -1);
        });
        return { data: head ? null : rows.slice(from, to + 1), error: null, count: countRequested ? rows.length : null };
      };
      const query = {
        select(_columns?: string, options?: { count?: string; head?: boolean }) { countRequested = options?.count === 'exact'; head = options?.head === true; return query; },
        eq(column: string, value: unknown) { calls.push({ table, op: 'eq', column, value }); filters.push((row) => row[column] === value); return query; },
        gte(column: string, value: unknown) { filters.push((row) => String(row[column] ?? '') >= String(value)); return query; },
        lt(column: string, value: unknown) { filters.push((row) => String(row[column] ?? '') < String(value)); return query; },
        in(column: string, values: unknown[]) { calls.push({ table, op: 'in', column, value: values }); filters.push((row) => values.includes(row[column])); return query; },
        like(column: string, pattern: string) { const prefix = pattern.endsWith('%') ? pattern.slice(0, -1) : pattern; filters.push((row) => String(row[column] ?? '').startsWith(prefix)); return query; },
        order(column: string, options?: { ascending?: boolean }) { orders.push({ column, ascending: options?.ascending !== false }); return query; },
        async range(from: number, to: number) { calls.push({ table, op: 'range', value: [from, to] }); return execute(from, to); },
        async limit(size: number) { return execute(0, size - 1); },
        async maybeSingle() { const result = execute(0, 0); return { ...result, data: Array.isArray(result.data) ? result.data[0] ?? null : null }; },
        async single() { const result = execute(0, 0); return { ...result, data: Array.isArray(result.data) ? result.data[0] ?? null : null }; },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { return Promise.resolve(execute()).then(resolve, reject); },
      };
      return query;
    },
  };
}

function sale(id: string, orgId: string, amount: number): Row {
  const date = '2026-08-05T12:00:00-03:00';
  return { id, org_id: orgId, order_id: Number(id.replace(/\D/g, '')) || 1, status: 'paid', date_closed: date,
    date_created: date, total_amount: amount, paid_amount: amount, liquido: amount, sale_fee_total: 0, atualizado_em: date,
    currency: 'BRL', is_publiai: true, tem_devolucao: false, itens: [], custos: [] };
}

const preview = (total: number, blockers: Row[] = [], terms: Row | null = { modality: 2 }): Row => ({ total_cents: total, sonar_units: 2, blockers, terms });

describe('createPlatformAdminRepository', () => {
  it('totals the whole wallet before paginating and leaves organizations without terms out of the forecast', async () => {
    const organizations = [
      { id: 'org-a', nome: 'Alpha', slug: 'alpha', is_test: false },
      { id: 'org-b', nome: 'Beta', slug: 'beta', is_test: false },
    ];
    const db = fakeDb(
      { organizations: { rows: organizations }, ml_vendas: { rows: [sale('sale-1', 'org-a', 100), sale('sale-2', 'org-b', 300)] }, variacoes: {}, configuracoes: {}, platform_sonar_searches: {} },
      { 'org-a': preview(10), 'org-b': preview(0, [{ code: 'commercial_terms_required' }], null) },
    );
    const repository = createPlatformAdminRepository(db as never, () => new Date('2026-09-06T12:00:00Z'));
    const wallet = await repository.wallet('actor', { month: '2026-08', page: 1, page_size: 1, sort: 'gross_desc' });
    expect(wallet).toMatchObject({ total: 2, page: 1, page_size: 1, rows: [{ id: 'org-b', metrics: { gross_cents: 30_000 } }] });
    // Pendência é bloqueio da prévia (ADR-0156 §2): sem contrato → 1; consumo é contável sem contrato.
    expect(wallet.rows[0]).toMatchObject({ modality: null, forecast_cents: null, billable_units: 2, pending_count: 1 });
    expect(wallet.totals).toEqual({
      gross_cents: 40_000, forecast_cents: 10, orgs_without_terms: 1, org_count: 2,
      pending_count: 1, orders: 2, warnings: [],
    });
    // A contagem de buscas Sonar em voo deixou de ser pendência. O `toContainEqual` positivo prova
    // que a forma registrada em `calls` é essa — sem ele, o negativo passaria de graça.
    expect(db.calls).toContainEqual({ table: 'platform_sonar_searches', op: 'eq', column: 'origin', value: 'daludi' });
    expect(db.calls).not.toContainEqual({ table: 'platform_sonar_searches', op: 'eq', column: 'state', value: 'pending' });
  });

  it('loads and enriches one organization by id', async () => {
    const organizations = [{ id: 'org-a', nome: 'Alpha', slug: 'alpha', is_test: false }];
    const db = fakeDb({ organizations: { rows: organizations }, ml_vendas: { rows: [sale('sale-1', 'org-a', 100)] }, variacoes: {}, configuracoes: {}, platform_sonar_searches: {} }, { 'org-a': preview(10) });
    const repository = createPlatformAdminRepository(db as never, () => new Date('2026-09-06T12:00:00Z'));
    await expect(repository.organization('actor', 'org-a', '2026-08')).resolves.toMatchObject({
      id: 'org-a',
      metrics: { gross_cents: 10_000 },
      forecast_cents: 10,
    });
    await expect(repository.organization('actor', 'missing', '2026-08')).resolves.toBeNull();
  });

  it('keeps metric and preview failures unknown and warns instead of emitting silent zeroes', async () => {
    const organizations = [{ id: 'org-a', nome: 'Alpha', slug: 'alpha', is_test: false }];
    const db = fakeDb({ organizations: { rows: organizations }, ml_vendas: { error: 'metrics unavailable' }, platform_sonar_searches: {} }, { 'org-a': new Error('preview unavailable') });
    const repository = createPlatformAdminRepository(db as never);
    const wallet = await repository.wallet('actor', { month: '2026-08', page: 1, page_size: 20, sort: 'name' });
    expect(wallet.totals).toMatchObject({
      gross_cents: null, orders: null, pending_count: null, forecast_cents: 0,
      warnings: ['Métricas indisponíveis para parte da carteira', 'Prévia indisponível para parte da carteira'],
    });

    const blocked = fakeDb({ organizations: { rows: organizations }, ml_vendas: {}, variacoes: {}, configuracoes: {}, platform_sonar_searches: {} }, { 'org-a': preview(999, [{ code: 'refund_reconciliation_required' }]) });
    const blockedWallet = await createPlatformAdminRepository(blocked as never).wallet('actor', { month: '2026-08', page: 1, page_size: 20, sort: 'name' });
    // Com contrato mas bloqueada: fica fora da previsão e conta 1 pendência.
    expect(blockedWallet.rows[0]).toMatchObject({ forecast_cents: null, pending_count: 1, modality: 2 });
    expect(blockedWallet.totals).toMatchObject({ forecast_cents: 0, orgs_without_terms: 0, pending_count: 1 });
  });

  it('maps delivery amounts by search_id and counts month-wide Daludi, failures, and reopen intents', async () => {
    const searches = [
      { id: 'search-client', org_id: 'org-a', actor_id: 'actor', created_at: '2026-08-04T12:00:00-03:00', normalized_query: 'cliente', query_type: 'termo', origin: 'cliente', state: 'completed', result_id: 'shared', intent_key: 'normal' },
      { id: 'search-daludi', org_id: 'org-a', actor_id: 'actor', created_at: '2026-08-03T12:00:00-03:00', normalized_query: 'daludi', query_type: 'ean', origin: 'daludi', state: 'completed', result_id: 'shared', intent_key: 'normal-2' },
      { id: 'search-failed', org_id: 'org-a', actor_id: 'actor', created_at: '2026-08-02T12:00:00-03:00', normalized_query: 'falha', query_type: 'termo', origin: 'cliente', state: 'failed', result_id: null, intent_key: 'normal-3' },
      { id: 'search-reopen', org_id: 'org-a', actor_id: 'actor', created_at: '2026-08-01T12:00:00-03:00', normalized_query: 'reopen', query_type: 'termo', origin: 'cliente', state: 'completed', result_id: 'other', intent_key: 'reopen:00000000-0000-0000-0000-000000000001' },
    ];
    const deliveries = [
      { id: 'delivery-client', org_id: 'org-a', search_id: 'search-client', result_id: 'other', month: '2026-08-01', units: 1, total_cents: 120, reason: 'completed' },
      { id: 'delivery-reopen', org_id: 'org-a', search_id: 'search-reopen', result_id: 'shared', month: '2026-08-01', units: 1, total_cents: 120, reason: 'completed' },
    ];
    const db = fakeDb({ platform_sonar_searches: { rows: searches }, platform_sonar_deliveries: { rows: deliveries }, platform_sonar_events: {} });
    const usage = await createPlatformAdminRepository(db as never).pulseUsage('actor', 'org-a', '2026-08', 1, 2);
    expect(usage.rows).toEqual([
      expect.objectContaining({ id: 'search-client', units: 1, total_cents: 120 }),
      expect.objectContaining({ id: 'search-daludi', exempt_reason: 'daludi', units: 0, total_cents: 0 }),
    ]);
    expect(usage).toMatchObject({ total: 4, client_units: 2, client_cents: 240, daludi_searches: 1, failures: 1, reopens: 1 });
  });

  it('resolves actor names for the page in one read and keeps them null when profiles fails', async () => {
    const searches = [
      { id: 's1', org_id: 'org-a', actor_id: 'actor-1', created_at: '2026-08-04T12:00:00-03:00', normalized_query: 'a', query_type: 'termo', origin: 'cliente', state: 'completed', result_id: null, intent_key: 'k1' },
      { id: 's2', org_id: 'org-a', actor_id: 'actor-2', created_at: '2026-08-03T12:00:00-03:00', normalized_query: 'b', query_type: 'termo', origin: 'cliente', state: 'completed', result_id: null, intent_key: 'k2' },
    ];
    const profiles = { rows: [{ id: 'actor-1', nome: 'Diego' }, { id: 'actor-2', nome: 'Ana' }, { id: 'actor-3', nome: 'Fora da pagina' }] };
    const db = fakeDb({ platform_sonar_searches: { rows: searches }, platform_sonar_deliveries: {}, profiles });
    const usage = await createPlatformAdminRepository(db as never).pulseUsage('actor', 'org-a', '2026-08', 1, 10);
    expect(usage.rows.map((row) => row.actor_name)).toEqual(['Diego', 'Ana']);
    // Uma unica leitura de profiles, so com os atores da pagina.
    expect(db.calls.filter((call) => call.table === 'profiles')).toEqual([{ table: 'profiles', op: 'in', column: 'id', value: ['actor-1', 'actor-2'] }]);

    const broken = fakeDb({ platform_sonar_searches: { rows: searches }, platform_sonar_deliveries: {}, profiles: { error: 'profiles unavailable' } });
    const degraded = await createPlatformAdminRepository(broken as never).pulseUsage('actor', 'org-a', '2026-08', 1, 10);
    expect(degraded.rows.map((row) => row.actor_name)).toEqual([null, null]);
    expect(degraded).toMatchObject({ total: 2, rows: [{ id: 's1' }, { id: 's2' }] });

    const at = '2026-08-05T12:00:00-03:00';
    const auditTables = (nomes: Tables['profiles']) => ({
      platform_audit_events: { rows: [{ id: 'c', org_id: 'org-a', actor_id: 'actor-1', occurred_at: at, category: 'billing', action: 'closed', result: 'success', target: null, reason: null, details: {} }] },
      support_audit_events: { rows: [{ id: 'a', org_id: 'org-a', actor_id: null, created_at: at, event: 'view', result: 'success', target_type: null, target_id: null, support_request_id: 's' }] },
      profiles: nomes,
    });
    const audit = await createPlatformAdminRepository(fakeDb(auditTables({ rows: [{ id: 'actor-1', nome: 'Diego' }] })) as never).audit('actor', 'org-a', '2026-08', {}, 1, 10);
    expect(audit.rows).toEqual([
      expect.objectContaining({ id: 'c', actor_name: 'Diego' }),
      expect.objectContaining({ id: 'a', actor_id: null, actor_name: null }),
    ]);
    const auditFailed = await createPlatformAdminRepository(fakeDb(auditTables({ error: 'profiles unavailable' })) as never).audit('actor', 'org-a', '2026-08', {}, 1, 10);
    expect(auditFailed).toMatchObject({ total: 2, rows: [{ id: 'c', actor_name: null }, { id: 'a', actor_name: null }] });
  });

  it('sanitizes and merges audit sources before stable filtering and pagination', async () => {
    const at = '2026-08-05T12:00:00-03:00';
    const db = fakeDb({
      platform_audit_events: { rows: [{ id: 'c', org_id: 'org-a', actor_id: 'actor', occurred_at: at, category: 'billing', action: 'closed', result: 'success', target: 'statement', reason: null, details: { safe: true }, secret: 'no' }] },
      platform_sonar_events: { rows: [{ id: 'b', org_id: 'org-a', actor_id: 'actor', occurred_at: at, stage: 'complete', outcome: 'success', reason: null, search_id: 'search', result_id: 'result', payload: { secret: true } }] },
      support_audit_events: { rows: [{ id: 'a', org_id: 'org-a', actor_id: 'actor', created_at: '2026-08-04T12:00:00-03:00', event: 'view', result: 'success', target_type: 'request', target_id: 'target', support_request_id: 'support', private_note: 'no' }] },
    });
    const repository = createPlatformAdminRepository(db as never);
    const merged = await repository.audit('actor', 'org-a', '2026-08', { result: 'success' }, 1, 2);
    expect(merged).toMatchObject({ total: 3, rows: [{ id: 'c' }, { id: 'b' }] });
    expect(JSON.stringify(merged.rows)).not.toMatch(/secret|private_note/);
    const pulse = await repository.audit('actor', 'org-a', '2026-08', { category: 'pulse', actor_id: 'actor', result: 'success' }, 1, 20);
    expect(pulse.rows).toEqual([expect.objectContaining({ id: 'b', category: 'pulse', target: 'search', details: { result_id: 'result' } })]);
  });
});
