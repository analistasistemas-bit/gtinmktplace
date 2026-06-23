// Custo do produto (R$) por chave, lido client-side de `variacoes` (RLS own), para o markup do
// agregador (ADR-0038). Espelha o cruzamento do resumo-financeiro: variação → anúncio → GTIN.
// NÃO usar familias.custo_centavos (é custo de tokens de IA). Pura exceto pela query inicial.
import { supabase } from './supabase';
import type { CustoResolver } from './resumo-vendas';
import type { VendaItem } from './faturamento';

/** GTIN normalizado (sem zeros à esquerda) para casar entre ML e planilha. */
const normGtin = (g: string) => g.replace(/^0+/, '');

export interface MapasCusto {
  /** ml_variation_id → custo unitário (R$). */
  porVariacao: Map<string, number>;
  /** ml_item_id (anúncio) → custo unitário (R$). */
  porItem: Map<string, number>;
  /** GTIN normalizado → custo unitário (R$). */
  porGtin: Map<string, number>;
}

/** Lê os custos cadastrados das variações do usuário (RLS) e monta os mapas de resolução. */
export async function buscarCustos(): Promise<MapasCusto> {
  const { data, error } = await supabase
    .from('variacoes')
    .select('custo, ml_variation_id, gtin, familias!inner(ml_item_id)')
    .not('custo', 'is', null);
  if (error) throw new Error(error.message);

  const porVariacao = new Map<string, number>();
  const porItem = new Map<string, number>();
  const porGtin = new Map<string, number>();
  // Mantém o maior custo por chave (robusto a linhas duplicadas por re-importação).
  const upsertMax = (m: Map<string, number>, k: string, v: number) => {
    if (v > (m.get(k) ?? 0)) m.set(k, v);
  };

  for (const v of (data ?? []) as Array<Record<string, unknown>>) {
    const custo = Number(v.custo ?? 0);
    if (custo <= 0) continue;
    const varId = v.ml_variation_id as string | null;
    const gtin = v.gtin as string | null;
    const fams = v.familias as { ml_item_id: string | null } | { ml_item_id: string | null }[] | null;
    const itemId = (Array.isArray(fams) ? fams[0]?.ml_item_id : fams?.ml_item_id) ?? null;
    if (varId != null) upsertMax(porVariacao, String(varId), custo);
    if (itemId != null) upsertMax(porItem, String(itemId), custo);
    if (gtin) upsertMax(porGtin, normGtin(gtin), custo);
  }
  return { porVariacao, porItem, porGtin };
}

/** Resolver de custo unitário p/ o agregador: variação → anúncio → GTIN. null = sem custo. */
export function montarCustoResolver(m: MapasCusto | undefined): CustoResolver {
  return (item: VendaItem): number | null => {
    if (!m) return null;
    if (item.variation_id != null) {
      const c = m.porVariacao.get(String(item.variation_id));
      if (c != null) return c;
    }
    if (item.ml_item_id) {
      const c = m.porItem.get(item.ml_item_id);
      if (c != null) return c;
    }
    if (item.ean) {
      const c = m.porGtin.get(normGtin(item.ean));
      if (c != null) return c;
    }
    return null;
  };
}
