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
  const ini = nordic?.indexOf('_n.ctx.r =') ?? -1;
  const fim = nordic ? nordic.indexOf(';_n.ctx.r.assets', ini) : -1;
  if (nordic && ini >= 0 && fim > ini) {
    const r = parse(nordic.slice(ini + '_n.ctx.r ='.length, fim));
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

export function lerAnuncio(doc: Document): ResultadoLeitura {
  const estado = lerJson(doc);
  if (!estado) return { ok: false, motivo: 'estado_nao_encontrado' };

  // Só caminhos medidos (2026-10-21); sem busca global para id/vendedor/categoria/preço (valor financeiro: falha em vez de adivinhar).
  const ev = get(estado, 'track', 'melidata_event', 'event_data');
  const comps = get(estado, 'components');
  const primeiro = <T>(...c: T[]) => c.find((v) => v !== undefined && v !== null && v !== '');

  const mlItemId = [estado.id, get(ev, 'item_id')].find(ehMlb);
  if (!mlItemId) return { ok: false, motivo: 'campo_ausente:mlItemId' };

  const sellerData = lista(get(comps, 'content_right')).find((c) => c.id === 'seller_data');
  const sellerId = primeiro(get(ev, 'seller_id'), get(sellerData, 'viewport_track', 'melidata_event', 'event_data', 'seller_id'));
  if (sellerId === undefined) return { ok: false, motivo: 'campo_ausente:sellerId' };

  const categoriaId = [...lista(get(comps, 'head')), ...lista(get(comps, 'content_right'))]
    .map((c) => get(c, 'carousel_config', 'category_id'))
    .concat(get(ev, 'category_id'))
    .find(ehMlb);
  if (!categoriaId) return { ok: false, motivo: 'campo_ausente:categoriaId' };

  // Catálogo só nos caminhos medidos na página real (2026-10-21); valores como "not_apply"/""/"none" → próximo, senão null.
  const reviews = lista(get(comps, 'short_description'))
    .map((c) => get(c, 'reviews', 'action', 'track', 'melidata_event', 'event_data', 'catalog_product_id'))
    .find((v) => v !== undefined);
  const carrossel = lista(get(comps, 'head')).find((c) => c.id === 'carousel_up_web');
  const catalogProductId =
    ([get(ev, 'catalog_product_id'), reviews, get(carrossel, 'carousel_config', 'product_id')].find(ehMlb) as string | undefined) ?? null;

  // preço: só componente id 'price' de short_description[] -> action.track.melidata_event.event_data.price (número ou {value|amount})
  const compPreco = lista(get(comps, 'short_description')).find((c) => c.id === 'price');
  const p = get(compPreco, 'action', 'track', 'melidata_event', 'event_data', 'price');
  const preco = ehObj(p) ? (numero(p.value) > 0 ? numero(p.value) : numero(p.amount)) : numero(p);
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
