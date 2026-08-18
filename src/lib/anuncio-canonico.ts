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
import { normGtin } from './gtin';
import { buscarTodasPaginas } from './paginacao-supabase';

export interface MapaCanonico {
  /** MLB do anúncio de catálogo → MLB do anúncio dono (vínculo explícito). */
  listings: Record<string, string>;
  /** GTIN normalizado → MLB do anúncio dono. Só GTIN que aponta para UM anúncio (ver abaixo). */
  gtins?: Record<string, string>;
  /** MLBs que o app já lista como anúncio próprio — nunca redirecionados por GTIN. */
  conhecidos?: Set<string>;
}

/** Chave de comparação de GTIN: sem zeros à esquerda (`normGtin`) e sem espaço de digitação.
 *  Os dois lados do mapa (cadastro e venda) passam por aqui, senão um espaço no cadastro impede o
 *  match sem nenhum sinal. Vazio/nulo → null (nunca vira chave). */
const chaveGtin = (g: string | null | undefined) => {
  const s = (g ?? '').trim();
  return s === '' ? null : normGtin(s);
};

/** Resolve o anúncio dono de um MLB. Sem mapa (ou sem match) devolve o próprio id.
 *  `ean` é o GTIN da linha da venda: informá-lo habilita o fallback de anúncio irmão. Quem só quer
 *  a fusão de catálogo (foto, cor) omite e mantém o comportamento anterior. */
export function canonizarItem(mlItemId: string, mapa?: MapaCanonico, ean?: string | null): string {
  if (!mapa) return mlItemId;
  const dono = mapa.listings[mlItemId];
  if (dono) return dono;
  // Anúncio que o app lista é dono de si mesmo — GTIN nunca reatribui venda entre anúncios válidos.
  if (mapa.conhecidos?.has(mlItemId)) return mlItemId;
  const gtin = chaveGtin(ean);
  return (gtin ? mapa.gtins?.[gtin] : undefined) ?? mlItemId;
}

type LinhaFamilia = { ml_item_id: string | null } | { ml_item_id: string | null }[] | null;
type LinhaVariacao = { catalog_listing_id: string | null; familias: LinhaFamilia };
type LinhaItemUP = { catalog_listing_id: string | null; item_externo_id: string | null };
type LinhaGtin = { gtin: string | null; familias: LinhaFamilia };

const donoDe = (f: LinhaFamilia) => (Array.isArray(f) ? f[0] : f)?.ml_item_id ?? null;

/** Monta o mapa a partir das linhas já lidas (puro, testável).
 *  - Catálogo, modelo legado: `variacoes.catalog_listing_id` → `familias.ml_item_id`.
 *  - Catálogo, User Products (ADR-0088): `anuncios_externos_itens.catalog_listing_id` →
 *    `item_externo_id` (o próprio item filho É o anúncio dono do seu listing).
 *  - Irmão legado: `variacoes.gtin` → `familias.ml_item_id`.
 *  Entrada que apontaria para si mesma ou para um dono nulo é descartada.
 *
 *  GTIN que aponta para MAIS DE UM anúncio é descartado por inteiro: é exatamente a assinatura de
 *  kit x unidade (ADR-0071) e split por faixa de preço (ADR-0078/0048), anúncios legitimamente
 *  distintos que compartilham produto. Fundi-los seria pior que não atribuir (ADR-0045). */
export function montarMapaCanonico(
  variacoes: LinhaVariacao[],
  itensUP: LinhaItemUP[],
  gtins: LinhaGtin[] = [],
  anunciosConhecidos: (string | null)[] = [],
): MapaCanonico {
  const listings: Record<string, string> = {};
  const por = (listing: string | null, dono: string | null | undefined) => {
    if (!listing || !dono || listing === dono) return;
    listings[listing] = dono;
  };
  for (const v of variacoes) por(v.catalog_listing_id, donoDe(v.familias));
  for (const i of itensUP) por(i.catalog_listing_id, i.item_externo_id);

  const donosPorGtin = new Map<string, Set<string>>();
  for (const g of gtins) {
    const dono = donoDe(g.familias);
    const chave = chaveGtin(g.gtin);
    if (!chave || !dono) continue;
    const s = donosPorGtin.get(chave) ?? new Set<string>();
    s.add(dono);
    donosPorGtin.set(chave, s);
  }
  const mapaGtins: Record<string, string> = {};
  for (const [gtin, donos] of donosPorGtin) {
    if (donos.size === 1) mapaGtins[gtin] = [...donos][0];
  }

  return {
    listings,
    gtins: mapaGtins,
    conhecidos: new Set(anunciosConhecidos.filter((x): x is string => !!x)),
  };
}

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
