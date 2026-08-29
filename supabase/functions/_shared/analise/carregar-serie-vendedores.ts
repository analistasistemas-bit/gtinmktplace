// Carrega a série de transactions_total por vendedor (ADR-0142 → ADR-0144). Só I/O.
//
// A leitura NÃO é mais um select org-scoped em pulse_vendedores: passa pela RPC
// `mercado_serie_vendedores`, que agrega a série entre organizações e devolve sem `org_id`
// (ADR-0144 D-1/D-2). Motivo medido: no modo EAN, 6 dos 9 vendedores do catálogo já estavam no
// banco — todos sob outra org — e o filtro por org_id fazia a consulta ler zero.
//
// A tabela continua org-scoped com RLS; quem atravessa é só esta função, e só para service_role.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { SnapshotVendedor } from '../pulse/vendas-mensais-vendedor.ts';

export type { SnapshotVendedor };

const PAGE_SIZE = 1000;

type LinhaSerie = {
  seller_id: number;
  transactions_total: number;
  dia: string;
};

export async function carregarSeriePulseVendedores(
  db: SupabaseClient,
  sellerIds: number[],
): Promise<SnapshotVendedor[]> {
  if (sellerIds.length === 0) return [];

  const unicos = [...new Set(sellerIds)];
  const out: SnapshotVendedor[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await db
      .rpc('mercado_serie_vendedores', { p_seller_ids: unicos })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    const linhas = (data ?? []) as LinhaSerie[];
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
