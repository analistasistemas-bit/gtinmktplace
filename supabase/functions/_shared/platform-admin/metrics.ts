import type { OrgMetrics } from './types.ts';

export function metricsFromSummary(orgId: string, month: string, summary: { bruto: number; pedidos: number; ticket: number; markup: number | null; vendasComCusto: number; totalVendas: number }): OrgMetrics {
  return {
    org_id: orgId, month, gross_cents: Math.round(summary.bruto * 100), orders: summary.pedidos,
    ticket_cents: Math.round(summary.ticket * 100), markup: summary.markup,
    cost_covered_orders: summary.vendasComCusto, total_orders: summary.totalVendas,
    active_ads: null, publications: null, pending_operations: null, updated_at: null,
    previous: null, series: [], warnings: ['Métricas operacionais indisponíveis'],
  };
}
