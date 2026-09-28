// ADR-0174 — cliente ML do motor de operações em massa: leitura fresca na VISÃO DA CAMPANHA (a visão por item
// atrasa) e escrita em /seller-promotions. 401/403 em qualquer chamada → SemEscritaPromocoes (reconectar a conta).
import type { ItemNaCampanha, Relacoes, TipoPromocao } from './tipos.ts';

type Obj = Record<string, unknown>;
export class SemEscritaPromocoes extends Error {}
export interface ClienteML {
  lerNaCampanha(promocaoId: string, tipo: TipoPromocao, itemId: string): Promise<ItemNaCampanha | null>;
  lerRelacoes(itemId: string): Promise<Relacoes>;
  post(itemId: string, body: Record<string, unknown>): Promise<{ offer_id: string | null }>;
  del(itemId: string, query: string): Promise<void>;
}

const API = 'https://api.mercadolibre.com';
const TENTATIVAS = 3; // a visão da campanha devolve 500 intermitente (spike: 2 em ~25 leituras)
const num = (x: unknown): number | null => {
  const n = Number(x);
  return x == null || x === '' || !Number.isFinite(n) ? null : n;
};
const str = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null);
const lista = (x: unknown): Obj[] => (Array.isArray(x) ? (x as Obj[]) : []);
const ids = (xs: string[]) => xs.map(encodeURIComponent).join(',');
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function criarClienteML(token: string, f: typeof fetch = fetch, esperar: (ms: number) => Promise<void> = dormir): ClienteML {
  // Token só no header; mensagens de erro citam status e rota, nunca o token.
  const chamar = async (method: string, path: string, body?: unknown): Promise<Response> => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await f(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 401 || r.status === 403) throw new SemEscritaPromocoes(`ML ${r.status} em ${path.split('?')[0]}`);
    return r;
  };
  const falha = async (r: Response): Promise<Error> => {
    const corpo = (await r.json().catch(() => null)) as Obj | null;
    return new Error(`ML ${r.status}: ${(str(corpo?.message) ?? r.statusText ?? '').slice(0, 200)}`);
  };
  const multiget = async (xs: string[], atributos: string): Promise<Map<string, Obj>> => {
    // ponytail: um bloco só (limite de 20 ids do ML); relações de um item são 1–2 na prática.
    const r = await chamar('GET', `/items?ids=${ids(xs)}&attributes=${atributos}`);
    if (!r.ok) throw await falha(r);
    const m = new Map<string, Obj>();
    for (const x of lista(await r.json())) {
      const b = x.body as Obj | null;
      if (x.code === 200 && b && typeof b === 'object') m.set(String(b.id), b);
    }
    return m;
  };

  return {
    async lerNaCampanha(promocaoId, tipo, itemId) {
      const path = `/seller-promotions/promotions/${encodeURIComponent(promocaoId)}/items?promotion_type=${tipo}&item_id=${encodeURIComponent(itemId)}&app_version=v2`;
      for (let i = 1; ; i++) {
        const r = await chamar('GET', path);
        if (r.ok) {
          const x = lista(((await r.json()) as Obj | null)?.results)[0];
          if (!x) return null;
          return { status: str(x.status) ?? 'desconhecido', preco_min: num(x.min_discounted_price),
            preco_max: num(x.max_discounted_price), offer_id: str(x.offer_id) };
        }
        if (![500, 502, 503].includes(r.status)) throw await falha(r);
        if (i === TENTATIVAS) throw new Error(`ML ${r.status} em /seller-promotions/promotions`);
        await esperar(1000);
      }
    },

    async lerRelacoes(itemId) {
      const item = (await multiget([itemId], 'id,catalog_listing,item_relations')).get(itemId);
      if (!item) throw new Error(`ML não devolveu o item ${itemId}`);
      const rels = lista(item.item_relations).map((r) => str(r.id)).filter((x): x is string => x != null);
      const m = rels.length ? await multiget(rels, 'id,catalog_listing') : new Map<string, Obj>();
      return {
        catalog_listing: item.catalog_listing === true,
        relacionados: rels.map((id) => ({ id, catalog_listing: m.get(id)?.catalog_listing === true })),
      };
    },

    async post(itemId, body) {
      const r = await chamar('POST', `/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`, body);
      if (r.status !== 200 && r.status !== 201) throw await falha(r);
      // SMART devolve o offer_id NOVO (OFFER-...) — é ele que a saída usa; DEAL não traz offer_id.
      return { offer_id: str(((await r.json().catch(() => null)) as Obj | null)?.offer_id) };
    },

    async del(itemId, query) {
      // 200 aqui é "saída solicitada", não "saiu" (spike): quem confirma é a conferência na visão da campanha.
      const r = await chamar('DELETE', `/seller-promotions/items/${encodeURIComponent(itemId)}?${query}`);
      if (r.status !== 200 && r.status !== 204) throw await falha(r);
    },
  };
}
