# ADR-0123 — Reconciliar a data de liberação do Mercado Pago fora da janela de 72h

**Data:** 2026-08-18
**Status:** Aceito
**Contexto relacionado:** ADR-0031 (integração financeira MP), ADR-0037 (reconciliação periódica),
ADR-0042 (líquido econômico), tela `Financeiro > Detalhe do líquido`, `notificar-liberacao`.

## Contexto

Diego relatou que o "Detalhe do líquido" não batia com o extrato do Mercado Pago. A investigação
(2026-08-18, org AVIL) mediu, contra `/v1/payments/search`:

| Fonte | 17/08/2026 |
|---|---|
| App — vendas com `money_release_date` em 17/08 | 17 vendas, **R$ 949,92** |
| MP — pagamentos de venda liberados em 17/08 | 26 pagamentos, **R$ 1.302,95** líquidos |

O **líquido por venda está correto**: as 17 vendas que o app atribui ao dia somam R$ 949,92 contra
R$ 948,93 de net no MP — a diferença de R$ 0,99 é o pagamento de frete (`marketplace_shipment`),
que o ADR-0031 exclui do mapa e o ADR-0042 já embute em `bruto − comissão − frete`. O erro é de
**atribuição de data**: 9 dos 26 pagamentos liberados em 17/08 estavam gravados no banco com
liberação em 28, 29 e 30/08.

Causa raiz: o Mercado Pago **antecipa** `money_release_date` quando a entrega é confirmada, e essa
mudança **não gera webhook de pedido no ML**. `reconciliar-faturamento` só re-lê pedidos das
últimas `JANELA_HORAS = 72`; uma venda aprovada em 29/07 com liberação estimada em ~D+30 sai dessa
janela e nunca mais é reescrita — a estimativa original fica congelada para sempre.

Impacto medido na org AVIL (lookback de 40 dias, 1.157 vendas):

- **222 vendas (19%)** com data de liberação divergente do MP;
- **R$ 3.136,21 em 95 vendas** já creditados na conta do MP e exibidos pelo app como "A liberar".

A notificação do Telegram lê a mesma base e foi confirmada correta para o seu dia (18/08:
25 vendas / R$ 989,21, idêntico ao banco) — ela herdava o mesmo desvio de data, não um erro próprio.

## Decisão

1. `reconciliar-faturamento` ganha um passo que **realinha `money_release_date` com o MP** para
   todas as vendas da org, inclusive as fora da janela de 72h — derivado do mapa de pagamentos que
   `carregarLiquidoMP` já carrega (lookback de 120 dias). **Custo de rede: zero requisições extras.**
2. O mapa por pagamento passa a carregar `orderId` (`payment.order.id == ml_vendas.order_id`) e
   `mapaLiberacaoPorOrder` (pura) reduz para `order_id → liberação mais recente`, herdando os dois
   filtros obrigatórios do ADR-0031 (`collector_id` da conta, sem `marketplace_shipment`).
3. `reconciliarLiberacoes` **só escreve quando o mapa tem data** para o pedido — nunca grava `null`
   por cima de dado bom, mesma garantia que `preservarDadosMP` dá no caminho do upsert. Leitura do
   MP falha (`carregarLiquidoMP === null`) → o passo não roda.
4. Venda cuja data corrigida cai num **dia já passado** e que nunca foi notificada recebe
   `liberacao_notificada_em` com esse dia. A notificação diária só olha o dia corrente, então esse
   backlog nunca seria avisado de qualquer forma; marcá-lo impede que ele dispare tudo de uma vez
   caso a janela do Telegram mude depois (mesmo risco do ADR-0121).

O **cálculo do líquido não muda**: `calcularLiquido` continua sendo `total − comissão − frete`
(ADR-0042). Ele já bate com o MP; o que estava errado era o dia a que o valor era atribuído.

## Consequências

- **Positivas:** a coluna "Liberação", os selos liberado/a liberar, o total do rodapé e o KPI
  "A sacar" passam a refletir o extrato real do MP. R$ 3.136,21 saem de "A liberar" e entram em
  "liberado" na primeira execução. A notificação do Telegram herda a correção sem mudança própria.
- **Negativas / dívidas:**
  - A janela do MP é de 120 dias: venda mais antiga que isso não é reconciliada (aceitável — a
    liberação já ocorreu há muito).
  - Uma venda pode mudar de dia entre duas leituras da tela; é o comportamento correto, mas
    quem tiver anotado o número do dia anterior verá diferença.
  - **Em aberto (decisão do Diego):** a notificação do Telegram continua avisando só o que libera
    **no dia corrente**. Dinheiro cuja liberação for descoberta com atraso pela reconciliação não
    gera aviso. Ampliar para uma janela retroativa (ex.: 7 dias) é mudança separada, porque exige
    decidir o tamanho da janela e o tratamento do backlog histórico.

## Alternativas consideradas

- **Aumentar `JANELA_HORAS` de 72h para ~30 dias:** re-lê pedidos no ML que não mudaram; custo de
  rede multiplicado por ~10 dentro de um orçamento de 120s que já estoura. Rejeitada.
- **Usar `net_received_amount` do MP como líquido:** quebraria o ADR-0042 (cross-docking desconta
  frete cheio e ignora comissão → markup falso) e não resolveria a data, que é o defeito real.
  Rejeitada.
- **Recalcular a liberação na tela a partir do MP ao vivo:** exporia token do MP ao frontend e
  repetiria a varredura a cada abertura. Rejeitada.
