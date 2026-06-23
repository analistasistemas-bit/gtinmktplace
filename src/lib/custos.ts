// Custo (R$) e peso (g) do produto por chave, lidos client-side de `variacoes` (RLS own), para o
// markup e o rateio de frete do agregador (ADR-0038). Espelha o cruzamento do resumo-financeiro:
// variação → anúncio → GTIN. NÃO usar familias.custo_centavos (é custo de tokens de IA). Pura
// exceto pela query inicial.
import { supabase } from './supabase';
import type { CustoResolver, PesoResolver } from './resumo-vendas';
import type { VendaItem } from './faturamento';

/** GTIN normalizado (sem zeros à esquerda) para casar entre ML e planilha. */
const normGtin = (g: string) => g.replace(/^0+/, '');

/** Custo unitário (R$) + peso unitário (g) de um produto. */
interface ValorProduto { custo: number; peso: number }

export interface MapasCusto {
  /** ml_variation_id → custo/peso. */
  porVariacao: Map<string, ValorProduto>;
  /** ml_item_id (anúncio) → custo/peso. */
  porItem: Map<string, ValorProduto>;
  /** GTIN normalizado → custo/peso. */
  porGtin: Map<string, ValorProduto>;
}

/** Lê custo + peso cadastrados das variações do usuário (RLS) e monta os mapas de resolução. */
export async function buscarCustos(): Promise<MapasCusto> {
  const { data, error } = await supabase
    .from('variacoes')
    .select('custo, peso_gramas, ml_variation_id, gtin, familias!inner(ml_item_id)')
    .not('custo', 'is', null);
  if (error) throw new Error(error.message);

  const porVariacao = new Map<string, ValorProduto>();
  const porItem = new Map<string, ValorProduto>();
  const porGtin = new Map<string, ValorProduto>();
  // Mantém a entrada de maior custo por chave (robusto a linhas duplicadas por re-importação);
  // o peso correspondente acompanha o custo escolhido.
  const upsertMax = (m: Map<string, ValorProduto>, k: string, val: ValorProduto) => {
    if (val.custo > (m.get(k)?.custo ?? 0)) m.set(k, val);
  };

  for (const v of (data ?? []) as Array<Record<string, unknown>>) {
    const custo = Number(v.custo ?? 0);
    if (custo <= 0) continue;
    const peso = Number(v.peso_gramas ?? 0);
    const val: ValorProduto = { custo, peso };
    const varId = v.ml_variation_id as string | null;
    const gtin = v.gtin as string | null;
    const fams = v.familias as { ml_item_id: string | null } | { ml_item_id: string | null }[] | null;
    const itemId = (Array.isArray(fams) ? fams[0]?.ml_item_id : fams?.ml_item_id) ?? null;
    if (varId != null) upsertMax(porVariacao, String(varId), val);
    if (itemId != null) upsertMax(porItem, String(itemId), val);
    if (gtin) upsertMax(porGtin, normGtin(gtin), val);
  }
  return { porVariacao, porItem, porGtin };
}

/** Resolve o produto de um item de venda na cadeia variação → anúncio → GTIN. null = não casou. */
function resolverProduto(m: MapasCusto | undefined, item: VendaItem): ValorProduto | null {
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
}

/** Resolver de custo unitário (R$) p/ o agregador. null = sem custo cadastrado. */
export function montarCustoResolver(m: MapasCusto | undefined): CustoResolver {
  return (item) => resolverProduto(m, item)?.custo ?? null;
}

/** Resolver de peso unitário (g) p/ o rateio de frete. null = sem peso cadastrado. */
export function montarPesoResolver(m: MapasCusto | undefined): PesoResolver {
  return (item) => {
    const p = resolverProduto(m, item)?.peso ?? 0;
    return p > 0 ? p : null;
  };
}
