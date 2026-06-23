# ADR-0039 — Menu Faturamento por pedido (pack) + geografia (UF) + KPIs operacionais

**Status:** Proposto — branch `worktree-adr-faturamento-por-pedido` (aguardando aprovação do plano de implementação)
**Data:** 2026-06-23
**Contexto relacionado:** ADR-0037 (módulo Faturamento / webhooks ML), ADR-0038 (fonte única `ml_vendas`), ADR-0033 (rateio de frete de pack)

## Problema

O menu **Faturamento** virou uma listagem descritiva, não a tela que responde à pergunta para a qual ele existe: **"o que e como estou vendendo?"**. Dois problemas concretos, levantados pelo operador (Diego) e confirmados em código/dados:

1. **Listagem por `order_id`, não por pedido real.** A aba Vendas mostra **uma linha por `order_id`**. Quando o cliente compra vários produtos num único checkout, o Mercado Livre cria **vários `order_id` com o mesmo `pack_id`** — então um carrinho vira N linhas que "se repetem só mudando o produto". **86% das vendas (30/35, janela 30 dias)** têm `pack_id`; há packs de até 5 pedidos. Consequências: "Pedidos" e "Ticket médio" contam checkouts errados (inflados ~14%), e a linha exibe `total_amount` (valor de 1 item) em vez de `paid_amount` (o que o cliente pagou no checkout). A noção "1 checkout = 1 envio = 1 etiqueta" **já existe no código**, mas só internamente (o rateio de frete por pack, ADR-0033) — nunca virou linha visual nem KPI.

2. **Falta a informação essencial de venda**, sem duplicar os outros menus. Não há markup do pedido na linha, não há de quem/para onde vendemos (geografia), nem KPIs operacionais ("o que despachar", recompra). Parte do que se sugeriu antes (DRE, margem agregada, "a receber", ranking de produto, curva ABC) **é dos outros menus** e não deve ser repetida aqui.

## Decisão

### 1. Fronteira clara dos 3 menus (anti-duplicação)

| Menu | Pergunta | Dono de |
|---|---|---|
| **Publicados** | "Como estão meus **anúncios**?" | catálogo, status, encalhados, moderação |
| **Financeiro** | "**Quanto** eu ganho?" | líquido, margem agregada, DRE, taxas, a receber |
| **Faturamento** | "**O que** e **como** estou vendendo?" | os pedidos em si: o que saiu, para quem, para onde, status de cada venda |

O **markup líquido por pedido/produto** fica no Faturamento por ser atributo da venda ("essa venda específica deu lucro?"), distinto da análise financeira agregada (Financeiro).

### 2. Núcleo — visão por pedido (pack)

- **`pedido = pack_id ?? order_id`**: uma linha por pedido. Pedidos sem pack (compra de 1 item) seguem sendo 1 linha — `order_id` é a chave nesse caso.
- **Linha do pedido:** data · comprador (+ selo "recorrente" quando o `comprador_id` repete no período) · nº de itens · **valor pago real (`paid_amount`)** · status de pagamento · status de envio · origem (PubliAI/Fora) · **markup líquido do pedido**.
- **Detalhe (expand):** os produtos do pedido (título, cor, código, EAN, qtd, preço, **markup líquido por produto**) + frete único do envio, comissão e rastreio do pacote.
- Reaproveita o agrupamento por `shipping_id ?? pack_id` (já em `ratearLiquidoPorFrete`, ADR-0033) e custo/líquido/markup (`calcularResumo`, `calcularMarkup`, `useCustos`). **Frete conta uma vez por pack** (não dupli-contar). Markup do pedido = `(líquido do pack − custo dos produtos do pack) ÷ custo`; por produto = `(líquido rateado do item − custo do item) ÷ custo`. Sem custo cadastrado → "—" (igual `DetalheFinanceiro`).
- **KPIs corrigidos:** "Pedidos" passa a contar pedidos reais (packs); "Ticket médio" usa o valor do checkout.

### 3. KPIs operacionais (curados, sem duplicar)

- **O que vendeu:** Pedidos reais · Unidades · Ticket médio/pedido · **Itens por pedido** · Markup líquido médio.
- **Para quem:** Compradores únicos · **% de recompra** (via `comprador_id`, já existente).
- **Como está a venda (clicáveis, filtram a tabela):** A despachar · Em trânsito · Entregue · Devolução em curso (reusa `shipping_status`).
- Visual no padrão de cor/elevação alinhado a Publicados/Financeiro (ADR informal desta sessão; `tom`/`valorCor`/hover).

### 4. Geografia por UF (mapa de calor)

- O endereço do comprador **não está em `ml_vendas`** hoje (o `raw.shipping` traz só `{id}`; `raw.buyer` só `{id, nickname}`). Mas o backfill **já chama** `/shipments/{id}` (`buscarShipment`, em `_shared/faturamento/io.ts`) para status/rastreio/logística — e o `receiver_address` (cidade/estado) **vem nessa mesma resposta**. Logo, **não há chamada nova ao ML**: basta estender `buscarShipment` para extrair `receiver_address.city.name` (cidade) e `receiver_address.state.id` (UF, ex. `BR-SP`).
- Novas colunas `cidade text` e `uf text` em `ml_vendas`. Captura ambas (cidade vem de graça); a UI da Fase 2 mostra **mapa de calor do Brasil por UF** (SVG inline, sem dependência pesada), "estados atingidos", top estado (%) e top cidades.
- **Risco:** o `receiver_address` pode vir limitado por privacidade do ML em parte das vendas (especialmente FULL). UF tende a ser confiável; confirmar o formato exato do shipment na implementação e tratar `null` como "não informado".

## Consequências

- O Faturamento deixa de duplicar Publicados/Financeiro e ganha identidade ("o que e como vendo").
- "Pedidos"/"Ticket" passam a refletir checkouts reais; o operador para de tratar/contar o mesmo envio 2×.
- A Fase 1 é **client-side** (reaproveita cálculo/colunas existentes) — entrega rápida e reversível.
- A Fase 2 adiciona 2 colunas + escrita no backfill + re-backfill; sem nova rota de API ao ML.
- `comprador_id` precisa ser exposto no tipo `Venda` (já é coluna; hoje não está no select/tipo do front).

## Plano de implementação (faseado)

**Fase 1 — Reorganização por pedido + KPIs (sem backend):**
- Agregador puro `agruparPorPedido(vendas)` em `src/lib/` (chave `pack_id ?? order_id`), reusando o rateio de frete; markup por pedido e por item. Testes (vitest, RED→GREEN).
- `aba-vendas.tsx`: linha = pedido, expand = produtos; coluna de markup líquido na linha e no item; KPIs novos (itens/pedido, markup médio, compradores únicos, % recompra) com o padrão de cor/elevação.
- Expor `comprador_id` em `buscarVendas`/tipo `Venda`.
- Contadores de status clicáveis (filtram a tabela).

**Fase 2 — Geografia (backend leve + mapa):**
- Migration: `ml_vendas.cidade`, `ml_vendas.uf`.
- `buscarShipment` (io.ts) passa a retornar `cidade`/`uf` do `receiver_address`; `upsertVenda` grava as colunas. Deploy das functions afetadas após a migration (ordem importa, ver ADR-0038).
- Re-backfill para popular o histórico.
- Front: KPIs de geografia + componente de **mapa de calor por UF** (SVG inline) + top cidades.

**Fora de escopo (continua nos outros menus):** DRE, margem agregada, "a receber", ranking de produto, curva ABC, ruptura de estoque (Financeiro/Publicados).
