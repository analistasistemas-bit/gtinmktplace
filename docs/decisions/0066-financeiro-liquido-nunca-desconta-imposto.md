# ADR-0066 — Financeiro > Detalhe do líquido nunca desconta imposto

**Data:** 2026-07-09
**Status:** aceito
**Refina:** [ADR-0055](0055-imposto-por-origem-nacional-importado.md)

## Contexto

A ADR-0055 definiu que o líquido pós-venda desconta o imposto estimado por origem
(nacional/importado) "em todas as telas" para calcular markup/lucro de forma realista.

Isso criou uma inconsistência na tela **Financeiro > Detalhe do líquido**
(`src/pages/DetalheFinanceiro.tsx`): o banner "Líquido total" (via `calcularResumo`) nunca
descontou imposto, mas a tabela de pedidos abaixo dele (via `agruparPorPedido`, mesma função
usada pela aba Faturamento → Vendas) descontava — dois números de "líquido" diferentes na mesma
tela, e nenhum dos dois documentado como tal para o usuário. Reportado: pedido com R$ 38,15
recebidos no Mercado Pago aparecendo como R$ 31,75 de "Líquido" na tabela (diferença = imposto
de 8%).

Essa tela tem ações de conciliação de caixa (Registrar saque / Desfazer saque) — o valor de
"Líquido" nela precisa ser o dinheiro real que cai na conta, não uma projeção com desconto fiscal.

## Decisão

Na tela **Financeiro > Detalhe do líquido** (e no export correspondente, "Financeiro · Detalhe"):

- **"Líquido" nunca desconta imposto** — sempre `líquido + imposto` (o `liquido` interno de
  `agruparPorPedido`/`ItemPedido` já vem líquido de imposto por ADR-0055; a tela soma o imposto
  de volta antes de exibir). Bate 1:1 com o banner e com o Mercado Pago.
- **"Markup" continua líquido de imposto** — inalterado, mesma base de todas as outras telas
  (Faturamento, Publicados): `(líquido − imposto − custo) ÷ custo`.
- A coluna "Imposto" (no detalhe expandido do pedido) continua mostrando o valor informativo.

**Escopo:** só essa tela. A aba **Faturamento → Vendas** (`aba-vendas.tsx`), que reusa o mesmo
componente `DetalhePedidoItens` e a mesma `agruparPorPedido`, continua mostrando o líquido já
líquido de imposto — não há prop `liquidoBruto` lá (default `false`). Publicados/Detalhe de
vendas (`detalhe-vendas.ts`) também não mudam.

## Consequências

- "Líquido" e "Markup" nessa tela agora representam conceitos diferentes (dinheiro real vs.
  margem ajustada por imposto) — documentado no rodapé da página.
- `ItemPedido`/`Pedido` de `pedidos-faturamento.ts` não mudam de formato; o ajuste é só na
  camada de exibição (`DetalhePedidoItens` com prop `liquidoBruto`, `DetalheFinanceiro.tsx`,
  `buildFinanceiroDetalheReport`).
