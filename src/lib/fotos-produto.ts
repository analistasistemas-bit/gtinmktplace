// Foto (storage path) do produto por chave, lida client-side de `variacoes` (RLS own), para o
// thumbnail da visão por pedido do Faturamento (ADR-0039). Espelha a cadeia de resolução do custo
// (variação → anúncio → GTIN) sem tocar em custos.ts, pra não arriscar o markup/rateio de frete.
import { supabase } from './supabase';
import { normGtin } from './gtin';
import type { VendaItem } from './faturamento';

/** Resolve o storage path da foto de um item de venda. null = sem foto cadastrada. */
export type FotoResolver = (item: VendaItem) => string | null;

export interface MapasFoto {
  /** ml_variation_id → imagem_path. */
  porVariacao: Map<string, string>;
  /** ml_item_id (anúncio) → imagem_path. */
  porItem: Map<string, string>;
  /** GTIN normalizado → imagem_path. */
  porGtin: Map<string, string>;
}

/** Lê o imagem_path das variações do usuário (RLS) e monta os mapas de resolução. */
export async function buscarFotos(): Promise<MapasFoto> {
  const { data, error } = await supabase
    .from('variacoes')
    .select('imagem_path, ml_variation_id, gtin, familias!inner(ml_item_id)')
    .not('imagem_path', 'is', null);
  if (error) throw new Error(error.message);

  const porVariacao = new Map<string, string>();
  const porItem = new Map<string, string>();
  const porGtin = new Map<string, string>();

  for (const v of (data ?? []) as Array<Record<string, unknown>>) {
    const path = v.imagem_path as string | null;
    if (!path) continue;
    const varId = v.ml_variation_id as string | null;
    const gtin = v.gtin as string | null;
    const fams = v.familias as { ml_item_id: string | null } | { ml_item_id: string | null }[] | null;
    const itemId = (Array.isArray(fams) ? fams[0]?.ml_item_id : fams?.ml_item_id) ?? null;
    if (varId != null && !porVariacao.has(String(varId))) porVariacao.set(String(varId), path);
    if (itemId != null && !porItem.has(String(itemId))) porItem.set(String(itemId), path);
    if (gtin && !porGtin.has(normGtin(gtin))) porGtin.set(normGtin(gtin), path);
  }
  return { porVariacao, porItem, porGtin };
}

/** Resolver de foto (storage path) p/ o agregador. null = sem foto cadastrada. */
export function montarFotoResolver(m: MapasFoto | undefined): FotoResolver {
  return (item) => {
    if (!m) return null;
    if (item.variation_id != null) {
      const x = m.porVariacao.get(String(item.variation_id));
      if (x != null) return x;
    }
    if (item.ml_item_id) {
      const x = m.porItem.get(item.ml_item_id);
      if (x != null) return x;
    }
    if (item.ean) {
      const x = m.porGtin.get(normGtin(item.ean));
      if (x != null) return x;
    }
    return null;
  };
}
