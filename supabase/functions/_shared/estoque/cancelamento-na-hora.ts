// ADR-0121, emenda 9: o claim chega na hora do cancelamento, mas o `orders_v2` seguinte do mesmo pedido é descartado
// pelo dedup do ml-webhook. O sync-devolucao dispara o sync-venda, que já sabe repor ou avisar.

/** Só com obrigação pendente que a fila assume: nada retroativo, e a hora cheia cobre qualquer falha. Nunca lança. */
export async function dispararCancelamentoNaHora(
  deps: {
    filaAssume: (orgId: string, orderId: string | number) => Promise<boolean>;
    publicar: (job: { user_id: string; order_id: string; org_id: string }) => Promise<unknown>;
  },
  p: { orgId: string | null; userId: string; orderId: string | number; status: string | null | undefined },
): Promise<boolean> {
  if (p.status !== 'cancelled' || !p.orgId) return false;
  try {
    if (!await deps.filaAssume(p.orgId, p.orderId)) return false;
    await deps.publicar({ user_id: p.userId, order_id: String(p.orderId), org_id: p.orgId });
    return true;
  } catch (e) {
    console.warn('cancelamento_na_hora_falhou', p.orderId, String(e));
    return false;
  }
}
