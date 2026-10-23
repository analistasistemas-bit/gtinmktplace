// Busca na Extensão PubliAI (ADR-0189 D-11/D-18, Task 21): casa os cards com os SKUs da organização em lote, só no
// banco (sem ML), na mesma prioridade do resolverVinculo; e a categoria do card só da oferta exata do item.
import { gtinOuNull } from '../produto/gtin.ts';
import type { EntradaAnuncio, RespostaAnuncio } from './analisar-anuncio.ts';
import type { FonteCusto, VariacaoCusto } from './vinculo.ts';

export interface DepsCasamento {
  /** catalog_product_id → variações da org com esse catálogo (mais de uma = ambíguo). */
  porCatalogos(orgId: string, cpids: string[]): Promise<Map<string, VariacaoCusto[]>>;
  porGtin(orgId: string, gtin: string): Promise<VariacaoCusto[]>;
  /** chave `${tipo}:${valor}` → variação do vínculo manual. */
  vinculosManuais(orgId: string, chaves: { tipo: 'catalogo' | 'item'; valor: string }[]): Promise<Map<string, VariacaoCusto>>;
}

export type Casamento = { fonte: FonteCusto; variacao: VariacaoCusto | null };

/** Catálogo → EAN da busca → vínculo manual (catálogo, depois item) → nenhuma. Etapa ambígua não escolhe. */
export async function casarCards(
  orgId: string,
  cards: { itemId: string; catalogProductId: string | null }[],
  eanDaBusca: string | null,
  deps: DepsCasamento,
): Promise<Map<string, Casamento>> {
  const cpids = [...new Set(cards.map((c) => c.catalogProductId).filter((c): c is string => !!c))];
  const chaves = [
    ...cpids.map((valor) => ({ tipo: 'catalogo' as const, valor })),
    ...cards.map((c) => ({ tipo: 'item' as const, valor: c.itemId })),
  ];
  const gtin = gtinOuNull(eanDaBusca);
  const [porCatalogo, porGtin, manuais] = await Promise.all([
    cpids.length ? deps.porCatalogos(orgId, cpids) : Promise.resolve(new Map<string, VariacaoCusto[]>()),
    gtin ? deps.porGtin(orgId, gtin) : Promise.resolve([] as VariacaoCusto[]),
    deps.vinculosManuais(orgId, chaves),
  ]);
  const r = new Map<string, Casamento>();
  for (const c of cards) {
    const doCatalogo = c.catalogProductId ? porCatalogo.get(c.catalogProductId) ?? [] : [];
    const manualCat = c.catalogProductId ? manuais.get(`catalogo:${c.catalogProductId}`) : undefined;
    const manualItem = manuais.get(`item:${c.itemId}`);
    r.set(c.itemId,
      doCatalogo.length === 1 ? { fonte: 'catalogo', variacao: doCatalogo[0] }
      : porGtin.length === 1 ? { fonte: 'ean_da_busca', variacao: porGtin[0] }
      : manualCat ? { fonte: 'vinculo_manual', variacao: manualCat }
      : manualItem ? { fonte: 'vinculo_manual', variacao: manualItem }
      : { fonte: 'nenhuma', variacao: null });
  }
  return r;
}

/** category_id da oferta exata do item em /products/{id}/items; nunca a maioria nem outra oferta. */
export function categoriaDaOferta(itens: unknown, itemId: string): string | null {
  const results = (itens as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results)) return null;
  const o = results.find((r) => (r as { item_id?: unknown })?.item_id === itemId) as { category_id?: unknown } | undefined;
  return typeof o?.category_id === 'string' && /^MLB\d+$/.test(o.category_id) ? o.category_id : null;
}

