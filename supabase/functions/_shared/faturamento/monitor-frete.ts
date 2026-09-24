// ADR-0169 — Monitor de frete. Este módulo é testado por vitest (Node): nada de import
// Deno-only aqui. A fiação com o client admin vive em monitor-frete-deps.ts.
import { montarMensagemAltaFrete } from '../notificacoes/telegram.ts';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Alta de frete que merece aviso: > 10% E ≥ R$ 2. Nulo/zero em qualquer lado não compara
 *  (nulo = /shipments/costs falhou; 0 = sem custo ao vendedor — incidente de 2026-07-30). */
export function avaliarAltaFrete(
  atual: number | null, anterior: number | null,
): { diferenca: number; pct: number } | null {
  if (atual == null || anterior == null || atual <= 0 || anterior <= 0) return null;
  const diferenca = round2(atual - anterior);
  if (diferenca < 2 || atual <= anterior * 1.1) return null;
  return { diferenca, pct: Math.round((atual / anterior - 1) * 100) };
}

export interface ItemPedidoFrete { ml_item_id: string | null; variation_id: number | null; quantity: number; titulo: string | null }
export interface CtxAltaFrete {
  orgId: string; userId: string; orderId: number; packId: number | null; status: string;
  freteVendedor: number | null; dataVenda: string | null; itens: ItemPedidoFrete[];
  agoraMs?: number; // injetável para teste; default Date.now()
  limiteMs?: number; // epoch ms; passou dele antes da reserva → desiste sem reservar
  relogio?: () => number; // injetável para teste; default Date.now
}
export interface VendaAnteriorFrete { order_id: number; frete_vendedor: number }
export interface DepsAltaFrete {
  monitorAtivo(orgId: string): Promise<boolean>;
  buscarVendaAnterior(p: { orgId: string; mlItemId: string; variationId: number | null; antesDe: string; orderId: number }): Promise<VendaAnteriorFrete | null>;
  reservar(orgId: string, userId: string, chave: string): Promise<boolean>;
  notificar(orgId: string, texto: string): Promise<unknown>;
}

const JANELA_MS = 3 * 24 * 60 * 60 * 1000;

/** ADR-0169. Chamado SÓ pelo sync-venda. Checagens baratas antes de qualquer leitura no banco. */
export async function verificarAltaFrete(ctx: CtxAltaFrete, deps: DepsAltaFrete): Promise<boolean> {
  if (ctx.status === 'cancelled') return false;
  // Em pack o frete_vendedor é o do ENVIO, repetido em cada pedido (ADR-0042 item 4).
  if (ctx.packId != null) return false;
  if (ctx.itens.length !== 1) return false;
  const item = ctx.itens[0];
  if (item.quantity !== 1 || !item.ml_item_id) return false;
  if (ctx.freteVendedor == null || ctx.freteVendedor <= 0) return false;
  if (!ctx.dataVenda) return false;
  const agora = ctx.agoraMs ?? Date.now();
  if (agora - Date.parse(ctx.dataVenda) > JANELA_MS) return false;

  if (!(await deps.monitorAtivo(ctx.orgId))) return false;

  const anterior = await deps.buscarVendaAnterior({
    orgId: ctx.orgId, mlItemId: item.ml_item_id, variationId: item.variation_id,
    antesDe: ctx.dataVenda, orderId: ctx.orderId,
  });
  if (!anterior) return false;

  const alta = avaliarAltaFrete(ctx.freteVendedor, anterior.frete_vendedor);
  if (!alta) return false;

  // Prazo checado ANTES da reserva: se as leituras demoraram, desiste sem tomar o dedup — nada fica
  // rodando depois da resposta do worker (não há Promise.race nem trabalho órfão no isolate).
  const relogio = ctx.relogio ?? Date.now;
  if (ctx.limiteMs != null && relogio() > ctx.limiteMs) {
    console.warn(`monitor de frete (order ${ctx.orderId}): prazo estourado antes da reserva, desistindo`);
    return false;
  }

  if (!(await deps.reservar(ctx.orgId, ctx.userId, String(ctx.orderId)))) return false;

  await deps.notificar(ctx.orgId, montarMensagemAltaFrete({
    titulo: item.titulo, mlItemId: item.ml_item_id,
    atual: ctx.freteVendedor, anterior: anterior.frete_vendedor, pct: alta.pct,
  }));
  return true;
}
