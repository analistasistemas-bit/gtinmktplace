// Tradução dos códigos de status do ML para rótulos pt-BR (puro, testável).

const PEDIDO: Record<string, { label: string; tom: 'success' | 'warning' | 'danger' | 'muted' }> = {
  paid: { label: 'Pago', tom: 'success' },
  confirmed: { label: 'Confirmado', tom: 'warning' },
  payment_required: { label: 'Aguardando pgto', tom: 'warning' },
  payment_in_process: { label: 'Processando pgto', tom: 'warning' },
  partially_paid: { label: 'Parcial', tom: 'warning' },
  partially_refunded: { label: 'Estorno parcial', tom: 'warning' },
  refunded: { label: 'Estornado', tom: 'danger' },
  cancelled: { label: 'Cancelado', tom: 'danger' },
  invalid: { label: 'Inválido', tom: 'danger' },
};

const ENVIO: Record<string, { label: string; tom: 'success' | 'warning' | 'danger' | 'muted' }> = {
  pending: { label: 'Preparando', tom: 'muted' },
  handling: { label: 'Preparando', tom: 'warning' },
  ready_to_ship: { label: 'Pronto p/ envio', tom: 'warning' },
  shipped: { label: 'Enviado', tom: 'success' },
  delivered: { label: 'Entregue', tom: 'success' },
  not_delivered: { label: 'Não entregue', tom: 'danger' },
  cancelled: { label: 'Cancelado', tom: 'danger' },
};

// Substatus de `ready_to_ship` em que o pacote JÁ saiu do vendedor. O ML, na tela de Vendas,
// move esses para "Em trânsito / A caminho" — não são mais "Pronto p/ envio". (fluxo drop-off/coleta)
const SUBSTATUS_A_CAMINHO = new Set([
  'dropped_off', 'picked_up', 'in_hub', 'in_warehouse', 'arrived_at_warehouse',
  'in_route', 'out_for_delivery', 'soon_deliver',
]);

export function labelStatusPedido(status: string | null | undefined): { label: string; tom: 'success' | 'warning' | 'danger' | 'muted' } {
  if (!status) return { label: '—', tom: 'muted' };
  return PEDIDO[status] ?? { label: status, tom: 'muted' };
}

export function labelStatusEnvio(
  status: string | null | undefined,
  substatus?: string | null,
): { label: string; tom: 'success' | 'warning' | 'danger' | 'muted' } {
  if (!status) return { label: '—', tom: 'muted' };
  // `ready_to_ship` é um guarda-chuva: o substatus diz se o pacote ainda está com o vendedor
  // ("Pronto p/ envio"), aguardando nota ("Aguardando NF") ou já a caminho. Ver ML Vendas.
  if (status === 'ready_to_ship') {
    if (substatus === 'invoice_pending') return { label: 'Aguardando NF', tom: 'warning' };
    if (substatus && SUBSTATUS_A_CAMINHO.has(substatus)) return { label: 'A caminho', tom: 'success' };
    return { label: 'Pronto p/ envio', tom: 'warning' };
  }
  return ENVIO[status] ?? { label: status, tom: 'muted' };
}

/** Data curta pt-BR (dd/mm) a partir de ISO. '—' se nulo. */
export function fmtDataCurta(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** URL do anúncio no ML a partir do item_id (ex.: MLB123 → produto.mercadolivre.com.br/MLB-123). */
export function urlAnuncioML(mlItemId: string): string {
  return `https://produto.mercadolivre.com.br/${mlItemId.replace(/^MLB/, 'MLB-')}`;
}

/**
 * Caixa de perguntas do vendedor no ML. A API não devolve permalink por pergunta
 * (`/questions/{id}` v4 não tem esse campo), então o atalho abre a lista logada.
 */
export const URL_PERGUNTAS_ML = 'https://www.mercadolivre.com.br/perguntas/vendedor';

/**
 * Detalhe da venda no ML — a tela que mostra o pedido e o histórico de mensagens com o comprador.
 *
 * Só existe uma rota viva, e ela unificou: `/vendas/{id}/detalhe` aceita **tanto pack_id quanto
 * order_id** (Diego confirmou logado, 15/09/2026, abrindo a mesma venda pelos dois ids). Prefira o
 * pack quando houver — o order abre só aquele pedido, e o pacote pode ter outros.
 *
 * `/vendas/pacote/{id}/detalhe` está **morta**: devolve 301 para `/vendas/lista` com qualquer id,
 * real ou inventado (medido sem login na mesma data), jogando o vendedor na lista de vendas. Não a
 * reintroduza a partir de código antigo — ela está quebrada, não deprecada.
 */
export function urlVendaML(packOuOrderId: string | number): string {
  return `https://www.mercadolivre.com.br/vendas/${packOuOrderId}/detalhe`;
}
