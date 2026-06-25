# ADR-0042 — Líquido da venda é a estimativa econômica (não o net do Mercado Pago): artefato cross-docking

**Data:** 2026-06-25
**Status:** Aceito — implementado na branch `worktree-fix-liquido-cross-docking` (pendente validação local + reconciliação + deploy)
**Contexto relacionado:** ADR-0031 (financeiro Mercado Pago), ADR-0037 (módulo Faturamento / webhooks ML), ADR-0038 (fonte única `ml_vendas`), ADR-0040 (menu Financeiro caixa/lucro/margem).

## Contexto

O operador (Diego) reportou um anúncio vendido a **R$ 16,00** com custo **R$ 5,32** aparecendo com
**markup −56%** (prejuízo) na tela de Faturamento — mesmo vendendo a ~3× o custo.

Investigação com as APIs reais do ML/MP (pedido `2000017104261012`, conta AVILBV) reconstruiu o caso:

| Movimento | Valor | Fonte |
|---|---|---|
| Pagamento do item | + R$ 16,00 | `/v1/payments/164910207173` |
| Charge `shp_cross_docking` (frete **cheio** da etiqueta) | − R$ 13,64 | `charges_details` do pagamento |
| **`net_received_amount`** (gravado em `ml_vendas.liquido`) | **R$ 2,36** | — |
| Reembolso da parte do frete do comprador | + R$ 7,99 | pagamento à parte `164910294607` (`marketplace_shipment`) |
| Comissão ML (`sale_fee`) | − R$ 2,72 | cobrada **fora** do pagamento (`fee_details: []`) |

Fatos confirmados nas APIs:

1. **Frete real do vendedor = R$ 5,65** (`/shipments/{id}/costs` → `senders[].cost`; `list_cost`
   13,64 = comprador 7,99 + vendedor 5,65). O `frete_vendedor` que já gravamos está **correto**.
2. Em envio **cross-docking** (`logistic.type = xd_drop_off`), o MP debita o **frete CHEIO (13,64)**
   no pagamento do item e devolve a parte do comprador (7,99) num **pagamento separado**
   (`marketplace_shipment`), que o agregador do Financeiro **descartava**.
3. Nesta conta a **comissão não é deduzida no pagamento** (`fee_details` vazio) — é cobrada à parte.

Logo o `net_received_amount` isolado (2,36) **desconta frete a mais** (cheio em vez do líquido do
vendedor) **e ignora a comissão** → é um artefato de contabilização do MP, não o que o vendedor
embolsa. O líquido econômico real da venda é `16 − 2,72 − 5,65 = R$ 7,63` → **markup +43%**.

Diagnóstico de alcance: das 45 vendas pagas, **31 tinham `liquido` divergente** da conta econômica
(29 com `liquido < frete`, assinatura do cross-docking). A coluna Markup estava não-confiável em
todo o módulo — ora inflada (comissão nunca descontada), ora negativa (frete cheio).

Diego levantou a restrição central: **o líquido do Faturamento tem que bater com o do Financeiro** —
não faz sentido um número em cada tela. Após o ADR-0038/0040, **as duas telas leem `ml_vendas`** (via
`resumo-vendas.ts`), então o `liquido` armazenado é o ponto único que governa ambas.

## Decisão

1. **Líquido da venda = estimativa econômica `bruto − comissão − frete real do vendedor`**, e não o
   `net_received_amount` do Mercado Pago. Em `mapearPedidoParaVenda` (`_shared/faturamento/venda.ts`)
   o `liquido` passa a ser **sempre** `calcularLiquido(total, sale_fee_total, frete_vendedor)`. O
   `frete_vendedor` continua vindo de `/shipments/{id}/costs` (`senders[].cost` = líquido do
   vendedor, já com o desconto obrigatório).

2. **Estorno e data de liberação continuam vindos do Mercado Pago** (`transaction_amount_refunded`
   e `money_release_date`), que são confiáveis por pagamento. Só o `net` deixou de ser usado para o
   líquido.

3. **Fonte única `ml_vendas` (ADR-0038) governa os dois módulos.** Faturamento
   (`pedidos-faturamento.ts`) e Financeiro (`resumo-vendas.ts`/`calcularResumo`) leem
   `ml_vendas.liquido`, então corrigir a gravação conserta as duas telas com o **mesmo** número.

4. **Rateio de frete em pack ficou net-independente** (`ratearLiquidoPorFrete`, compartilhado pelos
   dois módulos). O `frete_vendedor` é gravado repetido em cada pedido do pack (é o frete do ENVIO):
   o rateio conta uma vez (max), distribui por **peso** (senão por valor) e compõe
   `líquido = bruto − comissão(sale_fee_total real) − frete atribuído`. Antes ele derivava a tarifa
   do net e ancorava a soma no net (`somaLiqCru`) — o que reinjetava o artefato. Agora a soma do
   grupo é `Σbruto − Σcomissão − freteEnvio`, e o breakdown `comissão + frete == descontos` fecha com
   a coluna `frete_vendedor` real (não com a soma crua, que duplica em pack).

