// Custo (R$) e peso (g) do produto por chave, lidos client-side de `variacoes` (RLS own), para o
// markup e o rateio de frete do agregador (ADR-0038). Cruzamento por chave:
// variação → anúncio → GTIN. NÃO usar familias.custo_centavos (é custo de tokens de IA). Pura
// exceto pela query inicial.
import { supabase } from './supabase';
import { normGtin } from './gtin';
import { buscarTodasPaginas } from './paginacao-supabase';
import type { CustoResolver, PesoResolver, AliquotaResolver } from './resumo-vendas';
import type { VendaItem } from './faturamento';

/** Origem do produto p/ imposto (familias.origem). null = não cadastrada. */
export type OrigemProduto = 'nacional' | 'importado' | null;

/** Custo unitário (R$) + peso unitário (g) + origem (imposto) de um produto. */
export interface ValorProduto { custo: number; peso: number; origem: OrigemProduto }

export interface MapasCusto {
  /** ml_variation_id → custo/peso. */
  porVariacao: Map<string, ValorProduto>;
  /** ml_item_id (anúncio) → custo/peso. */
  porItem: Map<string, ValorProduto>;
  /** GTIN normalizado → custo/peso. */
  porGtin: Map<string, ValorProduto>;
}

/** Monta os mapas de custo/peso a partir das linhas já lidas de `variacoes` (puro, testável).
 *  Mantém a entrada de maior custo por chave (robusto a linhas duplicadas por re-importação);
 *  o peso correspondente acompanha o custo escolhido. Linha com custo ≤ 0 é descartada. */
export function montarMapasCusto(rows: Array<Record<string, unknown>>): MapasCusto {
  const porVariacao = new Map<string, ValorProduto>();
  const porItem = new Map<string, ValorProduto>();
  const porGtin = new Map<string, ValorProduto>();
  const upsertMax = (m: Map<string, ValorProduto>, k: string, val: ValorProduto) => {
    if (val.custo > (m.get(k)?.custo ?? 0)) m.set(k, val);
  };

  for (const v of rows) {
    const custo = Number(v.custo ?? 0);
    if (custo <= 0) continue;
    const peso = Number(v.peso_gramas ?? 0);
    const varId = v.ml_variation_id as string | null;
    const gtin = v.gtin as string | null;
    type FamLite = { ml_item_id: string | null; origem?: OrigemProduto };
    const fams = v.familias as FamLite | FamLite[] | null;
    const fam = Array.isArray(fams) ? fams[0] : fams;
    const itemId = fam?.ml_item_id ?? null;
    const origem = (fam?.origem as OrigemProduto) ?? null;
    const val: ValorProduto = { custo, peso, origem };
    if (varId != null) upsertMax(porVariacao, String(varId), val);
    if (itemId != null) upsertMax(porItem, String(itemId), val);
    if (gtin) upsertMax(porGtin, normGtin(gtin), val);
  }
  return { porVariacao, porItem, porGtin };
}

/** Lê custo + peso cadastrados das variações do usuário (RLS) e monta os mapas de resolução. */
export async function buscarCustos(): Promise<MapasCusto> {
  const rows = await buscarTodasPaginas<Record<string, unknown>>((de, ate) =>
    supabase
      .from('variacoes')
      .select('custo, peso_gramas, ml_variation_id, gtin, familias!inner(ml_item_id, origem)')
      .not('custo', 'is', null)
      .range(de, ate) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>,
  );
  return montarMapasCusto(rows);
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

/** Resolver de alíquota de imposto (%) p/ o markup: origem da família → alíquota global do usuário.
 *  null = origem não mapeada (item sem custo/família casada), OU alíquota ainda não resolvida
 *  (config não carregou) → sem imposto em vez de um número possivelmente errado (ADR-0055: imposto
 *  por origem nunca defaulta em silêncio). */
export function montarAliquotaResolver(
  m: MapasCusto | undefined, aliquotas: { nacional: number; importado: number } | null,
): AliquotaResolver {
  return (item) => {
    if (!aliquotas) return null;
    const origem = resolverProduto(m, item)?.origem;
    if (origem === 'importado') return aliquotas.importado;
    if (origem === 'nacional') return aliquotas.nacional;
    return null;
  };
}
