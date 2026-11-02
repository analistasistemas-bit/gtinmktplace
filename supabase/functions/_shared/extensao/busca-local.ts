// Busca na Extensão PubliAI (ADR-0189 emenda 02/11, Task 2): para cada card, "anúncio próprio" e "vínculo de produto"
// — estados independentes —, só pelo banco (zero ML, zero OAuth, zero cota). O cliente é service-role: o filtro
// explícito de org em CADA consulta é o único isolamento entre organizações.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { casarCards, type DepsCasamento, type MetadadosCardBusca } from './busca.ts';

// Tipo em busca.ts (sem import jsr:): a extensão o importa sem puxar o supabase-js.
export type { MetadadosCardBusca };

/** Teto por fonte (abaixo do max_rows do PostgREST): bateu o teto = leitura possivelmente cortada → incompleta. */
export const MAX_LINHAS_FONTE = 1000;

type Resultado = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** As 7 fontes de id de anúncio que o PubliAI conhece (as mesmas de varrer-anuncios-orfaos), filtradas pelos ids pedidos. */
function fontesProprias(admin: SupabaseClient, orgId: string, ids: string[]): [string, Resultado][] {
  const de = (tabela: string, col: string) =>
    admin.from(tabela).select(col).eq('org_id', orgId).in(col, ids).limit(MAX_LINHAS_FONTE);
  return [
    ['ml_item_id', de('familias', 'ml_item_id')],
    ['item_externo_id', de('anuncios_externos', 'item_externo_id')],
    ['item_externo_id', de('anuncios_externos_itens', 'item_externo_id')],
    ['ml_item_id', de('kits_virtuais', 'ml_item_id')],
    // Catálogo Legacy (ADR-0021/0088): org da variação E da família.
    ['catalog_listing_id', admin.from('variacoes').select('catalog_listing_id, familias!inner(org_id)')
      .eq('org_id', orgId).eq('familias.org_id', orgId).in('catalog_listing_id', ids).limit(MAX_LINHAS_FONTE)],
    ['catalog_listing_id', de('anuncios_externos_itens', 'catalog_listing_id')],
    // Item anterior da migração p/ preço por variação (ADR-0161).
    ['ml_item_id_anterior', de('anuncios_externos', 'ml_item_id_anterior')],
  ];
}

export async function identificarBusca(
  admin: SupabaseClient,
  orgId: string,
  pedido: { eanDaBusca: string | null; itens: { itemId: string; catalogProductId: string | null }[] },
  deps: DepsCasamento,
): Promise<{ itens: MetadadosCardBusca[] }> {
  const ids = pedido.itens.map((i) => i.itemId);
  const proprios = new Set<string>();
  let incompleto = false;
  const [casamentos] = await Promise.all([
    casarCards(orgId, pedido.itens, pedido.eanDaBusca, deps),
    Promise.all(fontesProprias(admin, orgId, ids).map(async ([col, q]) => {
      try {
        const { data, error } = await q;
        const linhas = (data ?? []) as Record<string, unknown>[];
        if (error || linhas.length >= MAX_LINHAS_FONTE) incompleto = true;
        for (const l of linhas) if (typeof l[col] === 'string') proprios.add(l[col] as string);
      } catch {
        incompleto = true;
      }
    })),
  ]);
  return {
    itens: pedido.itens.map(({ itemId }) => {
      const c = casamentos.get(itemId);
      return {
        itemId,
        proprio: proprios.has(itemId) ? true : incompleto ? null : false,
        vinculo: c?.variacao ? { fonte: c.fonte, codigo: c.variacao.codigo } : null,
      };
    }),
  };
}
