// Backfill de seller_id por item_id via pulse_ofertas_atual (ADR-0142).

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

type LinhaOferta = { item_id: string; seller_id: number };

export async function resolverSellerIdsPorItem(
  db: SupabaseClient,
  orgId: string,
  itemIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (itemIds.length === 0) return out;

  const unicos = [...new Set(itemIds)];
  const { data, error } = await db.from('pulse_ofertas_atual')
    .select('item_id, seller_id')
    .eq('org_id', orgId)
    .in('item_id', unicos);

  if (error || !data) return out;

  for (const row of data as LinhaOferta[]) {
    if (typeof row.item_id === 'string' && typeof row.seller_id === 'number' && Number.isFinite(row.seller_id)) {
      out.set(row.item_id, row.seller_id);
    }
  }
  return out;
}
