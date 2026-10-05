# ADR-0180 — Cupom pago pelo vendedor entra na venda, no líquido e no imposto

**Status:** Aceito (2026-10-05)
**Data:** 2026-10-05
**Relacionado:** [ADR-0042](0042-liquido-economico-cross-docking.md) (fórmula do líquido — emendada aqui),
[ADR-0038](0038-fonte-unica-ml-vendas-kpis.md) (fonte única `ml_vendas`),
[ADR-0055](0055-imposto-por-origem-nacional-importado.md) (base do imposto — emendada aqui),
[ADR-0031](0031-integracao-financeira-mercado-pago.md) / [ADR-0093](0093-financeiro-mp-pela-conexao-ml.md) (MP pela conexão ML),
[ADR-0155](0155-central-organizacoes-cobranca-auditavel.md) (billing — fora deste ADR)
**Decisores:** Diego (2026-10-05)

## Contexto

Pack 2000014948061807 (Avil, 09/09/2026): 2 orders × R$ 66,40 com "Desconto oferecido por cupom −R$ 5,00".
O ML mostra Preço dos produtos R$ 127,80; o PubliAI mostrava Venda R$ 132,80, Líquido após ML R$ 99,16,
imposto e lucro sobre o valor cheio.

Medido na API (GET-only, 2026-10-05):

- `/orders/{id}` não reflete o cupom do vendedor: `coupon.amount = 0`, `payments[].coupon_amount = 0`,
  `unit_price` = 66,40, `total_amount` = 66,40. Só a tag `order_has_discount` indica que houve desconto.
- `/orders/{id}/discounts` traz `type: coupon` com `amounts.seller = 2,50` por order; o `type: discount`
  (3,50, 69,90 → 66,40) é promoção e **já está** no `unit_price`.
- O pagamento do MP (`/v1/payments/{id}` e `/v1/payments/search`, que o sync já lê) traz
  `fee_details: [{type: "coupon_fee", fee_payer: "collector", amount: 2.5}]` e
  `net_received_amount` 37,93 = 66,40 − 7,67 (comissão) − 18,30 (frete) − **2,50**.
- A comissão do ML já é calculada sem o cupom (12% × 63,90 = 7,67).
- `raw.coupon.amount > 0` **não** diz quem pagou: na order 2000018785246302 o cupom de 6,00 é do ML
  (`coupon_fee` 0, `net_received` 45,94 = o líquido que já gravávamos); na 2000018775766534 o cupom de
  5,00 é do vendedor (`coupon_fee` 5).
- Amostra Avil: 0/40 orders sem a tag têm `coupon_fee`; 8/40 com a tag têm.

## Decisão

1. **Fonte:** cupom do vendedor = Σ `fee_details[type=coupon_fee, fee_payer=collector].amount` dos
   pagamentos da order no MP. Nada de `/discounts`, `raw.coupon` ou `paid_amount`.
2. **Armazenamento:** `ml_vendas.cupom_vendedor numeric` (null = MP não lido; preservado como
   `estorno` por `preservarDadosMP`) e `ml_vendas_itens.cupom_vendedor numeric not null default 0`
   (rateio da order pelo valor dos itens; na prática toda order do ML tem 1 item — 0 de 4.801 têm 2+).
   `total_amount` e `unit_price` continuam sendo o dado cru do ML.
3. **Líquido (emenda ADR-0042):** `liquido = total − comissão − frete − cupom_vendedor`, calculado
   depois da preservação dos dados do MP (falha de leitura não reinfla o líquido).
4. **Venda/bruto:** em toda tela, bruto da venda = `total_amount − cupom_vendedor`; valor do item =
   `unit_price × qty − cupom_vendedor do item`. Helpers únicos `brutoDaVenda`/`valorDoItem`.
5. **Imposto (emenda ADR-0055, decisão do Diego):** base = valor do item já sem o cupom do vendedor
   (desconto incondicional). Ex.: 16% × 63,90 = 10,22 por item (arredondado por item, como antes) → 20,44.
6. **Billing da plataforma fica como está** (`platform_billing_preview.gross_cents` = `total_amount`).
   Decisão do Diego: mudar a cobrança é decisão separada; os extratos fechados não são tocados.
7. **Histórico:** backfill one-off das orders com tag `order_has_discount` e `cupom_vendedor` null,
   lendo o MP por pagamento.

## Consequências

- Pack do caso: Venda 127,80 · Líquido após ML 94,16 · imposto 16% 20,44 · lucro 21,72.
- Toda tela que lê `ml_vendas` (Faturamento, Financeiro, Dashboard, Publicados, Vendas SKU, dossiê,
  cockpit, export, vitrine) passa a mostrar o valor sem o cupom do vendedor.
- O líquido gravado fica igual ao `net_received_amount` do MP nas orders sem cross-docking.
- Cupom bancado pelo ML continua sem afetar o vendedor.
- Pendência: billing sobre valor sem cupom, se o Diego decidir.
