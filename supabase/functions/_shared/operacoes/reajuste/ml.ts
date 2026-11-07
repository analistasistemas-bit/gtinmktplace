// I5 — cliente ML do reajuste de preço em massa. Única escrita: o PUT de preço (Legacy: mesmo preço em
// todas as variações; plano/UP: {price}). 401/403 → SemAcessoStatusML (reconectar a conta).
import { caminhoMultiget, comoEnvelopeAntigo } from '../../ml/multiget.ts';
import { SemAcessoStatusML } from '../ml-status.ts';
import { oferta } from './ofertas.ts';
import type { OfertaVigente, VivoItem } from './tipos.ts';

export type ResultadoPut = { kind: 'ok' } | { kind: 'sem_escrita'; status: number; mensagem: string } | { kind: 'desconhecido'; mensagem: string };
export interface ClienteReajusteML {
  lerVivo(itemId: string): Promise<VivoItem>;
  putPreco(itemId: string, alvo: number, variacaoIds: string[] | null): Promise<ResultadoPut>;
  /** null = inconclusivo, nunca "sem ofertas". */
  lerOfertas(itemId: string): Promise<OfertaVigente[] | null>;
}

const API = 'https://api.mercadolibre.com';
const TIMEOUT_PUT_MS = 15_000;
const ATIVA = new Set(['pending', 'started']);
/** Status fora desta lista (vazio inclusive) torna a leitura inconclusiva: não dá para dizer que a oferta não vale. */
const STATUS_OFERTA = new Set([...ATIVA, 'candidate', 'finished']);
// ponytail: teto da paginação por item_id (o ML devolve 1 linha); passou disso é inconclusivo, não "sem ofertas".
const MAX_PAGINAS_CAMPANHA = 10;
const semAcesso = (s: number) => s === 401 || s === 403;

type ItemML = {
  price?: unknown; status?: unknown; sub_status?: unknown; catalog_listing?: unknown;
  variations?: { id: unknown; price: unknown }[]; item_relations?: unknown[];
};
type PromoML = {
  id?: unknown; type?: unknown; status?: unknown; price?: unknown; offer_id?: unknown; ref_id?: unknown;
  start_date?: unknown; finish_date?: unknown;
};

const texto = (x: unknown) => (typeof x === 'string' && x ? x : null);
const precoPositivo = (x: unknown) => { const n = Number(x); return x != null && Number.isFinite(n) && n > 0 ? n : null; };

/** `promo` é a entrada da visão por item; `x` traz status e preço (ela mesma, ou o item na visão da campanha). */
const ofertaDe = (promo: PromoML, x: PromoML) => {
  const ref = texto(x.ref_id);
  return oferta({
    promocao_id: texto(promo.id) ?? String(promo.type), tipo: String(promo.type), status: x.status as OfertaVigente['status'],
    preco: precoPositivo(x.price), offer_id: texto(x.offer_id) ?? (ref?.startsWith('OFFER-') ? ref : null),
    inicio: texto(x.start_date) ?? texto(promo.start_date), fim: texto(x.finish_date) ?? texto(promo.finish_date),
  });
};

