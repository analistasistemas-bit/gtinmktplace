// ADR-0200 (adendo 08/11): preço avulso das peças da base, lido do ML na hora (sem cache), para a tela do kit
// comparar com o preço do kit. SÓ GET.
// - normal: `price` do /items/bulk (preço base atual; `regular_amount` do /sale_price pode ficar velho, ADR-0196);
// - em promoção: `amount` do /sale_price (o que o comprador paga), por item: não há versão em lote;
// - fim: `finish_date` da oferta vencedora (a do `metadata` do /sale_price) na visão por item das promoções.
// Leitura incerta nunca vira "sem promoção": a peça volta sem preço e a tela diz que não foi possível comparar.
import { caminhoMultiget, comoEnvelopeAntigo } from '../_shared/ml/multiget.ts';
import { parseSalePrice } from '../_shared/trafego/parsers.ts';
import { pool } from '../_shared/concorrencia/pool.ts';

/** GET relativo à API do ML com o token da org e timeout; lança em não-2xx. */
export type GetML = (path: string) => Promise<unknown>;

export interface PrecoAvulso { normal: number | null; promocao: number | null; fim_promocao: string | null }
const SEM_PRECO: PrecoAvulso = { normal: null, promocao: null, fim_promocao: null };
type Obj = Record<string, unknown>;
const centavos = (n: number) => Math.round(n * 100);
const LOTE = 20;

async function precosNormais(get: GetML, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += LOTE) {
    const bloco = ids.slice(i, i + LOTE);
    try {
      const r = comoEnvelopeAntigo(await get(caminhoMultiget(bloco, 'id,price')), bloco);
      for (const e of Array.isArray(r) ? (r as Obj[]) : []) {
        const b = e.body as Obj | undefined;
        if (e.code === 200 && typeof b?.id === 'string' && typeof b.price === 'number' && b.price > 0) out.set(b.id, b.price);
      }
    } catch (err) {
      console.warn('preco_avulso_bulk_falhou', String(err));
    }
  }
  return out;
}

async function fimDaOferta(get: GetML, itemId: string, meta: Obj): Promise<string | null> {
  const ids = new Set([meta.promotion_id, meta.campaign_id].filter((x): x is string => typeof x === 'string' && !!x));
  if (ids.size === 0) return null;
  try {
    const lista = await get(`/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`);
    const oferta = (Array.isArray(lista) ? (lista as Obj[]) : []).find((p) => p.status === 'started'
      && (ids.has(p.id as string) || ids.has(p.offer_id as string)));
    return typeof oferta?.finish_date === 'string' && oferta.finish_date ? oferta.finish_date : null;
  } catch (e) {
    console.warn('preco_avulso_fim_promocao_falhou', itemId, String(e));
    return null;
  }
}

async function lerItem(get: GetML, itemId: string, normal: number | undefined): Promise<PrecoAvulso> {
  if (normal == null) return SEM_PRECO;
  let bruto: unknown;
  try { bruto = await get(`/items/${encodeURIComponent(itemId)}/sale_price?context=channel_marketplace`); }
  catch (e) { console.warn('preco_avulso_sale_price_falhou', itemId, String(e)); return SEM_PRECO; }
  const venda = parseSalePrice(bruto);
  if (!venda) return SEM_PRECO;
  if (centavos(venda.preco) >= centavos(normal)) return { normal, promocao: null, fim_promocao: null };
  const meta = ((bruto as Obj).metadata ?? {}) as Obj;
  return { normal, promocao: venda.preco, fim_promocao: await fimDaOferta(get, itemId, meta) };
}

/** Preço por SKU. Peça sem vínculo ou sem leitura → todos null (a tela mostra "indisponível"). Nunca lança. */
export async function lerPrecosAvulsos(
  get: GetML, vinculos: { sku: string; item_id: string | null }[],
): Promise<Record<string, PrecoAvulso>> {
  const ids = [...new Set(vinculos.map((v) => v.item_id).filter((x): x is string => !!x))];
  const normais = await precosNormais(get, ids);
  const lidos = await pool(10, ids, (id) => lerItem(get, id, normais.get(id)));
  const porItem = new Map(ids.map((id, i) => [id, lidos[i]]));
  return Object.fromEntries(vinculos.map((v) => [v.sku, (v.item_id && porItem.get(v.item_id)) || SEM_PRECO]));
}
