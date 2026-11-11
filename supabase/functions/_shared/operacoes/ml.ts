// ADR-0174 — cliente ML do motor de operações em massa: leitura fresca na VISÃO DA CAMPANHA (a visão por item
// atrasa) e escrita em /seller-promotions. 401/403 em qualquer chamada → SemEscritaPromocoes (reconectar a conta).
import type { ItemNaCampanha, OfertaNoItem, Relacoes, TipoPromocao } from './tipos.ts';
import { ehParticipando } from '../promocoes/projecao.ts';
import { caminhoMultiget, comoEnvelopeAntigo } from '../ml/multiget.ts';

type Obj = Record<string, unknown>;
export class SemEscritaPromocoes extends Error {}
export interface ClienteML {
  lerNaCampanha(promocaoId: string, tipo: TipoPromocao, itemId: string): Promise<ItemNaCampanha | null>;
  /** `offerId`: depois do POST, a oferta criada (a janela é a dela, não a de outro horário). */
  lerOfertaNoItem(promocaoId: string, itemId: string, offerId?: string | null): Promise<OfertaNoItem | null>;
  lerRelacoes(itemId: string): Promise<Relacoes>;
  /** inicio/fim: start_date/end_date da resposta (janela da SMART_LIGHTNING, sem fuso = horário de Brasília). */
  post(itemId: string, body: Record<string, unknown>): Promise<{ offer_id: string | null; inicio: string | null; fim: string | null }>;
  /** Alterar o deal_price de item DEAL já participando (spike 03/11: 200 e o preço muda na hora). */
  put(itemId: string, body: Record<string, unknown>): Promise<void>;
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
const obj = (x: unknown): Obj => (x && typeof x === 'object' ? (x as Obj) : {});
const oferta = (x: unknown): string | null => {
  const s = str(x);
  return s && (s.startsWith('OFFER-') || s.startsWith('CANDIDATE-')) ? s : null;
};
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
    const r = await chamar('GET', caminhoMultiget(xs, atributos));
    if (!r.ok) throw await falha(r);
    const m = new Map<string, Obj>();
    for (const x of lista(comoEnvelopeAntigo(await r.json(), xs))) {
      const b = x.body as Obj | null;
      if (x.code === 200 && b && typeof b === 'object') m.set(String(b.id), b);
    }
    return m;
  };

  // /seller-promotions devolve 500 intermitente: 500/502/503 → até 3 tentativas com 1 s; outro erro lança.
  const lerComRetry = async (path: string, rota: string, extrair: (j: unknown) => unknown): Promise<unknown> => {
    for (let i = 1; ; i++) {
      const r = await chamar('GET', path);
      if (r.ok) return extrair(await r.json());
      if (![500, 502, 503].includes(r.status)) throw await falha(r);
      if (i === TENTATIVAS) throw new Error(`ML ${r.status} em ${rota}`);
      await esperar(1000);
    }
  };

  return {
    async lerNaCampanha(promocaoId, tipo, itemId) {
      const path = `/seller-promotions/promotions/${encodeURIComponent(promocaoId)}/items?promotion_type=${tipo}&item_id=${encodeURIComponent(itemId)}&app_version=v2`;
      const rs = lista(await lerComRetry(path, '/seller-promotions/promotions', (j) => (j as Obj | null)?.results));
      // Mesmo MLB em 2 linhas (CANDIDATE + OFFER): vale a participando. Na Relâmpago (uma oferta por horário, emenda
      // 2026-11-08 (2)) o convite aberto vem junto em `convite`.
      const x = rs.find((r) => ehParticipando(String(r.status))) ?? rs[0];
      if (!x) return null;
      // LIGHTNING: o id da oferta vem em ref_id e o estoque exigido em stock.min; SMART_LIGHTNING só lê o stock.min;
      // os demais não leem nenhum dos dois.
      const lgh = tipo === 'LIGHTNING';
      const ler = (y: Obj) => {
        const status = str(y.status);
        // Sem status não dá para decidir (em 'sair' viraria ja_estava sem DELETE) → falha em vez de inventar.
        if (!status) throw new Error(`ML sem status do item ${itemId} na campanha ${promocaoId}`);
        return { status, preco_min: num(y.min_discounted_price), preco_max: num(y.max_discounted_price),
          offer_id: str(y.offer_id) ?? (lgh ? oferta(y.ref_id) : null),
          estoque_min: lgh || tipo === 'SMART_LIGHTNING' ? num(obj(y.stock).min) : null, preco: num(y.price) };
      };
      const conv = lgh && ehParticipando(String(x.status)) ? rs.find((r) => r.status === 'candidate') : undefined;
      return conv ? { ...ler(x), convite: ler(conv) } : ler(x);
    },

    async lerOfertaNoItem(promocaoId, itemId, offerId) {
      const path = `/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`;
      const da = lista(await lerComRetry(path, '/seller-promotions/items', (j) => j))
        .filter((p) => p.id === promocaoId && p.type === 'LIGHTNING');
      // Um horário participando e outro convidado: faixa e stock.min são os do convite.
      // Depois do POST, só a oferta criada: ainda não visível → sem janela, nunca a de outro horário (revisão Grok).
      const x = offerId ? da.find((p) => p.ref_id === offerId) : da.find((p) => p.status === 'candidate') ?? da[0];
      if (!x) return null;
      return { preco_min: num(x.min_discounted_price), preco_max: num(x.max_discounted_price),
        preco_sugerido: num(x.suggested_discounted_price), estoque_min: num(obj(x.stock).min),
        inicio: str(x.start_date), fim: str(x.finish_date) };
    },

    async lerRelacoes(itemId) {
      const item = (await multiget([itemId], 'id,catalog_listing,item_relations,available_quantity')).get(itemId);
      if (!item) throw new Error(`ML não devolveu o item ${itemId}`);
      const rels = lista(item.item_relations).map((r) => str(r.id)).filter((x): x is string => x != null);
      const m = rels.length ? await multiget(rels, 'id,catalog_listing') : new Map<string, Obj>();
      // Relacionado que o multiget não devolveu não pode virar catalog_listing:false — liberaria o par UP/catálogo.
      const faltou = rels.find((id) => !m.has(id));
      if (faltou) throw new Error(`ML não devolveu o item relacionado ${faltou}`);
      return {
        catalog_listing: item.catalog_listing === true,
        relacionados: rels.map((id) => ({ id, catalog_listing: m.get(id)!.catalog_listing === true })),
        disponivel: num(item.available_quantity),
      };
    },

    async post(itemId, body) {
      const r = await chamar('POST', `/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`, body);
      if (r.status !== 200 && r.status !== 201) throw await falha(r);
      // SMART devolve o offer_id NOVO (OFFER-...) — é ele que a saída usa; DEAL não traz offer_id.
      const j = (await r.json().catch(() => null)) as Obj | null;
      return { offer_id: str(j?.offer_id), inicio: str(j?.start_date), fim: str(j?.end_date) };
    },

    async put(itemId, body) {
      const r = await chamar('PUT', `/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`, body);
      if (r.status !== 200 && r.status !== 201) throw await falha(r);
    },

    async del(itemId, query) {
      // 200 aqui é "saída solicitada", não "saiu" (spike): quem confirma é a conferência na visão da campanha.
      const r = await chamar('DELETE', `/seller-promotions/items/${encodeURIComponent(itemId)}?${query}`);
      if (r.status !== 200 && r.status !== 204) throw await falha(r);
    },
  };
}