export interface DepsBusca extends DepsCasamento {
  /** /products/{id}/items (cacheado); null = falha de leitura. */
  ofertasDoCatalogo(cpid: string): Promise<unknown | null>;
  /** Debita 1 do limite de análises; false = esgotado (D-18). */
  reservar(): Promise<boolean>;
  /** Análise de um card casado ao preço do card, com EXATAMENTE o SKU do casamento (rótulo e margem iguais). */
  analisar(e: EntradaAnuncio, casamento: Casamento): Promise<RespostaAnuncio>;
}

type Base = { itemId: string };
export type ResultadoCard =
  | (Base & { estado: 'sem_vinculo' })
  | (Base & { estado: 'sem_categoria' | 'limite'; fonte: FonteCusto; codigo: string })
  | (Base & { estado: 'indisponivel'; fonte: FonteCusto; codigo: string; motivo: string })
  | (Base & { estado: 'ok'; fonte: FonteCusto; codigo: string; margem: RespostaAnuncio['margem']; custo: RespostaAnuncio['custo'] });

const LOTE = 5;

async function emLotes<T>(itens: T[], fazer: (t: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < itens.length; i += LOTE) await Promise.all(itens.slice(i, i + LOTE).map(fazer));
}

/** Casa todos os cards (banco, sem ML). Só os casados COM catálogo reservam a cota, na ordem da busca; depois disso
 *  (e só então) leem as ofertas do catálogo e são analisados, em lotes de 5. */
export async function analisarBusca(
  orgId: string,
  pedido: { eanDaBusca: string | null; itens: { itemId: string; catalogProductId: string | null; preco: number }[] },
  deps: DepsBusca,
): Promise<{ itens: ResultadoCard[]; limiteAtingido: boolean }> {
  const casamentos = await casarCards(orgId, pedido.itens, pedido.eanDaBusca, deps);
  const resultado = new Map<string, ResultadoCard>();
  const reservados: { item: (typeof pedido.itens)[number]; casamento: Casamento; codigo: string }[] = [];
  let limiteAtingido = false;
  for (const item of pedido.itens) {
    const c = casamentos.get(item.itemId);
    if (!c?.variacao) { resultado.set(item.itemId, { itemId: item.itemId, estado: 'sem_vinculo' }); continue; }
    const base = { itemId: item.itemId, fonte: c.fonte, codigo: c.variacao.codigo };
    // Sem catálogo não há como achar a categoria da oferta: não gasta cota nem ML.
    if (!item.catalogProductId) { resultado.set(item.itemId, { ...base, estado: 'sem_categoria' }); continue; }
    if (limiteAtingido || !(await deps.reservar())) { limiteAtingido = true; resultado.set(item.itemId, { ...base, estado: 'limite' }); continue; }
    reservados.push({ item, casamento: c, codigo: c.variacao.codigo });
  }
  // Uma leitura de ofertas por catálogo (vários cards podem ser do mesmo), só dos reservados.
  const ofertas = new Map<string, unknown | null>();
  await emLotes([...new Set(reservados.map((r) => r.item.catalogProductId!))], async (cpid) => {
    ofertas.set(cpid, await deps.ofertasDoCatalogo(cpid).catch(() => null));
  });
  await emLotes(reservados, async ({ item, casamento, codigo }) => {
    const base = { itemId: item.itemId, fonte: casamento.fonte, codigo };
    const categoriaId = categoriaDaOferta(ofertas.get(item.catalogProductId!), item.itemId);
    if (!categoriaId) { resultado.set(item.itemId, { ...base, estado: 'sem_categoria' }); return; }
    try {
      const r = await deps.analisar({
        mlItemId: item.itemId, sellerId: '', catalogProductId: item.catalogProductId, categoriaId, preco: item.preco, eanDaBusca: pedido.eanDaBusca,
      }, casamento);
      resultado.set(item.itemId, { ...base, estado: 'ok', margem: r.margem, custo: r.custo });
    } catch {
      resultado.set(item.itemId, { ...base, estado: 'indisponivel', motivo: 'falha ao consultar o Mercado Livre' });
    }
  });
  return { itens: pedido.itens.map((i) => resultado.get(i.itemId)!), limiteAtingido };
}
