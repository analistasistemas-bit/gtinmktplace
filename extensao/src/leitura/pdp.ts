import type { EntradaAnuncio } from '../../../supabase/functions/_shared/extensao/analisar-anuncio.ts';

// Caminhos usados (observados em 2026-10-21), todos tolerantes à variação por componente:
//  script#__NORDIC_RENDERING_CTX__ -> texto `_n.ctx.r = {...};_n.ctx.r.assets` -> appProps.pageProps.initialState
//  fallback: script#__PRELOADED_STATE__ (JSON, com ou sem `initialState`)
//  item: initialState.id, depois track.melidata_event.event_data.item_id
//  vendedor: event_data.seller_id, depois content_right[id=seller_data].viewport_track…seller_id
//  categoria: carousel_config.category_id de head[]/content_right[], depois event_data.category_id
//  catálogo: 1º MLB\d+ entre event_data.catalog_product_id, short_description[] com
//            reviews.action.track.melidata_event.event_data.catalog_product_id e head[id=carousel_up_web].carousel_config.product_id
//  preço: short_description[id=price].action.track.melidata_event.event_data.price
// Layout /up/ (medido em 2026-10-22): `_n.ctx.r={` sem espaços; initialState.id = MLBU… (user product, não item);
//  components é objeto indexado por id: components.track.melidata_event.event_data (item/vendedor/categoria/
//  catálogo/preço), components.price, components.seller_data, components.carousel_up_web e
//  components.header.reviews…catalog_product_id. Preço do evento só se o item_id dele é o do anúncio.
//  Nenhum desses campos usa busca global (um recomendado com id válido casaria o SKU errado).
//  vendidos: chave `subtitle_label.text`; título: <h1>, og:title ou chave `title`.

export type DadosAnuncio = Omit<EntradaAnuncio, 'eanDaBusca'> & { vendidosTexto: string | null; titulo: string };
export type ResultadoLeitura = { ok: true; dados: DadosAnuncio } | { ok: false; motivo: string };

type Obj = Record<string, unknown>;
const ehObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function parse(t: string | null | undefined): Obj | null {
  try {
    return t ? (JSON.parse(t) as Obj) : null;
  } catch {
    return null; // JSON inválido
  }
}

function lerJson(doc: Document): Obj | null {
  const nordic = doc.getElementById('__NORDIC_RENDERING_CTX__')?.textContent;
  const m = nordic ? /_n\.ctx\.r\s*=\s*/.exec(nordic) : null;
  const ini = m ? m.index + m[0].length : -1;
  const fim = nordic && m ? nordic.indexOf(';_n.ctx.r.assets', ini) : -1;
  if (nordic && ini >= 0 && fim > ini) {
    const r = parse(nordic.slice(ini, fim));
    const s = (r?.appProps as Obj | undefined)?.pageProps as Obj | undefined;
    if (ehObj(s?.initialState)) return s.initialState;
  }
  const r = parse(doc.getElementById('__PRELOADED_STATE__')?.textContent);
  return r && (ehObj(r.initialState) ? r.initialState : r);
}

const ehMlb = (v: unknown) => typeof v === 'string' && /^MLB\d+$/.test(v);
const numero = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN);
const get = (o: unknown, ...caminho: string[]): unknown => caminho.reduce<unknown>((a, k) => (ehObj(a) ? a[k] : undefined), o);
const lista = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(ehObj) : []);

