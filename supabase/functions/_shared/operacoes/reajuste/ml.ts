// I5 — cliente ML do reajuste de preço em massa. Única escrita: o PUT de preço (Legacy: mesmo preço em
// todas as variações; plano/UP: {price}). 401/403 → SemAcessoStatusML (reconectar a conta).
import { caminhoMultiget, comoEnvelopeAntigo } from '../../ml/multiget.ts';
import { SemAcessoStatusML } from '../ml-status.ts';
import type { VivoItem } from './tipos.ts';

export type ResultadoPut = { kind: 'ok' } | { kind: 'sem_escrita'; status: number; mensagem: string } | { kind: 'desconhecido'; mensagem: string };
export interface ClienteReajusteML {
  lerVivo(itemId: string): Promise<VivoItem>;
  putPreco(itemId: string, alvo: number, variacaoIds: string[] | null): Promise<ResultadoPut>;
  participaPromocaoML(itemId: string): Promise<boolean | null>;
}

const API = 'https://api.mercadolibre.com';
const TIMEOUT_PUT_MS = 15_000;
const ATIVA = new Set(['pending', 'started']);
const semAcesso = (s: number) => s === 401 || s === 403;

type ItemML = {
  price?: unknown; status?: unknown; sub_status?: unknown; catalog_listing?: unknown;
  variations?: { id: unknown; price: unknown }[]; item_relations?: unknown[];
};

export function criarClienteReajusteML(token: string, f: typeof fetch = fetch): ClienteReajusteML {
  const auth = { Authorization: `Bearer ${token}` };
  const get = (path: string) => f(`${API}${path}`, { headers: auth });

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

    async participaPromocaoML(itemId) {
      const id = encodeURIComponent(itemId);
      try {
        const r = await get(`/seller-promotions/items/${id}?app_version=v2`);
        if (r.status !== 200) return null;
        const lista = await r.json();
        if (!Array.isArray(lista)) return null;
        const promos = lista as { id?: unknown; type?: unknown; status?: unknown }[];
        if (promos.some((p) => ATIVA.has(String(p?.status)))) return true;
        for (const p of promos.filter((p) => p?.status === 'candidate')) {
          // Candidate sem id (ex.: PRICE_DISCOUNT = desconto próprio possível) não é campanha e não participa.
          if (typeof p.id !== 'string' || !p.id) continue;
          const rc = await get(`/seller-promotions/promotions/${encodeURIComponent(p.id)}/items?promotion_type=${encodeURIComponent(String(p.type))}&item_id=${id}&app_version=v2`);
          if (rc.status !== 200) return null;
          const r0 = ((await rc.json()) as { results?: { status?: unknown }[] | null })?.results?.[0];
          if (r0 && typeof r0.status !== 'string') return null; // sem status = inconclusivo, nunca "não participa"
          if (r0 && ATIVA.has(r0.status as string)) return true;
        }
        return false;
      } catch {
        return null;
      }
    },
  };
}