export function criarClienteReajusteML(token: string, f: typeof fetch = fetch): ClienteReajusteML {
  const auth = { Authorization: `Bearer ${token}` };
  const get = (path: string) => f(`${API}${path}`, { headers: auth });
  // /seller-promotions responde 409 transitório.
  const getOferta = async (path: string) => {
    const r = await get(path);
    return r.status === 409 ? get(path) : r;
  };
  /** Todas as páginas do item na campanha; null se alguma não foi lida. O ML pode devolver cursor na última página. */
  const itensNaCampanha = async (path: string): Promise<PromoML[] | null> => {
    const itens: PromoML[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < MAX_PAGINAS_CAMPANHA; i++) {
      const r: Response = await getOferta(cursor ? `${path}&search_after=${encodeURIComponent(cursor)}` : path);
      if (r.status !== 200) return null;
      const j = (await r.json()) as { results?: unknown; paging?: { searchAfter?: unknown; search_after?: unknown } } | null;
      if (!Array.isArray(j?.results)) return null;
      itens.push(...(j.results as PromoML[]));
      const prox = texto(j.paging?.searchAfter) ?? texto(j.paging?.search_after);
      if (!prox || !j.results.length) return itens;
      if (prox === cursor) return null;
      cursor = prox;
    }
    return null;
  };

  return {
    async lerVivo(itemId) {
      const r = await get(caminhoMultiget([itemId], 'id,price,status,sub_status,variations,catalog_listing,item_relations'));
      if (semAcesso(r.status)) throw new SemAcessoStatusML(`ML ${r.status} ao ler o anúncio`);
      if (!r.ok) throw new Error(`ML ${r.status} ao ler o anúncio ${itemId}`);
      const lote = comoEnvelopeAntigo(await r.json(), [itemId]);
      const x = (Array.isArray(lote) ? lote[0] : undefined) as { code?: number; body?: ItemML } | undefined;
      if (x?.code === 401 || x?.code === 403) throw new SemAcessoStatusML(`ML ${x.code} ao ler o anúncio`);
      const b = x?.code === 200 ? x.body : undefined;
      if (!b) throw new Error('ML não devolveu o anúncio');
      const vs = Array.isArray(b.variations) ? b.variations : [];
      return {
        preco: b.price == null ? null : Number(b.price),
        variacoes: vs.length ? vs.map((v) => ({ id: String(v.id), preco: Number(v.price) })) : null,
        status: String(b.status ?? ''),
        sub_status: Array.isArray(b.sub_status) ? b.sub_status.map(String) : [],
        catalog_listing: b.catalog_listing === true,
        tem_relacoes: Array.isArray(b.item_relations) && b.item_relations.length > 0,
      };
    },

    async putPreco(itemId, alvo, variacaoIds) {
      const body = variacaoIds
        ? { variations: variacaoIds.map((id) => ({ id: Number(id), price: alvo })) }
        : { price: alvo };
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), TIMEOUT_PUT_MS);
      let r: Response;
      try {
        r = await f(`${API}/items/${encodeURIComponent(itemId)}`, {
          method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal,
        });
      } catch (e) {
        return { kind: 'desconhecido', mensagem: e instanceof Error ? e.message : String(e) };
      } finally {
        clearTimeout(t);
      }
      if (r.status === 200 || r.status === 201) return { kind: 'ok' };
      if (semAcesso(r.status)) throw new SemAcessoStatusML(`ML ${r.status} ao alterar o preço`);
      const msg = await r.json().then((j) => (j as { message?: unknown })?.message, () => undefined);
      const mensagem = typeof msg === 'string' && msg ? msg : `ML ${r.status}`;
      // ponytail: 5xx e demais → desconhecido (a escrita pode ter acontecido; quem chama relê o vivo).
      if (r.status >= 400 && r.status < 500) return { kind: 'sem_escrita', status: r.status, mensagem };
      return { kind: 'desconhecido', mensagem };
    },

    async lerOfertas(itemId) {
      const id = encodeURIComponent(itemId);
      try {
        const r = await getOferta(`/seller-promotions/items/${id}?app_version=v2`);
        if (r.status !== 200) return null;
        const promos = await r.json();
        if (!Array.isArray(promos)) return null;
        const ofertas: OfertaVigente[] = [];
        for (const p of promos as PromoML[]) {
          if (!STATUS_OFERTA.has(p?.status as string)) return null;
          if (ATIVA.has(p.status as string)) ofertas.push(ofertaDe(p, p));
          // A visão por item atrasa: candidate aqui pode já participar. Sem id (PRICE_DISCOUNT) não é campanha.
          if (p.status !== 'candidate' || !texto(p.id)) continue;
          const itens = await itensNaCampanha(`/seller-promotions/promotions/${encodeURIComponent(String(p.id))}/items?promotion_type=${encodeURIComponent(String(p.type))}&item_id=${id}&app_version=v2`);
          if (!itens) return null;
          for (const x of itens) {
            if (!STATUS_OFERTA.has(x?.status as string)) return null;
            if (ATIVA.has(x.status as string)) ofertas.push(ofertaDe(p, x));
          }
        }
        return ofertas;
      } catch {
        return null;
      }
    },
  };
}
