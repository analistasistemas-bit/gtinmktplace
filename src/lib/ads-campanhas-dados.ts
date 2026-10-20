import { supabase } from '@/lib/supabase';
import { erroDaEdge } from '@/lib/edge-erro';
import type { RespostaCampanhas } from '@/lib/ads-campanhas';

/** Lê campanhas/anúncios patrocinados pela edge `ads-campanhas`. `fresco` ignora o cache da edge. */
export async function buscarCampanhasAds(fresco: boolean): Promise<RespostaCampanhas> {
  const { data, error } = await supabase.functions.invoke('ads-campanhas', { body: { fresco } });
  if (error) throw await erroDaEdge(error);
  const r = data as { ok?: boolean; error?: string } | null;
  if (!r || r.ok !== true) throw new Error(r?.error ?? 'Não foi possível ler as campanhas do Ads.');
  return data as RespostaCampanhas;
}
