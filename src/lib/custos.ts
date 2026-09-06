import { supabase } from './supabase';
import { buscarTodasPaginas } from './paginacao-supabase';
import { montarMapasCusto, type MapasCusto } from '../../supabase/functions/_shared/platform-admin/sales-costs';

export * from '../../supabase/functions/_shared/platform-admin/sales-costs';

/** Lê custo + peso cadastrados das variações do usuário (RLS) e monta os mapas de resolução. */
export async function buscarCustos(): Promise<MapasCusto> {
  const rows = await buscarTodasPaginas<Record<string, unknown>>((de, ate) =>
    supabase
      .from('variacoes')
      .select('custo, peso_gramas, ml_variation_id, gtin, codigo, atualizado_em, familias!inner(ml_item_id, origem)')
      .not('custo', 'is', null)
      .range(de, ate) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>,
  );
  return montarMapasCusto(rows);
}
