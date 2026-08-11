// Cor do produto resolvida client-side, para a coluna "Cor" do detalhe do pedido (Faturamento e
// Detalhe do líquido). O ML só manda a cor em `variation_attributes`, então item PLANO — filho
// User Products (ADR-0088, 1 item ML por cor) ou família de 1 variação — chega com
// `ml_vendas_itens.cor` nula. Resolver na leitura conserta também as vendas já sincronizadas.
// Espelha a cadeia de `fotos-produto.ts` (variação → anúncio → GTIN → código).
import { supabase } from './supabase';
import { normGtin } from './gtin';
import { buscarTodasPaginas } from './paginacao-supabase';
import { canonizarItem, type MapaCanonico } from './anuncio-canonico';
import type { VendaItem } from './faturamento';

/** Resolve a cor de um item de venda sem cor própria. null = não resolvível com segurança. */
export type CorResolver = (item: VendaItem) => string | null;

export interface MapasCor {
  /** ml_variation_id → cor. */
  porVariacao: Map<string, string>;
  /** ml_item_id do anúncio → cor. Só entra quando o anúncio tem UMA cor possível. */
  porItem: Map<string, string>;
  /** GTIN normalizado → cor. */
  porGtin: Map<string, string>;
  /** Código/SKU normalizado → cor. */
  porCodigo: Map<string, string>;
}

export interface LinhaVariacaoCor {
  codigo: string | null;
  cor: string | null;
  gtin: string | null;
  ml_variation_id: string | null;
  familias: { ml_item_id: string | null } | { ml_item_id: string | null }[] | null;
}

export interface LinhaItemUPCor {
  item_externo_id: string | null;
  sku: string | null;
}

/** Grava `chave → cor`, mas ANULA a chave quando duas cores diferentes disputam — mostrar a cor de
 *  outra variação é inventar dado de produto. `null` marca a chave como ambígua. */
function definir(mapa: Map<string, string | null>, chave: string, cor: string) {
  if (!mapa.has(chave)) { mapa.set(chave, cor); return; }
  if (mapa.get(chave) !== cor) mapa.set(chave, null);
}

const limpar = (m: Map<string, string | null>): Map<string, string> =>
  new Map([...m].filter((par): par is [string, string] => par[1] != null));

/** Monta os mapas a partir das linhas já lidas (puro, testável). */
export function montarMapasCor(variacoes: LinhaVariacaoCor[], itensUP: LinhaItemUPCor[]): MapasCor {
  const porVariacao = new Map<string, string | null>();
  const porItem = new Map<string, string | null>();
  const porGtin = new Map<string, string | null>();
  const porCodigo = new Map<string, string | null>();
  const corPorSku = new Map<string, string | null>();

  for (const v of variacoes) {
    const cor = v.cor;
    if (!cor) continue;
    const fams = Array.isArray(v.familias) ? v.familias[0] : v.familias;
    const itemId = fams?.ml_item_id ?? null;
    if (v.ml_variation_id != null) definir(porVariacao, String(v.ml_variation_id), cor);
    // Só resolve por anúncio quando a família inteira tem uma cor só; senão `definir` anula a
    // chave e o item cai no fallback — nunca mostra a "primeira variação da lista" (ver io.ts:96).
    if (itemId) definir(porItem, itemId, cor);
    if (v.gtin) definir(porGtin, normGtin(v.gtin), cor);
    if (v.codigo) { definir(porCodigo, normGtin(v.codigo), cor); definir(corPorSku, v.codigo, cor); }
  }

  // Filho User Products: item_externo_id → sku é 1:1 exato, então sobrepõe a chave por família
  // (ambígua quando a família tem N cores).
  for (const i of itensUP) {
    const cor = i.sku ? corPorSku.get(i.sku) ?? null : null;
    if (i.item_externo_id && cor) porItem.set(i.item_externo_id, cor);
  }

  return {
    porVariacao: limpar(porVariacao), porItem: limpar(porItem),
    porGtin: limpar(porGtin), porCodigo: limpar(porCodigo),
  };
}

/** Lê as cores do catálogo do usuário (RLS) e monta os mapas de resolução. */
export async function buscarCores(): Promise<MapasCor> {
  const [variacoes, itensUP] = await Promise.all([
    buscarTodasPaginas<LinhaVariacaoCor>((de, ate) => supabase
      .from('variacoes')
      .select('codigo, cor, gtin, ml_variation_id, familias!inner(ml_item_id)')
      .not('cor', 'is', null)
      .range(de, ate) as unknown as PromiseLike<{ data: LinhaVariacaoCor[] | null; error: { message: string } | null }>),
    buscarTodasPaginas<LinhaItemUPCor>((de, ate) => supabase
      .from('anuncios_externos_itens')
      .select('item_externo_id, sku')
      .not('item_externo_id', 'is', null)
      .range(de, ate) as unknown as PromiseLike<{ data: LinhaItemUPCor[] | null; error: { message: string } | null }>),
  ]);
  return montarMapasCor(variacoes, itensUP);
}

/** Resolver de cor p/ o agregador. `canonico` (ADR-0045) resolve o MLB de catálogo no MLB dono. */
export function montarCorResolver(m: MapasCor | undefined, canonico?: MapaCanonico): CorResolver {
  return (item) => {
    if (!m) return null;
    if (item.variation_id != null) {
      const x = m.porVariacao.get(String(item.variation_id));
      if (x != null) return x;
    }
    if (item.ml_item_id) {
      const x = m.porItem.get(canonizarItem(item.ml_item_id, canonico));
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
  };
}
