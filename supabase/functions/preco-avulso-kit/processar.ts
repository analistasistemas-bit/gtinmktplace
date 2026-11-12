// ADR-0200 (adendos 08/11 e 11/11): preço avulso das peças da base, lido do ML na hora (sem cache), para a tela do kit
// comparar com o preço do kit. SÓ GET.
// - normal: `price` do /items/bulk (preço base atual; `regular_amount` do /sale_price pode ficar velho, ADR-0196);
// - em promoção: `amount` do /sale_price (o que o comprador paga), por item: não há versão em lote;
// - promoções do item: `lerOfertas` do reajuste (visão por item + visão da campanha para `candidate`, que atrasa),
//   a mesma leitura de produção: dá o fim da oferta vencedora e as promoções futuras (início depois de agora).
// Leitura incerta nunca vira "sem promoção": a peça volta sem preço e a tela diz que não foi possível comparar.
import { caminhoMultiget, comoEnvelopeAntigo } from '../_shared/ml/multiget.ts';
import { parseSalePrice } from '../_shared/trafego/parsers.ts';
import { pool } from '../_shared/concorrencia/pool.ts';
import type { OfertaVigente } from '../_shared/operacoes/reajuste/tipos.ts';

/** GET relativo à API do ML com o token da org e timeout; lança em não-2xx. */
export type GetML = (path: string) => Promise<unknown>;
export interface DepsPrecoAvulso {
  get: GetML;
  /** `criarClienteReajusteML(token).lerOfertas`: null = inconclusivo, nunca "sem ofertas". */
  lerOfertas(itemId: string): Promise<OfertaVigente[] | null>;
  /** Relógio (ms): "futura" = início depois dele. */
  agora: number;
}

export interface PromocaoFutura { tipo: string; preco: number | null; inicio: string; fim: string | null }
export interface PrecoAvulso {
  normal: number | null; promocao: number | null; fim_promocao: string | null;
  futuras: PromocaoFutura[]; futuras_indisponivel: boolean;
}
const SEM_PRECO: PrecoAvulso = { normal: null, promocao: null, fim_promocao: null, futuras: [], futuras_indisponivel: true };
type Obj = Record<string, unknown>;
const centavos = (n: number) => Math.round(n * 100);
const texto = (x: unknown) => (typeof x === 'string' && x ? x : null);
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

/** 1º a oferta exata (Relâmpago fica `pending` enquanto participa, ADR-0174; janelas da mesma campanha dividem o id). Só
 *  sem ela, a campanha iniciada. */
function fimDaOferta(ofertas: OfertaVigente[], meta: Obj): string | null {
  const ofertaId = texto(meta.promotion_id);
  const campanhaId = texto(meta.campaign_id);
  const o = (ofertaId && ofertas.find((x) => x.offer_id === ofertaId))
    || ofertas.find((x) => x.status === 'started' && (x.promocao_id === campanhaId || x.promocao_id === ofertaId));
  return o?.fim ?? null;
}

/** Início depois de agora e desconto de verdade (preço abaixo do normal). Sem preço legível: lista sem valor, não some. */
function futurasDe(ofertas: OfertaVigente[], normal: number, agora: number): PromocaoFutura[] {
  return ofertas
    .filter((o) => o.inicio && Date.parse(o.inicio) > agora && (o.preco == null || centavos(o.preco) < centavos(normal)))
    .map((o) => ({ tipo: o.tipo, preco: o.preco, inicio: o.inicio!, fim: o.fim }))
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
}

async function lerItem(d: DepsPrecoAvulso, itemId: string, normal: number | undefined): Promise<PrecoAvulso> {
  if (normal == null) return SEM_PRECO;
  // Em paralelo: a leitura das promoções não dobra a espera da tela (o "lendo" segura o Criar kit).
  const [bruto, ofertas] = await Promise.all([
    d.get(`/items/${encodeURIComponent(itemId)}/sale_price?context=channel_marketplace`)
      .catch((e) => { console.warn('preco_avulso_sale_price_falhou', itemId, String(e)); return undefined; }),
    d.lerOfertas(itemId).catch(() => null),
  ]);
  const venda = bruto === undefined ? null : parseSalePrice(bruto);
  if (!venda) return SEM_PRECO;
  const promovida = centavos(venda.preco) < centavos(normal);
  const meta = ((bruto as Obj).metadata ?? {}) as Obj;
  return {
    normal,
    promocao: promovida ? venda.preco : null,
    fim_promocao: promovida && ofertas ? fimDaOferta(ofertas, meta) : null,
    futuras: ofertas ? futurasDe(ofertas, normal, d.agora) : [],
    futuras_indisponivel: !ofertas,
  };
}

/** Preço por SKU. Peça sem vínculo ou sem leitura → sem preço (a tela mostra "indisponível"). Nunca lança. */
export async function lerPrecosAvulsos(
  d: DepsPrecoAvulso, vinculos: { sku: string; item_id: string | null }[],
): Promise<Record<string, PrecoAvulso>> {
  const ids = [...new Set(vinculos.map((v) => v.item_id).filter((x): x is string => !!x))];
  const normais = await precosNormais(d.get, ids);
  const lidos = await pool(10, ids, (id) => lerItem(d, id, normais.get(id)));
  const porItem = new Map(ids.map((id, i) => [id, lidos[i]]));
  return Object.fromEntries(vinculos.map((v) => [v.sku, (v.item_id && porItem.get(v.item_id)) || SEM_PRECO]));
}
