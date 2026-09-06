// ADR-0154 Decisão 12: candidatos a componente de Kit Virtual vêm do buscador do ML
// (`POST /users/$SELLER_ID/kits/components/search`), nunca de query local — só o ML sabe dizer
// COMPONENT_NOT_MIGRATED_TO_UP/OUT_OF_STOCK_ERROR/LOGISTIC_TYPE_MISMATCH. Este módulo é puro
// (sem fetch, sem Supabase) para ser testável sem HTTP; `index.ts` injeta as implementações reais
// (ML + banco) via `BuscarComponentesDeps`.
//
// Módulo isomórfico só nesse sentido — NÃO importa `jsr:`/`Deno`, então roda igual em vitest.

/** Um componente candidato, já normalizado do shape bruto do ML (ver `parsePaginaML`). */
export interface CandidatoBrutoML {
  userProductId: string;
  title: string;
  type: 'available' | 'non_available';
  thumbnailUrl: string | null;
  categoryName: string | null;
  /** Soma de `stock.locations[].quantity`. null quando o ML não devolveu estoque. */
  estoque: number | null;
  reasons: { id: string; message: string }[];
}

export interface PaginaComponentesML {
  produtos: CandidatoBrutoML[];
  searchAfterHash: string | null;
}

/** Ponte `user_product_id → item_id` de um item local (GET /items?ids=...&attributes=id,user_product_id,price,category_id).
 *  `preco-kit-virtual`/`preview-kit-virtual` exigem preço e categoria por componente — esta é a
 *  fonte confiável (service_role, org-scoped) para os dois, lida no mesmo multiget que já resolve
 *  a ponte, então não custa uma chamada extra ao ML. */
export interface ItemBridge {
  itemId: string;
  /** null quando o item local tem `variations[]` (não migrado para User Products) — não casa nunca. */
  userProductId: string | null;
  /** Preço de venda ATUAL do item no ML. null quando o ML não devolveu `price` (nunca vira 0). */
  precoAtualML: number | null;
  /** `category_id` do item no ML. null quando o ML não devolveu (preview-kit-virtual exige isso do principal). */
  categoriaMlId: string | null;
}

export interface CatalogoLocalItem {
  itemId: string;
  codigo: string | null;
  codigoPai: string | null;
  /** `variacoes.custo` — NUNCA `familias.custo_centavos` (custo de token de IA, não de produto). */
  custo: number | null;
  origem: 'nacional' | 'importado' | null;
  /** ADR-0154 D-9: não-null quando o componente é ele mesmo um kit vinculado (ADR-0151). */
  kitMultiplicador: number | null;
}

export interface ComponenteEnriquecido extends CandidatoBrutoML {
  itemId: string | null;
  codigo: string | null;
  codigoPai: string | null;
  custo: number | null;
  origem: 'nacional' | 'importado' | null;
  kitMultiplicador: number | null;
  /** Vem da ponte (`ItemBridge`), não do catálogo local — null quando o candidato não casou com item local. */
  precoAtualML: number | null;
  /** Idem. `preview-kit-virtual` exige isto do principal; sem ele, o front não pode liderar com este componente. */
  categoriaMlId: string | null;
}

export interface BuscarComponentesDeps {
  /** Uma página do buscador do ML. `searchAfterHash` null = primeira página. */
  buscarPagina: (searchAfterHash: string | null) => Promise<PaginaComponentesML>;
  /** Ids de item ML publicados pela org (familias.ml_item_id ∪ anuncios_externos_itens.item_externo_id). */
  listarItemIdsLocais: () => Promise<string[]>;
  /** Ponte user_product_id → item_id, já em lotes de 20 (limite do multiget do ML). */
  buscarUserProductIds: (itemIds: string[]) => Promise<ItemBridge[]>;
  /** Catálogo local (custo/origem/codigo/kit_multiplicador) dos item_ids informados. */
  buscarCatalogoLocal: (itemIds: string[]) => Promise<CatalogoLocalItem[]>;
}

export interface ResultadoBuscarComponentes {
  elegiveis: ComponenteEnriquecido[];
  inelegiveis: ComponenteEnriquecido[];
}

// Teto de segurança: o hash pode nunca repetir por bug do ML (medido no spike 036 — travou
// repetindo o mesmo hash, mas o inverso, nunca repetir, também é um jeito de vazar memória).
// Org maior hoje tem ~150 anúncios / ~50 por página ⇒ poucas páginas reais; 40 é folga generosa.
const MAX_PAGINAS = 40;

/**
 * Pagina o buscador do ML até o hash se repetir, faltar hash, ou uma página não trazer id novo
 * (o `search_after_hash` já observado no spike 036 pode repetir sem aviso — nunca confiar só em
 * "página vazia"). Deduplica por `userProductId` porque o ML pode reenviar itens já vistos.
 */
