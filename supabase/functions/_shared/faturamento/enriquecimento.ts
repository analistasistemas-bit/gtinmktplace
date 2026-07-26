// Enriquecimento das vendas (ADR-0037): líquido real (Mercado Pago) e GTIN p/ vendas de
// catálogo. Reusa os helpers do financeiro (ADR-0031) e do _shared/ml. Não testado por vitest.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { buscarPagamentosMP, getContaId, resolverTokenMP, type PagamentoMP } from '../mercadopago/financeiro.ts';
import { buscarGtinsDosItens } from '../ml/pedidos.ts';
import type { PedidoML, DadosPagamentoMP } from './venda.ts';

/** paymentId → dados do MP, só das vendas da própria conta. Pura. */
export function montarMapaLiquido(
  pagamentos: PagamentoMP[],
  contaId: number,
): Map<string, DadosPagamentoMP> {
  const mapa = new Map<string, DadosPagamentoMP>();
  // Sem conta resolvida não dá para separar venda própria de compra: `Number(null)` é 0 (não NaN),
  // então com contaId 0/null/undefined um pagamento sem collector_id passaria como venda da conta.
  if (!contaId || !Number.isFinite(contaId)) return mapa;
  for (const p of pagamentos) {
    if (Number(p.collector_id) !== contaId) continue;       // exclui compras/terceiros
    if (p.description === 'marketplace_shipment') continue;  // exclui pagamento de frete
    mapa.set(String(p.id), {
      net: Number(p.transaction_details?.net_received_amount ?? 0),
      estorno: Number(p.transaction_amount_refunded ?? 0),
      releaseDate: p.money_release_date ?? null,
    });
  }
  return mapa;
}

/**
 * paymentId → dados do MP (líquido, estorno, data de liberação) das vendas da própria conta.
 * Mesma fonte do menu Financeiro (ADR-0038). Token por org (Vault, RPC get_mp_token) com
 * fallback ao MP_ACCESS_TOKEN de instância quando a org não tem secret configurado (D-E7.7 —
 * zero regressão para a Avil, único tenant com MP hoje). Sem token ou em erro → mapa vazio
 * (cai na estimativa; estorno/liberação ficam null).
 */
export async function carregarLiquidoMP(
  admin: SupabaseClient, orgId: string | null, lookbackDias = 120,
): Promise<Map<string, DadosPagamentoMP>> {
  const token = await resolverTokenMP(admin, orgId);
  if (!token) return new Map();
  try {
    const contaId = await getContaId(token);
    const pagamentos = await buscarPagamentosMP(token, lookbackDias);
    return montarMapaLiquido(pagamentos, contaId);
  } catch (e) {
    console.warn('carregarLiquidoMP falhou:', (e as Error).message);
    return new Map();
  }
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
