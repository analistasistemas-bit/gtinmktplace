// Enriquecimento das vendas (ADR-0037): estorno/liberação (Mercado Pago) e GTIN p/ vendas de
// catálogo. Só `montarMapaLiquido` é testado por vitest; o resto faz IO.
import { buscarPagamentosMP, type PagamentoMP } from '../mercadopago/financeiro.ts';
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
  // Duplicado de propósito com os carregadores: lá o guard evita o fetch, aqui mantém esta função
  // pura correta (e testável) sozinha. Não remova nenhum dos dois achando que é redundância.
  if (!contaId || !Number.isFinite(contaId)) return mapa;
  for (const p of pagamentos) {
    if (Number(p.collector_id) !== contaId) continue;       // exclui compras/terceiros
    if (p.description === 'marketplace_shipment') continue;  // exclui pagamento de frete
    mapa.set(String(p.id), {
      estorno: Number(p.transaction_amount_refunded ?? 0),
      releaseDate: p.money_release_date ?? null,
    });
  }
  return mapa;
}

/**
 * paymentId → dados do MP (líquido, estorno, data de liberação) das vendas da própria conta.
 * Mesma fonte do menu Financeiro (ADR-0038). O token e a conta são os da conexão `mercado_livre`
 * da org, que o worker chamador já tem em escopo (ADR-0093) — não há token de MP próprio.
 *
 * Retorno: `null` = a leitura do MP falhou (o chamador decide re-tentar); mapa vazio = leu e não
 * havia pagamento correspondente, ou a conta não está resolvida (condição permanente, retry não
 * ajuda). Os dois casos precisam ser distinguíveis: com mapa vazio o upsert grava
 * estorno/liberação null, e é `preservarDadosMP` que impede isso de apagar dado bom.
 */
export async function carregarLiquidoMP(
  token: string, contaId: number, lookbackDias = 120,
): Promise<Map<string, DadosPagamentoMP> | null> {
  // Antes do fetch: sem conta resolvida varrer 120 dias do MP só para descartar tudo é desperdício.
  if (!contaId || !Number.isFinite(contaId)) return new Map();
  try {
    const pagamentos = await buscarPagamentosMP(token, lookbackDias);
    return montarMapaLiquido(pagamentos, contaId);
  } catch (e) {
    console.warn('carregarLiquidoMP falhou:', (e as Error).message);
    return null;
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
