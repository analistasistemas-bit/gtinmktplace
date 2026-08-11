// Foto (storage path) do produto por chave, lida client-side de `variacoes` (RLS own), para o
// thumbnail da visão por pedido do Faturamento (ADR-0039). Espelha a cadeia de resolução do custo
// (variação → anúncio → GTIN) sem tocar em custos.ts, pra não arriscar o markup/rateio de frete.
import { supabase } from './supabase';
import { normGtin } from './gtin';
import { buscarTodasPaginas } from './paginacao-supabase';
import { canonizarItem, type MapaCanonico } from './anuncio-canonico';
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
  /** Código/SKU normalizado → imagem_path (fallback para vendas sem EAN). */
  porCodigo: Map<string, string>;
  /** ml_item_id → capa da família. Último fallback: o cadastro de produto avulso grava a foto
   *  só em `familias.capa_storage_path`, e a variação fica sem `imagem_path`. */
  porItemCapa: Map<string, string>;
}

/** Grava `chave → foto`, mas ANULA a chave (`null`) quando duas fotos diferentes disputam —
 *  mostrar a foto de outra cor é tão errado quanto mostrar a cor de outra variação. */
function definir(mapa: Map<string, string | null>, chave: string, path: string) {
  const atual = mapa.get(chave);
  if (atual === undefined) { mapa.set(chave, path); return; }
  if (atual === null) return;
  if (atual !== path) mapa.set(chave, null);
}

/** Lê o imagem_path das variações do usuário (RLS) e monta os mapas de resolução.
 *  Pagina (`.range`) para não truncar no teto padrão (~1000 linhas) do PostgREST. */
export async function buscarFotos(): Promise<MapasFoto> {
  // A 2ª query é separada porque a 1ª filtra `imagem_path not null` — uma variação sem foto
  // própria nunca chegaria pelo select das variações.
  const [data, capas, itensUP] = await Promise.all([
    buscarTodasPaginas<Record<string, unknown>>((de, ate) => supabase
      .from('variacoes')
      .select('imagem_path, ml_variation_id, gtin, codigo, familias!inner(ml_item_id)')
      .not('imagem_path', 'is', null)
      .range(de, ate)),
    buscarTodasPaginas<Record<string, unknown>>((de, ate) => supabase
      .from('familias')
      .select('ml_item_id, capa_storage_path')
      .not('ml_item_id', 'is', null)
      .not('capa_storage_path', 'is', null)
      .range(de, ate)),
    // Filhos User Products (ADR-0088): 1 item ML por cor. Sem eles, a venda de um filho cujo
    // item_externo_id é também o `familias.ml_item_id` cai no mapa por anúncio e herda a foto de
    // outra cor.
    buscarTodasPaginas<Record<string, unknown>>((de, ate) => supabase
      .from('anuncios_externos_itens')
      .select('item_externo_id, sku')
      .not('item_externo_id', 'is', null)
      .range(de, ate)),
  ]);
  return montarMapasFoto(data, capas, itensUP);
}

/** Monta os mapas a partir das linhas já lidas (puro, testável). */
export function montarMapasFoto(
  data: Record<string, unknown>[], capas: Record<string, unknown>[], itensUP: Record<string, unknown>[] = [],
): MapasFoto {
  const porVariacao = new Map<string, string>();
  // `null` marca chave ambígua: duas variações do mesmo anúncio com fotos diferentes. Ver `definir`.
  const porItem = new Map<string, string | null>();
  const porGtin = new Map<string, string>();
  const porCodigo = new Map<string, string>();
  const porItemCapa = new Map<string, string>();
  const fotoPorSku = new Map<string, string | null>();

  for (const f of capas) {
    const itemId = f.ml_item_id as string | null;
    const capa = f.capa_storage_path as string | null;
    if (itemId && capa && !porItemCapa.has(String(itemId))) porItemCapa.set(String(itemId), capa);
  }

  for (const v of data) {
    const path = v.imagem_path as string | null;
    if (!path) continue;
    const varId = v.ml_variation_id as string | null;
    const gtin = v.gtin as string | null;
    const codigo = v.codigo as string | null;
    const fams = v.familias as { ml_item_id: string | null } | { ml_item_id: string | null }[] | null;
    const itemId = (Array.isArray(fams) ? fams[0]?.ml_item_id : fams?.ml_item_id) ?? null;
    if (varId != null && !porVariacao.has(String(varId))) porVariacao.set(String(varId), path);
    // Anúncio de N cores: cada variação tem foto própria, e "a primeira da lista" é a foto de
    // outra cor. Anula em vez de chutar — a cadeia segue para GTIN/código (exatos) e, no pior
    // caso, para a capa da família, que é genérica mas nunca de outra cor.
    if (itemId != null) definir(porItem, String(itemId), path);
    if (gtin && !porGtin.has(normGtin(gtin))) porGtin.set(normGtin(gtin), path);
    if (codigo && !porCodigo.has(normGtin(codigo))) porCodigo.set(normGtin(codigo), path);
    if (codigo) definir(fotoPorSku, codigo, path);
  }

  // Filho UP: `item_externo_id → sku` é 1:1 exato (ADR-0088 "Ancoragem") e sobrepõe a chave por
  // família. SKU ambíguo anula em vez de deixar a família decidir.
  for (const i of itensUP) {
    const itemId = i.item_externo_id as string | null;
    const sku = i.sku as string | null;
    if (!itemId || !sku) continue;
    const path = fotoPorSku.get(sku);
    if (path !== undefined) porItem.set(String(itemId), path);
  }

  return {
    porVariacao,
    porItem: new Map([...porItem].filter((p): p is [string, string] => p[1] != null)),
    porGtin, porCodigo, porItemCapa,
  };
}

/** Resolver de foto (storage path) p/ o agregador. null = sem foto cadastrada.
 *  `canonico` (ADR-0045) resolve o MLB de catálogo pro MLB do anúncio dono antes de bater em
 *  `porItem`/`porItemCapa` — venda por catálogo chega com o MLB do anúncio âncora, não o nosso. */
export function montarFotoResolver(m: MapasFoto | undefined, canonico?: MapaCanonico): FotoResolver {
  return (item) => {
    if (!m) return null;
    if (item.variation_id != null) {
      const x = m.porVariacao.get(String(item.variation_id));
      if (x != null) return x;
    }
    const itemId = item.ml_item_id ? canonizarItem(item.ml_item_id, canonico) : null;
    if (itemId) {
      const x = m.porItem.get(itemId);
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
    // Por último: a capa da família. Antes disso estragaria a miniatura de anúncio com variações
    // por cor (mostraria a capa genérica no lugar da foto da cor vendida).
    if (itemId) {
      const x = m.porItemCapa.get(itemId);
      if (x != null) return x;
    }
    return null;
  };
}
