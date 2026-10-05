# Plano — cupom do vendedor na venda (ADR-0180)

Branch `worktree-fix-cupom-vendas`. Caso-teste: pack 2000014948061807 (2 orders 66,40, comissão 7,67 cada,
frete do envio 18,30, coupon_fee 2,50 cada, alíquota 16%, custo 26,00 cada).
Esperado: Venda 127,80 · Líquido após ML 94,16 · Imposto 20,44 · Lucro 21,72. Order isolada …038668:
liquido gravado 37,93 (= net_received do MP). Cupom pago pelo ML (…785246302): continua 45,94.

## Task 1 — Migration (DDL via `supabase migration new` + `db push`)
- `alter table ml_vendas add column cupom_vendedor numeric;` (null = MP não lido)
- `alter table ml_vendas_itens add column cupom_vendedor numeric not null default 0;`
- `create or replace` da função da vitrine (cópia de `20261003232750_vitrine_identificacao.sql`) trocando
  `sum(i.quantity * i.unit_price)` por `sum(i.quantity * i.unit_price - i.cupom_vendedor)`.
- Regenerar `src/lib/database.types.ts` (ou editar as 3 linhas à mão).

## Task 2 — Sync (`supabase/functions/_shared/`) — TDD
- `mercadopago/financeiro.ts` `PagamentoMP`: `fee_details?: Array<{type?, fee_payer?, amount?}>`.
- `faturamento/venda.ts`:
  - `DadosPagamentoMP.cupom: number` ← Σ fee_details coupon_fee/collector (em `montarMapaLiquido`).
  - `mapearPedidoParaVenda`: `cupom_vendedor` = Σ cupom dos pagamentos achados (null se nenhum achado);
    `liquido = calcularLiquido(total, fee, frete, cupom ?? 0)`.
  - `calcularLiquido(total, saleFee, frete, cupom = 0)`.
  - `preservarDadosMP` também preserva `cupom_vendedor` (novo ?? anterior ?? null).
  - helper puro `ratearCupomNosItens(itens, cupom)` → `cupom_vendedor` por item proporcional a
    `unit_price × qty`, resíduo no maior.
- `faturamento/io.ts upsertVenda`: select anterior inclui `cupom_vendedor`; após preservar, recalcula
  `liquido` com o cupom preservado e grava os itens com o rateio do cupom preservado.
- Testes: `__tests__/venda.test.ts`, `enriquecimento.test.ts`, `io.test.ts` (falha do MP não reinfla).

## Task 3 — Agregador e telas (frontend + `_shared/platform-admin`) — TDD
- `sales-types.ts`: `Venda.cupom_vendedor?: number | null`, `VendaItem.cupom_vendedor?: number | null`.
- `sales-summary.ts`: exporta `brutoDaVenda(v)` e `valorDoItem(it)`; usa em `impostoDoItem`,
  `calcularResumo` (bruto, porItem.valor, vendasResumo.bruto/retido), `ratearLiquidoPorFrete`
  (base por valor + `liquido = brutoDaVenda − fee − frete`).
- Selects: `SELECT_VENDAS` (faturamento.ts) e `SALES_COLUMNS` (metrics-repository.ts) incluem
  `cupom_vendedor` na venda e no item.
- `faturamento.ts calcularKpis` (faturamento), `pedidos-faturamento.ts` (bruto, brutoFaturavel, base do
  rateio do líquido por item, maior item), `cascata-pedido.ts` (base da alíquota ponderada),
  `detalhe-vendas.ts`, `vendas-sku.ts`, `sku-dossie.ts`, `cockpit.ts` → `brutoDaVenda`/`valorDoItem`.
- Detalhe do pedido (`detalhe-pedido-itens.tsx`): linha "Cupom do vendedor" (Σ cupom_vendedor) na zona
  Pedido; a linha existente de `raw.coupon` vira "Cupom (comprador)" — informativa, fora da conta.
- Teste de regressão com o pack do caso (Faturamento: `agruparPorPedido` + `cascataDoPedido`;
  Financeiro: `calcularResumo` → bruto 127,80, liquido 94,16, imposto 20,44, lucro 21,72).

## Task 4 — Backfill (one-off, após deploy)
- Por org conectada: orders com tag `order_has_discount` e `cupom_vendedor is null`; GET MP por
  pagamento; UPDATE `ml_vendas` (cupom_vendedor, liquido = total − fee − frete − cupom) e
  `ml_vendas_itens.cupom_vendedor`, via Management API, em transação, com contagem antes/depois.
- Orders com tag sem coupon_fee gravam `cupom_vendedor = 0`.

## Task 5 — Entrega
- `pnpm preflight:static`/testes; revisão do diff pelo Codex gpt-6.1-sol high (pedido do Diego:
  conferir Faturamento + Financeiro em todos os menus) + Grok pré-merge; CI; merge ff; deploy das edges
  que importam `_shared/faturamento` e `_shared/platform-admin`; `db push`; backfill; conferência do
  pack no app.