function buscar(raiz: unknown, chave: string, ok: (v: unknown) => boolean, prof = 12): unknown {
  if (prof < 0 || typeof raiz !== 'object' || raiz === null) return undefined;
  if (!Array.isArray(raiz) && ok((raiz as Obj)[chave])) return (raiz as Obj)[chave];
  for (const v of Object.values(raiz)) {
    const r = buscar(v, chave, ok, prof - 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

/** Página de catálogo (`/<slug>/p/MLB…`): o id da página é o catálogo, não um item. */
export const ehPaginaCatalogo = (caminho: string) => /\/p\/MLB\d+/.test(caminho);

export function lerAnuncio(doc: Document, caminho = doc.location?.pathname ?? ''): ResultadoLeitura {
  const estado = lerJson(doc);
  if (!estado) return { ok: false, motivo: 'estado_nao_encontrado' };

  // Só caminhos medidos (2026-10-21); sem busca global para id/vendedor/categoria/preço (valor financeiro: falha em vez de adivinhar).
  const comps = get(estado, 'components');
  const evComp = get(comps, 'track', 'melidata_event', 'event_data');
  const ev = get(estado, 'track', 'melidata_event', 'event_data') ?? evComp;
  // Componente pelo id: nas listas antigas (head[]/short_description[]/content_right[]) ou no objeto indexado (/up/).
  const porId = (id: string, ...listas: string[]): Obj | undefined => {
    const c = listas.flatMap((l) => lista(get(comps, l))).find((x) => x.id === id) ?? get(comps, id);
    return ehObj(c) ? c : undefined;
  };
  const primeiro = <T>(...c: T[]) => c.find((v) => v !== undefined && v !== null && v !== '');

  // Catálogo só nos caminhos medidos na página real (2026-10-21); valores como "not_apply"/""/"none" → próximo, senão null.
  const reviews = lista(get(comps, 'short_description'))
    .map((c) => get(c, 'reviews', 'action', 'track', 'melidata_event', 'event_data', 'catalog_product_id'))
    .find((v) => v !== undefined) ?? get(comps, 'header', 'reviews', 'action', 'track', 'melidata_event', 'event_data', 'catalog_product_id');
  const carrossel = porId('carousel_up_web', 'head');
  const catalogProductId =
    ([get(ev, 'catalog_product_id'), reviews, get(carrossel, 'carousel_config', 'product_id')].find(ehMlb) as string | undefined) ?? null;

  // Item = o do evento da página (no catálogo, o vencedor da buy box). `estado.id` só como reserva: em /p/ ele é o
  // catálogo, em /up/ é MLBU (user product) — nunca item. alternative_buying_options (outras ofertas) nunca é lido.
  const mlItemId = [get(ev, 'item_id'), ehPaginaCatalogo(caminho) || estado.id === catalogProductId ? undefined : estado.id].find(ehMlb);
  if (!mlItemId) return { ok: false, motivo: 'campo_ausente:mlItemId' };

  const sellerData = porId('seller_data', 'content_right');
  const sellerId = primeiro(get(ev, 'seller_id'), get(sellerData, 'viewport_track', 'melidata_event', 'event_data', 'seller_id'));
  if (sellerId === undefined) return { ok: false, motivo: 'campo_ausente:sellerId' };

  const categoriaId = [...lista(get(comps, 'head')), ...lista(get(comps, 'content_right')), get(comps, 'carousel_up_web')]
    .map((c) => get(c, 'carousel_config', 'category_id'))
    .concat(get(ev, 'category_id'))
    .find(ehMlb);
  if (!categoriaId) return { ok: false, motivo: 'campo_ausente:categoriaId' };

  // preço: componente id 'price' (short_description[] ou objeto) -> action.track.melidata_event.event_data.price
  // (número ou {value|amount}); sem ele, o do evento de components.track só se o item_id dele é o do anúncio.
  const valor = (p: unknown) => (ehObj(p) ? (numero(p.value) > 0 ? numero(p.value) : numero(p.amount)) : numero(p));
  const evPreco = get(porId('price', 'short_description'), 'action', 'track', 'melidata_event', 'event_data');
  const itemDoPreco = get(evPreco, 'item_id');
  let preco = itemDoPreco === undefined || itemDoPreco === mlItemId ? valor(get(evPreco, 'price')) : NaN; // preço de outro item: recusa
  if (!(preco > 0) && get(evComp, 'item_id') === mlItemId) preco = valor(get(evComp, 'price'));
  if (!(preco > 0)) return { ok: false, motivo: 'campo_ausente:preco' };

  const sub = buscar(estado, 'subtitle_label', ehObj) as Obj | undefined;
  const vendidosTexto = typeof sub?.text === 'string' ? (sub.text.match(/\+?[\d.,]+\s*(?:mil\s+)?vendidos?/i)?.[0] ?? null) : null;
  const titulo =
    doc.querySelector('h1')?.textContent?.trim() ||
    doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
    (buscar(estado, 'title', (v) => typeof v === 'string' && v !== '') as string | undefined) ||
    '';

  return {
    ok: true,
    dados: {
      mlItemId: mlItemId as string,
      sellerId: String(sellerId),
      catalogProductId,
      categoriaId: String(categoriaId),
      preco,
      vendidosTexto,
      titulo,
    },
  };
}
