// Vincular um produto ao catálogo do ML (ADR-0021) cria um anúncio SEPARADO, com MLB próprio
// (`catalog_listing_id`) e título padronizado pelo ML. A venda que entra por lá chega em
// `ml_vendas_itens` com esse MLB, então toda agregação por `ml_item_id` cru quebra o produto em
// duas linhas — "outro produto" no ranking do Dashboard, e as unidades some da linha do anúncio
// original em Publicados (que só lista o MLB próprio).
//
// O mesmo acontece com o **anúncio irmão legado**: produto que já vendia no ML como N anúncios (um
// MLB por cor) e entrou no app com só um desses MLBs vinculado. As vendas dos irmãos ficam órfãs —
// nenhuma linha da tela as recebe. Aí o vínculo explícito não existe, e o critério é o GTIN, o mesmo
// que o ADR-0045 já usa server-side (`venda.ts` marca `is_publiai` por GTIN no ingest).
//
// Este mapa resolve o MLB de catálogo ou irmão no MLB do anúncio dono, para as vendas acumularem no
// produto original.
import { supabase } from './supabase';
import { buscarTodasPaginas } from './paginacao-supabase';
import {
  montarMapaCanonico,
  type LinhaGtin,
  type LinhaItemUP,
  type LinhaVariacao,
  type MapaCanonico,
} from '../../supabase/functions/_shared/platform-admin/sales-canonical';
export { canonizarItem, montarMapaCanonico, type MapaCanonico } from '../../supabase/functions/_shared/platform-admin/sales-canonical';

type Pagina<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Lê os vínculos do usuário (RLS) e devolve o mapa de canonização. */
export async function buscarMapaCanonico(): Promise<MapaCanonico> {
  const [variacoes, itensUP, gtins, familias, externos] = await Promise.all([
    buscarTodasPaginas<LinhaVariacao>((de, ate) =>
      supabase
        .from('variacoes')
        .select('catalog_listing_id, familias!inner(ml_item_id)')
        .not('catalog_listing_id', 'is', null)
        .range(de, ate) as unknown as Pagina<LinhaVariacao>,
    ),
    buscarTodasPaginas<LinhaItemUP>((de, ate) =>
      supabase
        .from('anuncios_externos_itens')
        .select('catalog_listing_id, item_externo_id')
        .not('catalog_listing_id', 'is', null)
        .range(de, ate) as unknown as Pagina<LinhaItemUP>,
    ),
    buscarTodasPaginas<LinhaGtin>((de, ate) =>
      supabase
        .from('variacoes')
        .select('gtin, familias!inner(ml_item_id)')
        .not('gtin', 'is', null)
        .not('familias.ml_item_id', 'is', null)
        .range(de, ate) as unknown as Pagina<LinhaGtin>,
    ),
    buscarTodasPaginas<{ ml_item_id: string | null }>((de, ate) =>
      supabase
        .from('familias')
        .select('ml_item_id')
        .not('ml_item_id', 'is', null)
        .range(de, ate) as unknown as Pagina<{ ml_item_id: string | null }>,
    ),
    buscarTodasPaginas<{ item_externo_id: string | null }>((de, ate) =>
      supabase
        .from('anuncios_externos')
        .select('item_externo_id')
        .not('item_externo_id', 'is', null)
        .range(de, ate) as unknown as Pagina<{ item_externo_id: string | null }>,
    ),
  ]);
  const conhecidos = [
    ...familias.map((f) => f.ml_item_id),
    ...externos.map((e) => e.item_externo_id),
  ];
  return montarMapaCanonico(variacoes, itensUP, gtins, conhecidos);
}
