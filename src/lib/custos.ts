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

/** `atualizado_em` da linha como número comparável. Ausente/inválido → -Infinity, para nunca
 *  derrubar uma linha datada (o `>` do tie-break só troca com data estritamente maior). */
function instante(v: unknown): number {
  if (v == null) return -Infinity;
  const t = new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : -Infinity;
}

export interface MapasCusto {
  /** ml_variation_id → custo/peso. */
  porVariacao: Map<string, ValorProduto>;
  /** ml_item_id (anúncio) → custo/peso. */
  porItem: Map<string, ValorProduto>;
  /** GTIN normalizado → custo/peso. */
  porGtin: Map<string, ValorProduto>;
  /** Código/SKU normalizado → custo/peso (fallback para vendas sem EAN). */
  porCodigo: Map<string, ValorProduto>;
}

/** Monta os mapas de custo/peso a partir das linhas já lidas de `variacoes` (puro, testável).
 *  Com linhas duplicadas por re-importação, mantém a **mais recente** (`atualizado_em`), não a de
 *  maior custo (ADR-0108): as duplicatas costumam ter TODAS as chaves iguais — mesmo
 *  ml_variation_id, ml_item_id, gtin e codigo —, então nenhuma delas desambigua e o tie-break é a
 *  única coisa que decide. Pelo maior custo, uma redução de custo nunca aparecia enquanto a linha
 *  antiga existisse. O peso e a origem acompanham a linha escolhida. Custo ≤ 0 é descartado. */
export function montarMapasCusto(rows: Array<Record<string, unknown>>): MapasCusto {
  const porVariacao = new Map<string, ValorProduto>();
  const porItem = new Map<string, ValorProduto>();
  const porGtin = new Map<string, ValorProduto>();
  const porCodigo = new Map<string, ValorProduto>();
  const quando = new Map<Map<string, ValorProduto>, Map<string, number>>();
  const upsertRecente = (m: Map<string, ValorProduto>, k: string, val: ValorProduto, em: number) => {
    let datas = quando.get(m);
    if (!datas) { datas = new Map(); quando.set(m, datas); }
    if (!m.has(k) || em > (datas.get(k) ?? -Infinity)) { m.set(k, val); datas.set(k, em); }
  };

  for (const v of rows) {
    const custo = Number(v.custo ?? 0);
    // isFinite antes do > 0: `Number('abc')` é NaN e `NaN <= 0` é false, então sem esta guarda um
    // custo não numérico entrava no mapa e virava markup NaN na tela. Achado pelo teste de
    // paridade com o backend (ADR-0109), que devolvia null para o mesmo dado.
    if (!Number.isFinite(custo) || custo <= 0) continue;
    const em = instante(v.atualizado_em);
    const peso = Number(v.peso_gramas ?? 0);
    const varId = v.ml_variation_id as string | null;
    const gtin = v.gtin as string | null;
    const codigo = v.codigo as string | null;
    type FamLite = { ml_item_id: string | null; origem?: OrigemProduto };
    const fams = v.familias as FamLite | FamLite[] | null;
    const fam = Array.isArray(fams) ? fams[0] : fams;
    const itemId = fam?.ml_item_id ?? null;
    const origem = (fam?.origem as OrigemProduto) ?? null;
    const val: ValorProduto = { custo, peso, origem };
    if (varId != null) upsertRecente(porVariacao, String(varId), val, em);
    if (itemId != null) upsertRecente(porItem, String(itemId), val, em);
    if (gtin) upsertRecente(porGtin, normGtin(gtin), val, em);
    if (codigo) upsertRecente(porCodigo, normGtin(codigo), val, em);
  }
  return { porVariacao, porItem, porGtin, porCodigo };
}

/** Lê custo + peso cadastrados das variações do usuário (RLS) e monta os mapas de resolução. */
export async function buscarCustos(): Promise<MapasCusto> {
  const rows = await buscarTodasPaginas<Record<string, unknown>>((de, ate) =>
    supabase
      .from('variacoes')
      // `atualizado_em` é o tie-break das duplicatas de re-importação (ADR-0108) — sem ele no
      // select, toda linha vira -Infinity e a primeira da página venceria por acaso.
      .select('custo, peso_gramas, ml_variation_id, gtin, codigo, atualizado_em, familias!inner(ml_item_id, origem)')
      .not('custo', 'is', null)
      .range(de, ate) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>,
  );
  return montarMapasCusto(rows);
}

/** Resolve o produto de um item de venda na cadeia variação → anúncio → GTIN → Código/SKU. null = não casou. */
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
  if (item.codigo) {
    const x = m.porCodigo.get(normGtin(item.codigo));
    if (x != null) return x;
  }
  return null;
}

/** Resolver de custo unitário (R$) p/ o agregador. null = sem custo cadastrado.
 *
 *  O custo CONGELADO na venda (ADR-0109) tem precedência sobre o catálogo: é o valor que valia no
 *  instante da venda, e o catálogo de hoje não pode reescrevê-lo — nem quando o produto some do
 *  catálogo. Sem congelado (venda anterior ao backfill, ou item que não casou), cai na resolução
 *  dinâmica de sempre. */
export function montarCustoResolver(m: MapasCusto | undefined): CustoResolver {
  return (item) => item.custo_congelado ?? resolverProduto(m, item)?.custo ?? null;
}

/** Resolver de peso unitário (g) p/ o rateio de frete. null = sem peso cadastrado. */
export function montarPesoResolver(m: MapasCusto | undefined): PesoResolver {
  return (item) => {
    const p = resolverProduto(m, item)?.peso ?? 0;
    return p > 0 ? p : null;
  };
}

/** Resolver de alíquota de imposto (%) p/ o markup. Ordem: alíquota interna por UF (ADR-0112) →
 *  origem da família (ADR-0055). null = origem não mapeada (item sem custo/família casada), OU
 *  alíquota ainda não resolvida (config não carregou) → sem imposto em vez de um número
 *  possivelmente errado (imposto nunca defaulta em silêncio). */
export function montarAliquotaResolver(
  m: MapasCusto | undefined,
  aliquotas: { nacional: number; importado: number; ufEmpresa?: string | null; internaPct?: number | null } | null,
): AliquotaResolver {
  return (item, uf) => {
    if (!aliquotas) return null;
    // Venda dentro do estado da empresa: a alíquota interna sobrepõe nacional E importado.
    const ufEmpresa = aliquotas.ufEmpresa ?? null;
    const internaPct = aliquotas.internaPct ?? null;
    if (ufEmpresa != null && internaPct != null && uf != null
        && uf.trim().toUpperCase() === ufEmpresa.trim().toUpperCase()) {
      return internaPct;
    }
    const origem = resolverProduto(m, item)?.origem;
    if (origem === 'importado') return aliquotas.importado;
    if (origem === 'nacional') return aliquotas.nacional;
    return null;
  };
}
