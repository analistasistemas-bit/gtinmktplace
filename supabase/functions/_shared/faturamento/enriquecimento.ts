// Enriquecimento das vendas (ADR-0037): líquido real (Mercado Pago) e GTIN p/ vendas de
// catálogo. Reusa os helpers do financeiro (ADR-0031) e do _shared/ml. Não testado por vitest.
import { buscarPagamentosMP, getContaId } from '../mercadopago/financeiro.ts';
import { buscarGtinsDosItens } from '../ml/pedidos.ts';
import type { PedidoML, DadosPagamentoMP } from './venda.ts';

/**
 * paymentId → dados do MP (líquido, estorno, data de liberação) das vendas da própria conta.
 * Mesma fonte do menu Financeiro (ADR-0038). Sem MP_ACCESS_TOKEN ou em erro → mapa vazio (cai na
 * estimativa; estorno/liberação ficam null).
 */
export async function carregarLiquidoMP(lookbackDias = 120): Promise<Map<string, DadosPagamentoMP>> {
  const out = new Map<string, DadosPagamentoMP>();
  const token = Deno.env.get('MP_ACCESS_TOKEN');
  if (!token) return out;
  try {
    const contaId = await getContaId(token);
    const pagamentos = await buscarPagamentosMP(token, lookbackDias);
    for (const p of pagamentos) {
      if (Number(p.collector_id) !== contaId) continue;       // exclui compras/terceiros
      if (p.description === 'marketplace_shipment') continue;  // exclui pagamento de frete
      out.set(String(p.id), {
        net: Number(p.transaction_details?.net_received_amount ?? 0),
        estorno: Number(p.transaction_amount_refunded ?? 0),
        releaseDate: p.money_release_date ?? null,
      });
    }
  } catch (e) {
    console.warn('carregarLiquidoMP falhou:', (e as Error).message);
  }
  return out;
}

/** ml_item_id → GTIN, só p/ itens cujo id NÃO está no escopo (vendas de catálogo). */
export async function carregarGtinsFallback(
  token: string, pedidos: PedidoML[], idsPubliai: Set<string>,
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const p of pedidos) {
    for (const oi of p.order_items ?? []) {
      const id = oi?.item?.id;
      if (id && !idsPubliai.has(id)) ids.add(id);
    }
  }
  if (ids.size === 0) return new Map();
  const rec = await buscarGtinsDosItens(token, [...ids]);
  return new Map(Object.entries(rec));
}
