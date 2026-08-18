# ADR-0121: Cancelamento de pedido tratado também pela reconciliação

**Status:** Aceito
**Data:** 2026-08-18
**Decisores:** Diego
**Refina:** [ADR-0094](0094-estoque-unico-cadastro-manual.md) D-7 (cancelamento repõe só o que foi baixado)
**Contexto relacionado:** ADR-0037 (reconciliação como rede de segurança de webhook)

## Contexto

O tratamento de pedido cancelado — repor o estoque quando a mercadoria não saiu, avisar quando
não dá para repor com segurança — vivia inteiro dentro do `sync-venda`, que só roda por webhook
`orders_v2`.

Medido em produção em 18/08/2026, investigando por que o saldo do sabonete NIVEA (SKU `00000029`)
não batia com o Mercado Livre:

- Os pedidos `2000017926934620` e `2000017939290244` receberam **um único** webhook cada — o da
  compra, ainda `paid`, que baixou o estoque. Nenhum webhook no cancelamento (14/08 e 17/08).
- Quem gravou `status='cancelled'` foi a varredura horária do `reconciliar-faturamento`, que não
  toca estoque nem notifica.
- Resultado: **zero** linhas na categoria `pos_venda` na org inteira, contra 888 em `vendas`, e
  zero movimentos `estorno_venda` com 4 pedidos cancelados que tiveram baixa. O saldo local ficou
  abaixo do físico, sem nenhum aviso.

O ramo que existia para cobrir exatamente esse caso ("o estoque NÃO foi reposto automaticamente —
confira o que voltou e dê entrada manual") nunca executou uma vez sequer.

## Decisão

**1. O tratamento de cancelamento passa a ter dois gatilhos.** A lógica sai do `sync-venda` para
`_shared/estoque/cancelamento.ts` (`tratarPedidoCancelado`) e é chamada também pelo
`reconciliar-faturamento`, nos dois passos: no de claims/devoluções e no de vendas da janela de 72h.

O passo de claims é o que importa para o caso que originou o ADR: pedido cancelado dias depois já
saiu da janela de 72h, e chega por `buscarClaimsSeller` → `upsertDevolucao` → `upsertVenda`.

**2. A decisão de repor não muda.** Continua valendo a allowlist de pré-despacho do ADR-0094 D-7
(`pending`, `handling`, `ready_to_ship`, ou pedido sem envio). Tudo o mais avisa.

**3. Envio `cancelled` avisa, não repõe.** É o estado dos dois pedidos que originaram o ADR, e a
tentação era incluí-lo na allowlist — "envio cancelado" soa como "mercadoria não saiu".

Não entra: ambos foram `buyer_cancel_express` com mediação e `tem_devolucao=true`, ou seja o
cancelamento veio de disputa, dias depois da compra, e a mercadoria pode ter saído. Repor nesse
caso criaria estoque fantasma, que empurra unidade inexistente para o canal — exatamente o
oversell que a investigação de 18/08 encontrou (11 unidades vendidas no ML acima do que entrou).
Falha fechada continua sendo a regra: só repõe o que é comprovadamente pré-despacho.

## Consequências

**Aceitas.** A reconciliação revisita o mesmo pedido cancelado de hora em hora enquanto ele estiver
na janela. Isso é seguro porque os dois lados são idempotentes: `estornar_estoque` por referência
própria dentro da RPC, e o aviso por `reservarNotificacao` (chave `estoque_cancelado_despachado` +
`order_id`). O custo é uma RPC no-op por item por varredura, em pedidos cancelados — raros.

**Não resolve sozinho** o saldo já divergente: o que foi baixado indevidamente no passado continua
baixado. Corrigir isso é entrada manual, com conferência física do que voltou — decisão do
operador, não do sistema.

## Alternativas descartadas

- **Incluir `cancelled` na allowlist que repõe:** ver decisão 3. Trocaria um erro visível (aviso
  pedindo conferência) por um erro invisível (estoque fantasma).
- **Duplicar o bloco no `reconciliar-faturamento`:** duas cópias da mesma regra de estoque
  divergem na primeira mudança. A regra é uma só; o que muda é quem chama.
- **Reprocessar cancelamentos pelo webhook, forçando o ML a reenviar:** não há como; o reenvio é
  decisão do ML. A reconciliação existe justamente para isso (ADR-0037).
