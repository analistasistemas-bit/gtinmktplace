import { supabase } from './supabase';
import { buscarTodasPaginas } from './paginacao-supabase';
import { montarMapasCusto, type AliquotasComVigencia, type MapasCusto } from '../../supabase/functions/_shared/platform-admin/sales-costs';

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

/** Alíquotas para calcular imposto de VENDA (ADR-0208). Com `isError` → null: o resolver não devolve
 *  imposto algum. O `data` antigo que o React Query guarda num refetch com erro NÃO vale, e 8/16 também
 *  não — qualquer um reaplicaria uma alíquota possivelmente errada às vendas antigas. O 8/16 só cobre o
 *  loading inicial (sem dado, sem erro). Precificação não usa isto: segue na alíquota atual. */
export function aliquotasDeVenda(q: { data?: AliquotasComVigencia; isError: boolean }): AliquotasComVigencia | null {
  if (q.isError) return null;
  return q.data ?? { nacional: 8, importado: 16 };
}
