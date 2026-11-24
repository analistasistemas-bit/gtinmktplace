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

**4. O aviso só sai se houve baixa daquele pedido.** Medido na primeira varredura com o novo
gatilho (18/08/2026, 03:00 UTC): 26 pedidos cancelados históricos — vários de 2021/2024,
anteriores ao ledger — dispararam o alerta de uma vez, in-app e no Telegram. Sem baixa não há
saldo devendo voltar e o operador não tem o que conferir, então `houveBaixaDeVenda` (movimento
`venda` com `quantidade < 0` para a referência do pedido) passa a ser condição do aviso. Falha de
leitura dessa consulta **não** cala o alerta: perder o aviso de um cancelamento real é pior que
repetir um ruidoso, e o dedupe garante no máximo uma repetição.

O corte é só do aviso. O ramo que repõe continua chamando a RPC sempre, porque é lá que nasce o
tombstone `cancelamento_sem_baixa` que impede uma execução `paid` atrasada de baixar um pedido já
cancelado (D-19).

**5. Emenda 03/11/2026: claim `cancel_purchase` gera um aviso só.** Medido na Hairfly (pedido
`2000019283366562`, claim `5605436658`): o comprador pede o cancelamento e o mediador do ML fecha
em cerca de 3 minutos, sem ação disponível para o vendedor (4 casos em 90 dias, média 3 min). O
operador recebia "Nova reclamação… aja dentro do prazo" e depois "Confira o que voltou", dois
textos que não descrevem o caso.

O `sync-devolucao` deixa de avisar `cancel_purchase`, e o aviso desta decisão ganha texto próprio
quando o pedido tem esse claim. A decisão de repor **não muda** (decisão 3): o estoque continua
sem reposição automática, e o texto mantém o pedido de entrada manual sem afirmar que a mercadoria
não saiu. Falha ao ler o claim cai no texto genérico, nunca cala o aviso.

Custo aceito: `cancel_purchase` que o ML não concluir não gera alerta no Telegram; continua visível
em Faturamento › Devoluções. Cancelamento que cai no ramo de reposição segue sem aviso, como já era.

**6. Emenda 13/11/2026: o aviso genérico diz o motivo real.** Caso Hairfly `2000019297158586`: envio
entregue, mediação "Produto com defeito ou diferente" fechada pelo ML com cobertura. O texto antigo
("não dá para confirmar que a mercadoria não foi despachada") não dizia por que o pedido caiu.
Agora o título já diz "estoque NÃO reposto"; o aviso inclui `Motivo:` (tipo + `reason_texto`) e
`Desfecho:` (`detalhe.title`) do claim mais recente do pedido em `ml_devolucoes` (`claimDoPedido`,
que substitui `cancelamentoPeloComprador`); separa "a mercadoria já saiu" (`shipped`, `delivered`,
`not_delivered`) de "não dá para saber"; e leva o link do pedido. Sem claim, a linha some — nada é
inventado. A decisão de repor **não muda**.

**7. Emenda 24/11/2026 (decisão 3): `ready_to_ship` só é pré-despacho com substatus de preparo.** Motivo:
`ready_to_ship` é guarda-chuva no ML — o substatus diz se o pacote ainda está com o vendedor. Com a coleta já
feita (`picked_up`; em Cross Docking o pacote sai na coleta) ou o pacote entregue na agência/hub (`dropped_off`,
`in_hub`), a regra antiga repunha estoque de mercadoria que já tinha saído, que é o erro caro (estoque
fantasma, venda sem produto). Decisão do Diego: corrigir a regra em **todos** os caminhos (webhook
`sync-venda`, reconciliação e a fila do ADR-0211), que passam o substatus por `envioParaTratamento`.

- **Repõe** com `ready_to_ship` só se o substatus for de preparo: `ready_to_print`, `printed` (etiqueta) ou
  `invoice_pending` (aguardando NF). É uma allowlist, como a de status: só o que prova que o pacote está com o
  vendedor.
- **Só avisa** com qualquer outro substatus. Os vistos em produção em 24/11 (vendas `ready_to_ship`):
  `invoice_pending` 129, `in_hub` 72, `dropped_off` 29, `in_packing_list` 24, `printed` 11, `picked_up` 1.
  `in_hub`, `dropped_off`, `picked_up`, `in_warehouse` são os que o próprio app já trata como "A caminho"
  (`src/lib/ml-status.ts`). `in_packing_list` (pacote na lista da coleta) e substatus desconhecido também só
  avisam: repor mercadoria que saiu custa mais que pedir uma entrada manual. A documentação de status do ML
  (gerenciamento de envios) não pôde ser lida em 24/11 (403); a lista sai do código e dos dados de produção.
