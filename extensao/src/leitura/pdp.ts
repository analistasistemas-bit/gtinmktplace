import type { EntradaAnuncio } from '../../../supabase/functions/_shared/extensao/analisar-anuncio.ts';

// Caminhos usados (observados em 2026-10-21), todos tolerantes à variação por componente:
//  script#__NORDIC_RENDERING_CTX__ -> texto `_n.ctx.r = {...};_n.ctx.r.assets` -> appProps.pageProps.initialState
//  fallback: script#__PRELOADED_STATE__ (JSON, com ou sem `initialState`)
//  ids: initialState.{item_id|id}, depois track.melidata_event.event_data.{item_id,seller_id,category_id,catalog_product_id,price},
//       depois busca recursiva limitada (profundidade 12) pela mesma chave.
//  vendidos: chave `subtitle_label.text`; título: <h1>, og:title ou chave `title`.

export type DadosAnuncio = Omit<EntradaAnuncio, 'eanDaBusca'> & { vendidosTexto: string | null; titulo: string };
export type ResultadoLeitura = { ok: true; dados: DadosAnuncio } | { ok: false; motivo: string };

type Obj = Record<string, unknown>;
const ehObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function lerJson(doc: Document): Obj | null {
  try {
    const nordic = doc.getElementById('__NORDIC_RENDERING_CTX__')?.textContent;
    if (nordic) {
      const ini = nordic.indexOf('_n.ctx.r =');
      const fim = nordic.indexOf(';_n.ctx.r.assets');
      if (ini >= 0 && fim > ini) {
        const r = JSON.parse(nordic.slice(ini + '_n.ctx.r ='.length, fim)) as Obj;
        const s = (r.appProps as Obj | undefined)?.pageProps as Obj | undefined;
        if (ehObj(s?.initialState)) return s.initialState;
      }
    }
    const pre = doc.getElementById('__PRELOADED_STATE__')?.textContent;
    if (pre) {
      const r = JSON.parse(pre) as Obj;
      return ehObj(r.initialState) ? r.initialState : r;
    }
  } catch {
    /* JSON inválido = estado não encontrado */
  }
  return null;
}

function buscar(raiz: unknown, chave: string, ok: (v: unknown) => boolean, prof = 12): unknown {
  if (prof < 0 || typeof raiz !== 'object' || raiz === null) return undefined;
  if (!Array.isArray(raiz) && ok((raiz as Obj)[chave])) return (raiz as Obj)[chave];
  for (const v of Object.values(raiz)) {
    const r = buscar(v, chave, ok, prof - 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

const ehMlb = (v: unknown) => typeof v === 'string' && /^MLB\d+$/.test(v);

function coletar(raiz: unknown, ok: (k: string, v: unknown) => boolean, prof = 14, out: unknown[] = []): unknown[] {
  if (prof < 0 || typeof raiz !== 'object' || raiz === null) return out;
  for (const [k, v] of Object.entries(raiz)) {
    if (ok(k, v)) out.push(v);
    coletar(v, ok, prof - 1, out);
  }
  return out;
}

const texto = (v: unknown) => (typeof v === 'string' && v !== '') || typeof v === 'number';
const numero = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN);

export function lerAnuncio(doc: Document): ResultadoLeitura {
  const estado = lerJson(doc);
  if (!estado) return { ok: false, motivo: 'estado_nao_encontrado' };

  const evento = ((estado.track as Obj | undefined)?.melidata_event as Obj | undefined)?.event_data;
  const campo = (chaves: string[], ok: (v: unknown) => boolean = texto): unknown => {
    for (const fonte of [estado, evento]) {
      for (const k of chaves) if (ehObj(fonte) && ok(fonte[k])) return fonte[k];
    }
    for (const k of chaves) {
      const v = buscar(estado, k, ok);
      if (v !== undefined) return v;
    }
    return undefined;
  };

  const mlItemId = campo(['item_id', 'id'], (v) => typeof v === 'string' && /^MLB\d+$/.test(v));
  if (mlItemId === undefined) return { ok: false, motivo: 'campo_ausente:mlItemId' };
  const sellerId = campo(['seller_id']);
  if (sellerId === undefined) return { ok: false, motivo: 'campo_ausente:sellerId' };
  const categoriaId = campo(['category_id'], ehMlb);
  if (categoriaId === undefined) return { ok: false, motivo: 'campo_ausente:categoriaId' };

  // Valores divergem entre componentes ("not_apply", "", "none"): primeiro que casar MLB\d+, senão null.
  const catalogProductId =
    (coletar(estado, (k, v) => (k === 'catalog_product_id' || (k === 'product_id' && /^MLB\d+$/.test(String(v)))) && ehMlb(v))[0] as string | undefined) ?? null;

  // preço: componente id 'price' (short_description[]) -> action.track.melidata_event.event_data.price
  const comps = (estado.components as Obj | undefined)?.short_description;
  const compPreco = Array.isArray(comps) ? comps.find((c) => ehObj(c) && c.id === 'price') : undefined;
  const precoComp = numero(buscar(compPreco, 'price', (v) => numero(v) > 0));
  // preço: número direto ou objeto { value | amount }
  let preco = precoComp > 0 ? precoComp : numero(campo(['price'], (v) => numero(v) > 0));
  if (!(preco > 0)) {
    const o = campo(['price'], (v) => ehObj(v) && (numero(v.value) > 0 || numero(v.amount) > 0)) as Obj | undefined;
    preco = o ? (numero(o.value) > 0 ? numero(o.value) : numero(o.amount)) : NaN;
  }
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
