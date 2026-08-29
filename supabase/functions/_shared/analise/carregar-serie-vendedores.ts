// Carrega série histórica de pulse_vendedores para estimativa mensal (ADR-0142). Só I/O.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { SnapshotVendedor } from '../pulse/vendas-mensais-vendedor.ts';

export type { SnapshotVendedor };

const PAGE_SIZE = 1000;

type LinhaPulseVendedor = {
  seller_id: number;
  transactions_total: number;
  dia: string;
};

export async function carregarSeriePulseVendedores(
  db: SupabaseClient,
  orgId: string,
  sellerIds: number[],
): Promise<SnapshotVendedor[]> {
  if (sellerIds.length === 0) return [];

  const unicos = [...new Set(sellerIds)];
  const out: SnapshotVendedor[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await db.from('pulse_vendedores')
      .select('seller_id, transactions_total, dia')
      .eq('org_id', orgId)
      .in('seller_id', unicos)
      .not('transactions_total', 'is', null)
      .order('seller_id', { ascending: true })
      .order('dia', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    const linhas = (data ?? []) as LinhaPulseVendedor[];
    if (linhas.length === 0) break;

    for (const row of linhas) {
      out.push({
        seller_id: String(row.seller_id),
        transactions_total: row.transactions_total,
        dia: row.dia,
      });
    }
    if (linhas.length < PAGE_SIZE) break;
  }

  return out;
}
