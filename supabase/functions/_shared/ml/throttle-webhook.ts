// Throttle do ml-webhook (INT-018/033): um atacante que conhece o mlUserId público de um
// vendedor cadastrado pode forjar notificações e inflar `ml_webhook_eventos` + gasto de QStash
// (amplificação de custo/armazenamento — não há injeção de dado, o worker refaz o fetch autenticado).
// Limite bem folgado: o ML manda alguns eventos por pedido/vendedor; tráfego legítimo não chega
// perto disso. Acima do limite: dropa (sem insert/enqueue) mas ainda ACK 200 — o job horário
// `reconciliar-faturamento` é o backstop que recupera qualquer evento descartado aqui.
export const LIMITE_EVENTOS_JANELA = 200;
export const JANELA_THROTTLE_MS = 60_000;

export function deveThrottlar(countRecente: number, limite = LIMITE_EVENTOS_JANELA): boolean {
  return countRecente >= limite;
}