export async function buscarTodosComponentes(
  buscarPagina: BuscarComponentesDeps['buscarPagina'],
): Promise<CandidatoBrutoML[]> {
  const idsVistos = new Set<string>();
  const hashesVistos = new Set<string>();
  const produtos: CandidatoBrutoML[] = [];
  let hash: string | null = null;

  for (let i = 0; i < MAX_PAGINAS; i++) {
    const pagina = await buscarPagina(hash);
    let novos = 0;
    for (const p of pagina.produtos) {
      if (idsVistos.has(p.userProductId)) continue;
      idsVistos.add(p.userProductId);
      produtos.push(p);
      novos++;
    }
    const proximoHash = pagina.searchAfterHash;
    if (!proximoHash || hashesVistos.has(proximoHash) || novos === 0) break;
    hashesVistos.add(proximoHash);
    hash = proximoHash;
  }
  return produtos;
}

/** Enriquece cada candidato com o catálogo local, via a ponte user_product_id → item_id. */
export function enriquecerComponentes(
  candidatos: CandidatoBrutoML[],
  bridges: ItemBridge[],
  catalogo: CatalogoLocalItem[],
): ComponenteEnriquecido[] {
  const bridgePorUserProduct = new Map<string, ItemBridge>();
  for (const b of bridges) {
    if (b.userProductId) bridgePorUserProduct.set(b.userProductId, b);
  }
  const catalogoPorItemId = new Map(catalogo.map((c) => [c.itemId, c]));

  return candidatos.map((c): ComponenteEnriquecido => {
    const bridge = bridgePorUserProduct.get(c.userProductId) ?? null;
    const itemId = bridge?.itemId ?? null;
    const local = itemId ? catalogoPorItemId.get(itemId) ?? null : null;
    return {
      ...c,
      itemId,
      codigo: local?.codigo ?? null,
      codigoPai: local?.codigoPai ?? null,
      custo: local?.custo ?? null,
      origem: local?.origem ?? null,
      kitMultiplicador: local?.kitMultiplicador ?? null,
      precoAtualML: bridge?.precoAtualML ?? null,
      categoriaMlId: bridge?.categoriaMlId ?? null,
    };
  });
}

/** Orquestra busca no ML + ponte + catálogo local, e separa elegíveis de inelegíveis (D-12). */
export async function buscarComponentesKitVirtual(
  deps: BuscarComponentesDeps,
): Promise<ResultadoBuscarComponentes> {
  const [candidatos, itemIdsLocais] = await Promise.all([
    buscarTodosComponentes(deps.buscarPagina),
    deps.listarItemIdsLocais(),
  ]);

  const bridges = itemIdsLocais.length ? await deps.buscarUserProductIds(itemIdsLocais) : [];
  const itemIdsComUserProduct = bridges.filter((b) => b.userProductId).map((b) => b.itemId);
  const catalogo = itemIdsComUserProduct.length
    ? await deps.buscarCatalogoLocal(itemIdsComUserProduct)
    : [];

  const enriquecidos = enriquecerComponentes(candidatos, bridges, catalogo);
  return {
    elegiveis: enriquecidos.filter((c) => c.type === 'available'),
    inelegiveis: enriquecidos.filter((c) => c.type !== 'available'),
  };
}

// ─── Parsing do shape bruto do ML ──────────────────────────────────────────

interface ProdutoMLRaw {
  id?: string | null;
  title?: string | null;
  type?: string | null;
  thumbnail?: { secure_url?: string | null } | null;
  category_name?: string | null;
  stock?: { locations?: { quantity?: number | null }[] | null } | null;
  reasons?: { id?: string | null; message?: string | null }[] | null;
}

interface PaginaMLRaw {
  products?: ProdutoMLRaw[] | null;
  paging?: { search_after_hash?: string | null } | null;
}

function somarEstoque(stock: ProdutoMLRaw['stock']): number | null {
  const locations = stock?.locations;
  if (!locations || locations.length === 0) return null;
  return locations.reduce((total, l) => total + (l.quantity ?? 0), 0);
}

/** Normaliza a resposta bruta de `POST /kits/components/search` — pura, sem I/O. */
export function parsePaginaML(raw: unknown): PaginaComponentesML {
  const r = (raw ?? {}) as PaginaMLRaw;
  const produtos: CandidatoBrutoML[] = (r.products ?? [])
    .filter((p): p is ProdutoMLRaw & { id: string } => typeof p?.id === 'string' && p.id.length > 0)
    .map((p) => ({
      userProductId: p.id,
      title: p.title ?? '',
      type: p.type === 'available' ? 'available' : 'non_available',
      thumbnailUrl: p.thumbnail?.secure_url ?? null,
      categoryName: p.category_name ?? null,
      estoque: somarEstoque(p.stock),
      reasons: (p.reasons ?? [])
        .filter((x): x is { id: string; message: string } => typeof x?.id === 'string' && typeof x?.message === 'string'),
    }));
  return { produtos, searchAfterHash: r.paging?.search_after_hash ?? null };
}
