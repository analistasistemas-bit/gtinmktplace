// Parte pura da edge `gerar-capa-kit-virtual` (ADR-0206): chave do teto + pedido (um ponto só) e foto de origem de
// cada componente, lida do multiget do ML (`id,status,sub_status,pictures,user_product_id`).
import { chaveComposicao } from '../_shared/ai/foto-kit-virtual-modo.ts';
import { moderadosDoBulk } from '../criar-kit-variacao/processar.ts';
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

type Corpo = { id?: unknown; status?: unknown; user_product_id?: unknown; pictures?: Array<{ secure_url?: unknown }> };

/** Foto 1 de cada item, na ordem dos pedidos. Item não lido ou de outro `user_product_id` → `item_divergente`;
 *  moderado/inativo ou sem foto 1 do CDN do ML → `item_inelegivel`. */
export function fotosDeOrigem(entradas: unknown, pedidos: Array<{ userProductId: string; itemId: string }>):
  { ok: true; urls: string[] } | { ok: false; motivo: 'item_divergente' | 'item_inelegivel'; itemId: string } {
  const lista = Array.isArray(entradas) ? entradas : [];
  const corpo = (id: string): Corpo | undefined => lista
    .map((e) => (e ?? {}) as { code?: unknown; body?: Corpo | null })
    .find((e) => e.code === 200 && e.body?.id === id && typeof e.body.status === 'string')?.body ?? undefined;
  // Leitura conferida ANTES de `moderadosDoBulk`, que lança com item não lido (viraria "ML ilegível").
  for (const p of pedidos) {
    if (corpo(p.itemId)?.user_product_id !== p.userProductId) return { ok: false, motivo: 'item_divergente', itemId: p.itemId };
  }
  // Só as entradas já conferidas (200 + status): aqui `moderadosDoBulk` não lança.
  const moderados = moderadosDoBulk(pedidos.map((p) => p.itemId), pedidos.map((p) => ({ code: 200, body: corpo(p.itemId) })));
  const urls: string[] = [];
  for (const p of pedidos) {
    const url = corpo(p.itemId)?.pictures?.[0]?.secure_url;
    if (moderados.has(p.itemId) || !ehUrlFotoMl(url)) return { ok: false, motivo: 'item_inelegivel', itemId: p.itemId };
    urls.push(url);
  }
  return { ok: true, urls };
}
