import { supabase } from '@/lib/supabase';

/** Permalink do anúncio já na variação da cor (`?variation=`). Sem id válido, devolve o link do anúncio. */
export function linkMlDaCor(permalink: string, mlItemId: string, variacaoId: string | null | undefined): string {
  // `ml_variation_id = ml_item_id` é a sentinela de item sem variação (ADR-0084): nunca vira variation.
  if (!variacaoId || variacaoId === mlItemId || !/^\d+$/.test(variacaoId)) return permalink;
  const u = new URL(permalink);
  u.searchParams.set('variation', variacaoId);
  return u.toString();
}

/** `ml_variation_id` da cor na família (RLS). null em User Products, cor sem variação ou erro. */
export async function variacaoIdDaCor(familiaId: string, cor: string): Promise<string | null> {
  const { data } = await supabase.from('variacoes').select('ml_variation_id').eq('familia_id', familiaId).eq('cor', cor)
    .not('ml_variation_id', 'is', null).limit(1);
  const v = (data as { ml_variation_id: string | null }[] | null)?.[0]?.ml_variation_id;
  return v ?? null;
}
