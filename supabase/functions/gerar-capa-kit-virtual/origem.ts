// Parte pura da edge `gerar-capa-kit-virtual` (ADR-0206): chave do teto + pedido (um ponto só) e foto de origem de
// cada componente, lida do multiget do ML (`id,status,sub_status,pictures,user_product_id`).
import { chaveComposicao } from '../_shared/ai/foto-kit-virtual-modo.ts';
import { parseStatusML } from '../_shared/ml/status.ts';
import { ehUrlFotoMl } from '../gerar-capa-kit-unidades/capa-ml.ts';

export type ItemPedido = { user_product_id: string; quantidade: number };

/** `pedido` na ordem do kit (idempotência) e `composicao` derivada dele: ids ordenados, sem quantidades (teto). */
export function montarChaveEPedido(componentes: Array<{ user_product_id: string; quantidade: number }>): { pedido: ItemPedido[]; composicao: string } {
  const pedido = componentes.map((c) => ({ user_product_id: c.user_product_id, quantidade: c.quantidade }));
  return { pedido, composicao: chaveComposicao(pedido.map((p) => p.user_product_id)) };
}

/** Pedido gravado (jsonb: o banco reordena as chaves) × pedido atual, campo a campo e na mesma ordem. */
export function mesmoPedido(gravado: unknown, pedido: ItemPedido[]): boolean {
  if (!Array.isArray(gravado) || gravado.length !== pedido.length) return false;
  return pedido.every((p, i) => {
    const g = (gravado[i] ?? {}) as Record<string, unknown>;
    return g.user_product_id === p.user_product_id && Number(g.quantidade) === p.quantidade;
  });
}

type Corpo = { id?: unknown; status?: unknown; sub_status?: unknown; user_product_id?: unknown; pictures?: Array<{ secure_url?: unknown }> };

/** Mesma regra de `avaliar` (`_shared/kit-variacao/galeria-leitura.ts`): só ativo/pausado sem moderação serve de fonte. */
const fonteLimpa = (b: Corpo) => {
  const s = parseStatusML({ id: String(b.id), status: String(b.status), sub_status: Array.isArray(b.sub_status) ? b.sub_status : [] }).status;
  return s === 'ativo' || s === 'pausado';
};

/** Foto 1 de cada item, na ordem dos pedidos. Item não lido ou de outro `user_product_id` → `item_divergente`;
 *  fora de ativo/pausado (moderado, inativo, encerrado) ou sem foto 1 do CDN do ML → `item_inelegivel`. */
export function fotosDeOrigem(entradas: unknown, pedidos: Array<{ userProductId: string; itemId: string }>):
  { ok: true; urls: string[] } | { ok: false; motivo: 'item_divergente' | 'item_inelegivel'; itemId: string } {
  const lista = Array.isArray(entradas) ? entradas : [];
  const corpo = (id: string): Corpo | undefined => lista
    .map((e) => (e ?? {}) as { code?: unknown; body?: Corpo | null })
    .find((e) => e.code === 200 && e.body?.id === id && typeof e.body.status === 'string')?.body ?? undefined;
  // Leitura conferida antes do status: item não lido é divergência, não inelegibilidade.
  for (const p of pedidos) {
    if (corpo(p.itemId)?.user_product_id !== p.userProductId) return { ok: false, motivo: 'item_divergente', itemId: p.itemId };
  }
  const urls: string[] = [];
  for (const p of pedidos) {
    const b = corpo(p.itemId)!;
    const url = b.pictures?.[0]?.secure_url;
    if (!fonteLimpa(b) || !ehUrlFotoMl(url)) return { ok: false, motivo: 'item_inelegivel', itemId: p.itemId };
    urls.push(url);
  }
  return { ok: true, urls };
}
