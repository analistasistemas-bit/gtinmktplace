import { supabase } from './supabase';

/** Ids das vendas do dossiê do SKU (packs/envios inteiros) — RPC `vendas_sku_dossie_ids`
 *  (Fatia 2a). Valor único (uuid[]) por POST: sem paginação, sem teto de 1.000 linhas. */
export async function buscarIdsDossie(codigos: string[]): Promise<string[]> {
  const { data, error } = await supabase.rpc('vendas_sku_dossie_ids', { p_codigos: codigos });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** MLB → códigos vinculados (exato/compartilhado) — RPC `vendas_sku_mlbs` (Fatia 2a). O objeto
 *  JSON `{ mlb: [codigo, ...] }` vira Map<mlb, codigos>. */
export async function buscarMlbsDossie(codigos: string[]): Promise<Map<string, string[]>> {
  const { data, error } = await supabase.rpc('vendas_sku_mlbs', { p_codigos: codigos });
  if (error) throw new Error(error.message);
  return new Map(Object.entries((data ?? {}) as Record<string, string[]>));
}
