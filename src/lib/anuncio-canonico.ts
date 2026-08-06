// Vincular um produto ao catálogo do ML (ADR-0021) cria um anúncio SEPARADO, com MLB próprio
// (`catalog_listing_id`) e título padronizado pelo ML. A venda que entra por lá chega em
// `ml_vendas_itens` com esse MLB, então toda agregação por `ml_item_id` cru quebra o produto em
// duas linhas — "outro produto" no ranking do Dashboard, e as unidades some da linha do anúncio
// original em Publicados (que só lista o MLB próprio).
//
// Este mapa resolve o MLB de catálogo no MLB do anúncio dono, para as vendas acumularem no produto
// original. É o mesmo semântico que o ADR-0045 já aplica server-side por GTIN — aqui a fonte é o
// vínculo explícito gravado na vinculação (zero falso positivo: não funde split de faixa de preço
// (ADR-0078) nem kit x unidade (ADR-0071), que compartilham código mas são anúncios distintos).
import { supabase } from './supabase';
import { buscarTodasPaginas } from './paginacao-supabase';

/** MLB do anúncio de catálogo → MLB do anúncio dono. */
export type MapaCanonico = Record<string, string>;

/** Resolve o anúncio dono de um MLB. Sem entrada no mapa (ou sem mapa) devolve o próprio id. */
export function canonizarItem(mlItemId: string, mapa?: MapaCanonico): string {
  return mapa?.[mlItemId] ?? mlItemId;
}

type LinhaVariacao = { catalog_listing_id: string | null; familias: { ml_item_id: string | null } | { ml_item_id: string | null }[] | null };
type LinhaItemUP = { catalog_listing_id: string | null; item_externo_id: string | null };

/** Monta o mapa a partir das linhas já lidas (puro, testável).
 *  - Modelo legado: `variacoes.catalog_listing_id` → `familias.ml_item_id` (o anúncio da família).
 *  - Modelo User Products (ADR-0088): `anuncios_externos_itens.catalog_listing_id` →
 *    `item_externo_id` (o próprio item filho É o anúncio dono do seu listing de catálogo).
 *  Entrada que apontaria para si mesma ou para um dono nulo é descartada. */
export function montarMapaCanonico(variacoes: LinhaVariacao[], itensUP: LinhaItemUP[]): MapaCanonico {
  const mapa: MapaCanonico = {};
  const por = (listing: string | null, dono: string | null | undefined) => {
    if (!listing || !dono || listing === dono) return;
    mapa[listing] = dono;
  };
  for (const v of variacoes) {
    const fam = Array.isArray(v.familias) ? v.familias[0] : v.familias;
    por(v.catalog_listing_id, fam?.ml_item_id);
  }
  for (const i of itensUP) por(i.catalog_listing_id, i.item_externo_id);
  return mapa;
}

/** Lê os vínculos de catálogo do usuário (RLS) e devolve o mapa listing → anúncio dono. */
export async function buscarMapaCanonico(): Promise<MapaCanonico> {
  const [variacoes, itensUP] = await Promise.all([
    buscarTodasPaginas<LinhaVariacao>((de, ate) =>
      supabase
        .from('variacoes')
        .select('catalog_listing_id, familias!inner(ml_item_id)')
        .not('catalog_listing_id', 'is', null)
        .range(de, ate) as unknown as PromiseLike<{ data: LinhaVariacao[] | null; error: { message: string } | null }>,
    ),
    buscarTodasPaginas<LinhaItemUP>((de, ate) =>
      supabase
        .from('anuncios_externos_itens')
        .select('catalog_listing_id, item_externo_id')
        .not('catalog_listing_id', 'is', null)
        .range(de, ate) as unknown as PromiseLike<{ data: LinhaItemUP[] | null; error: { message: string } | null }>,
    ),
  ]);
  return montarMapaCanonico(variacoes, itensUP);
}
