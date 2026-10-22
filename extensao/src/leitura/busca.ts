// Leitura da busca do ML (ADR-0189 D-11, Task 20). O estado da página de busca vem num serializador próprio do ML
// (não JSON); a fonte é o DOM dos `.poly-card`, como o Avant. Medido em 22/10 (lista.mercadolivre.com.br):
//  item: `wid` no fragmento do link do título (vale também para o patrocinado, que passa por click1 com pdp_filters)
//  catálogo: caminho `/p/MLB…`; produto do vendedor: `/up/MLBU…`; patrocinado: fragmento is_advertising=true ou
//  `a.poly-component__ads-promotions`; preço: `.poly-price__current .andes-money-amount__fraction/__cents`;
//  nota e vendidos: `.poly-component__review-compacted`; frete grátis: `span.polylabel-label`; Full e loja oficial:
//  svg com aria-label "Enviado pelo FULL" / "Loja oficial". Nada é lido dentro de elementos injetados por outras
//  extensões (ex.: `.avantpro-product-container`). Selo ausente = null (desconhecido), nunca `false` (consultor, 22/10).

export interface CardBusca {
  itemId: string;
  catalogProductId: string | null;
  userProductId: string | null;
  posicao: number | null;
  titulo: string;
  /** null = preço ilegível (nunca zero). */
  preco: number | null;
  vendedor: string | null;
  nota: number | null;
  /** Texto observado ("+10mil vendidos"): piso da faixa, não quantidade exata. */
  vendidosTexto: string | null;
  freteGratis: true | null;
  full: true | null;
  lojaOficial: true | null;
  patrocinado: boolean;
  selos: string[];
}

const MLB = /^MLB\d{6,20}$/;
const HOSTS = new Set(['www.mercadolivre.com.br', 'produto.mercadolivre.com.br', 'click1.mercadolivre.com.br']);
const INJETADO = '.avantpro-product-container';

/** Elementos do card que são do ML (descarta subárvores injetadas por outras extensões). */
function doMl(card: Element, seletor: string): Element[] {
  return [...card.querySelectorAll(seletor)].filter((e) => !e.closest(INJETADO));
}
const texto = (e: Element | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

function lerLink(href: string): Pick<CardBusca, 'itemId' | 'catalogProductId' | 'userProductId' | 'posicao'> & { anuncio: boolean } | null {
  let u: URL;
  try { u = new URL(href); } catch { return null; }
  if (u.protocol !== 'https:' || !HOSTS.has(u.host)) return null;
  const frag = new URLSearchParams(u.hash.slice(1));
  const pdp = /^item_id:(MLB\d+)$/.exec(u.searchParams.get('pdp_filters') ?? '')?.[1] ?? null;
  const itemId = frag.get('wid') ?? pdp;
  if (!itemId || !MLB.test(itemId) || (pdp && pdp !== itemId)) return null;
  const cat = /\/p\/(MLB\d+)(?:\/|$)/.exec(u.pathname)?.[1] ?? null;
  const up = /\/up\/(MLBU\d+)(?:\/|$)/.exec(u.pathname)?.[1] ?? null;
  const pos = Number(frag.get('position'));
  return {
    itemId, catalogProductId: cat, userProductId: up,
    posicao: Number.isInteger(pos) && pos > 0 ? pos : null,
    anuncio: frag.get('is_advertising') === 'true',
  };
}

function lerPreco(card: Element): number | null {
  const atual = doMl(card, '.poly-price__current')[0];
  const frac = texto(atual?.querySelector('.andes-money-amount__fraction') ?? undefined).replace(/\./g, '');
  const cents = texto(atual?.querySelector('.andes-money-amount__cents') ?? undefined);
  if (!/^\d{1,9}$/.test(frac) || (cents && !/^\d{2}$/.test(cents))) return null;
  return Number(frac) + (cents ? Number(cents) / 100 : 0);
}

export function lerBusca(doc: Document): CardBusca[] {
  // O mesmo item aparece como patrocinado e como orgânico: uma entrada só, completando o que a outra não trouxe
  // (o patrocinado passa por click1 e não tem o /p/ do catálogo).
  const porItem = new Map<string, CardBusca>();
  for (const card of doc.querySelectorAll('.poly-card')) {
    if (card.closest(INJETADO)) continue;
    const titulo = doMl(card, 'a.poly-component__title')[0];
    const link = titulo ? lerLink(titulo.getAttribute('href') ?? '') : null;
    if (!link) continue;
    const review = texto(doMl(card, '.poly-component__review-compacted')[0]);
    const nota = Number(/^(\d(?:[.,]\d)?)\b/.exec(review)?.[1]?.replace(',', '.'));
    const vendidos = /\+?\d+(?:[.,]\d+)?\s*(?:mil\s*)?vendidos?/i.exec(review)?.[0]?.replace(/\s+/g, ' ') ?? null;
    const aria = (rotulo: RegExp, onde = card) => doMl(onde, '[aria-label]').some((e) => rotulo.test(e.getAttribute('aria-label') ?? ''));
    const vendedorEl = doMl(card, '.poly-component__seller')[0];
    const lido: CardBusca = {
      itemId: link.itemId,
      catalogProductId: link.catalogProductId,
      userProductId: link.userProductId,
      posicao: link.posicao,
      titulo: texto(titulo),
      preco: lerPreco(card),
      vendedor: texto(vendedorEl) || null,
      nota: Number.isFinite(nota) && nota > 0 && nota <= 5 ? nota : null,
      vendidosTexto: vendidos,
      freteGratis: doMl(card, '.polylabel-label').some((e) => /^frete gr[áa]tis$/i.test(texto(e))) || null,
      full: aria(/^enviado pelo full$/i) || null,
      lojaOficial: (vendedorEl ? aria(/^loja oficial$/i, vendedorEl) : false) || null,
      patrocinado: link.anuncio || doMl(card, 'a.poly-component__ads-promotions[aria-label="Patrocinado"]').length > 0,
      selos: doMl(card, '.poly-component__poly-label').map((e) => texto(e)).filter(Boolean),
    };
    const ja = porItem.get(lido.itemId);
    if (!ja) { porItem.set(lido.itemId, lido); continue; }
    const completar = <K extends keyof CardBusca>(k: K) => { if (ja[k] === null) ja[k] = lido[k]; };
    for (const k of ['catalogProductId', 'userProductId', 'posicao', 'preco', 'vendedor', 'nota', 'vendidosTexto', 'freteGratis', 'full', 'lojaOficial'] as const) completar(k);
    ja.patrocinado ||= lido.patrocinado;
    ja.selos = [...new Set([...ja.selos, ...lido.selos])];
  }
  return [...porItem.values()];
}