5. **Reconciliação dos registros existentes:** recalcular `ml_vendas.liquido` por pedido como
   `bruto − comissão − frete atribuído`, com o frete do envio rateado por valor entre os pedidos do
   pack (single → frete inteiro do próprio envio). A soma por envio é idêntica à do rateio por peso
   da camada de leitura (o rateio por valor só muda a atribuição por linha, não o total), então o KPI
   que soma `liquido` cru (`faturamento.ts/calcularKpis`) bate. Idempotente.

## Consequências

- **Positivas:** markup/lucro/margem passam a refletir o que o vendedor realmente embolsa; o exemplo
  sai de −56% (prejuízo falso) para +43%. Faturamento e Financeiro mostram o mesmo líquido por
  construção (fonte única).
- **Impacto agregado real:** o líquido total do período cai ~R$ 37,59 (de ~640,51 para 602,92 nas 46
  vendas) — porque a comissão, antes nunca subtraída do net nesta conta, agora entra. Não é perda
  nova: é o líquido **correto** (estava superestimado). Por-pedido o efeito varia (cross-docking sobe,
  os demais caem pela comissão).
- **Premissa single-tenant (conta AVILBV):** a fórmula assume que a **comissão é cobrada fora do
  pagamento** (`fee_details` vazio) — verdadeiro nesta conta. Se um futuro tenant tiver a comissão
  deduzida no próprio pagamento (`fee_details` preenchido), subtrair `sale_fee` de novo
  **duplicaria** o desconto. Quando virar SaaS multi-tenant, o cálculo precisa detectar a origem da
  comissão (ML vs MP) por conta. Registrado como dívida do épico SaaS.
- **`net_received_amount` deixa de ser armazenado:** a reconciliação sobrescreve o `liquido` que
  guardava o net; ele não é persistido em outro lugar. Caso se precise dele no futuro, refazer o
  fetch no MP. Aceito — o net isolado não é o número de negócio.
- **Frete null:** envios ainda não custeados (`frete_vendedor` null) entram como frete 0 → líquido
  superestimado até o shipment ser custeado e a venda reconciliada. Comportamento já existente.
- **Packs:** `ratearLiquidoPorFrete` (compartilhado pelos dois módulos) passou a compor o líquido sem
  o net (ver Decisão 4). A reconciliação grava o líquido por valor; a camada de leitura redistribui
  por peso — a soma por envio é a mesma, então só a atribuição por linha pode variar ±centavo.
- **Código morto do MP ao vivo:** `agregarFinanceiro`/`rateio.ts` (`_shared/mercadopago/`) e o edge
  `resumo-financeiro` seguem mortos (ADR-0040) — **não** foram alterados. A correção do net deles
  seria redundante; ficam para remoção quando o Diego confirmar que não precisa da ponte ao vivo.

## Sequência de entrega (ordem importa — pendente do Diego)

1. Validar local (branch) a tela de Faturamento + Financeiro com a reconciliação aplicada.
2. **Reconciliar prod** (recalcula `liquido` de todas as vendas, frete do envio rateado por valor;
   single → frete inteiro do próprio envio). Idempotente; sobrescreve o net armazenado:
   ```sql
   with grp as (
     select id, total_amount, sale_fee_total, frete_vendedor,
            coalesce(shipping_id, pack_id, order_id) as envio
     from ml_vendas
   ), agg as (
     select envio, max(coalesce(frete_vendedor,0)) as frete_envio, sum(total_amount) as bruto_envio
     from grp group by envio
   )
   update ml_vendas v set liquido = round((
     g.total_amount - g.sale_fee_total
     - case when a.bruto_envio > 0 then a.frete_envio * g.total_amount / a.bruto_envio else 0 end
   )::numeric, 2)
   from grp g join agg a using (envio) where g.id = v.id;
   ```
3. Deploy das edges de Faturamento que mapeiam venda (`ml-webhook`, `backfill-faturamento`,
   `reconciliar-faturamento`) com o `venda.ts` corrigido — para que novas vendas já gravem o líquido
   econômico. (Novos pedidos de pack gravam o frete inteiro por linha; a camada de leitura rateia no
   display e a reconciliação acima realinha o armazenado.)
4. Deploy do frontend (Render): a lógica de `resumo-vendas.ts` mudou (rateio net-independente), então
   o build do front precisa subir junto.

## Alternativas consideradas

- **Reconstruir o líquido pelo MP** (somar o reembolso `marketplace_shipment` + subtrair comissão):
  rejeitada — o reembolso não é vinculado ao pedido por `external_reference` (pareamento frágil) e a
  comissão não está no MP; a estimativa `bruto − comissão − frete` chega no mesmo número com dados
  autoritativos (`sale_fee` do pedido + `senders[].cost` do shipment).
- **Corrigir só a exibição** (mostrar "frete cheio" / "reembolso" para explicar o 2,36): rejeitada —
  o markup/lucro continuaria errado; o número de negócio é o líquido econômico.
- **Mexer separadamente em Faturamento e Financeiro:** rejeitada — violaria a restrição do Diego
  (têm que bater) e duplicaria lógica; a fonte única `ml_vendas` já garante consistência num ponto.