- **Substatus ausente** (leitura antiga, envio sem substatus) segue como antes: `ready_to_ship` repõe, para
  não regredir o caso comum. `pending` e `handling` não mudam.
- O crédito de kit (`entraNoCreditoKit`, ADR-0200) segue o mesmo predicado. O texto do aviso não muda.

**8. Emenda 24/11/2026 (decisão 3): envio `cancelled` repõe quando o histórico prova que a etiqueta nunca foi
impressa.** Decisão do Diego. Dos 9 cancelamentos que a fila do ADR-0211 concluiu em 24/11, 7 tinham envio
`cancelled` que nunca saiu e só avisaram: na prática a reposição automática quase não acontecia.

- **Prova** (`GET /shipments/{id}/history`, lida só para envio `cancelled` sem substatus): `id` e `status=cancelled`
  conferem, `substatus` nulo também no histórico, `mode=me2`, `date_first_printed` presente e nula, e `date_shipped`, `date_delivered`,
  `date_not_delivered` e `date_returned` nulas. Qualquer outra forma não prova.
- **Por que não `date_shipped`:** está vazia também em envio `picked_up`/`dropped_off` (34 de 34 em 24/11).
- **Medido em 24/11:** 775 envios que saíram (coletados, despachados, entregues, devolvidos), em 5 orgs, 90 dias:
  **nenhum** sem data de impressão. Dos 212 `cancelled`, 208 nunca impressos; os 4 impressos mantiveram a data,
  ou seja, o ML não a apagou neles. Os dois pedidos que originaram a decisão 3 também nunca foram impressos.
- **`pack_splitted` e qualquer substatus ficam de fora:** a peça pode ter ido em outro envio.
- **Travas, só avisa:** (a) `entrada` ou `ajuste` do SKU depois da baixa; (b) linha de `variacoes` do SKU criada
  depois da baixa, porque a planilha grava saldo absoluto numa linha nova **sem** movimento no ledger; (c) pedido já
  avisado (`estoque_cancelado_despachado`): o operador já foi instruído, o app não age por cima. (c) também impede
  reposição retroativa no deploy.
- **Fonte das baixas:** o ledger (baixas ainda abertas), não o catálogo atual.
- **Leitura falhou** (rede, 401/403, 429, 5xx, prazo) ou trava não lida: não repõe. Webhook e reconciliação deixam para a
  fila do ADR-0211 (`adiado`) se a obrigação está armada e a drenagem ligada; senão avisam na hora. A fila tenta de novo
  e avisa da 3ª tentativa em diante. 4xx definitivo conta como "não prova" e avisa.
- **Estado misto na fila** (parte já estornada): com prova repõe o que está aberto; sem prova, avisa da 3ª tentativa em
  diante (antes ficava pendente para sempre, sem aviso).
- Vale para webhook, reconciliação e fila, e para o crédito de kit (mesmo predicado).
- **Risco aceito pelo Diego (24/11):** lote da fila com 1.000 linhas de ledger conta como leitura falha e a drenagem da
  org para naquele ciclo. Medido: no máximo 2 baixas por pedido e 20 linhas nos 20 maiores pedidos de uma org.
- **Aviso:** o ledger é relido logo antes de reservar; tudo já estornado por outra execução não avisa. Sobra a janela entre
  essa releitura e o envio.
- **Risco aceito:** um ajuste feito fora do app (balcão) não deixa rastro; e as travas são lidas antes do estorno, não
  na mesma transação.

## Consequências

**Aceitas.** A reconciliação revisita o mesmo pedido cancelado de hora em hora enquanto ele estiver
na janela. Isso é seguro porque os dois lados são idempotentes: `estornar_estoque` por referência
própria dentro da RPC, e o aviso por `reservarNotificacao` (chave `estoque_cancelado_despachado` +
`order_id`). O custo é uma RPC no-op por item por varredura, em pedidos cancelados — raros.

**Custo já pago, não reversível.** O corte da decisão 4 nasceu *depois* do deploy: a primeira
varredura com o gatilho novo emitiu 26 alertas de cancelamentos históricos, in-app e no Telegram,
nas duas orgs. Só 8 deles tinham baixa de estoque — os outros 18 eram ruído puro. A lição, que
vale para qualquer caminho de alerta novo que leia dado histórico: **a primeira execução alerta
sobre a história inteira**, então o predicado de "isso ainda importa?" precisa existir *antes* do
deploy, não depois de ver o estrago. Mesma classe da trava LOUD em caminho financeiro.

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
