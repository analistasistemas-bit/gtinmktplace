// Tradução dos códigos de status do ML para rótulos pt-BR (puro, testável).

const PEDIDO: Record<string, { label: string; tom: 'success' | 'warning' | 'danger' | 'muted' }> = {
  paid: { label: 'Pago', tom: 'success' },
  confirmed: { label: 'Confirmado', tom: 'warning' },
  payment_required: { label: 'Aguardando pgto', tom: 'warning' },
  payment_in_process: { label: 'Processando pgto', tom: 'warning' },
  partially_paid: { label: 'Parcial', tom: 'warning' },
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

export function labelStatusPedido(status: string | null | undefined): { label: string; tom: 'success' | 'warning' | 'danger' | 'muted' } {
  if (!status) return { label: '—', tom: 'muted' };
  return PEDIDO[status] ?? { label: status, tom: 'muted' };
}

export function labelStatusEnvio(status: string | null | undefined): { label: string; tom: 'success' | 'warning' | 'danger' | 'muted' } {
  if (!status) return { label: '—', tom: 'muted' };
  return ENVIO[status] ?? { label: status, tom: 'muted' };
}

/** Data curta pt-BR (dd/mm) a partir de ISO. '—' se nulo. */
export function fmtDataCurta(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
