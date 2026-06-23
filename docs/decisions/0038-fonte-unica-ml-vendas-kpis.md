# ADR-0038 — Fonte única `ml_vendas` para os KPIs dos 3 menus + bruto igual ao ML

**Status:** Aceito — implementado na branch `worktree-conferencia-valores-kpis` (pendente deploy + re-backfill)
**Data:** 2026-06-23
**Contexto relacionado:** ADR-0031 (financeiro MP), ADR-0037 (módulo Faturamento / webhooks ML)

## Problema

Os KPIs de valores divergiam entre os menus **Publicados**, **Faturamento** e **Financeiro**, e não batiam com a tela de Métricas do Mercado Livre. Conferência da conta AVILBV (janela 30 dias, 2026-06-23):

| Fonte | Bruto | Vendas | Unidades |
|---|---|---|---|
| ML Métricas (tela nativa) | R$ 802 | 34 | 48 |
| ML `/orders/search?status=paid` (ao vivo) | R$ 776,83 | 33 | 46 |
| Tabela `ml_vendas` | R$ 776,83 | 33 | 46 |

Causas-raiz confirmadas com dados reais:

1. **Bruto não inclui reembolsos.** A 34ª venda é o pedido `2000016957965428`, status `partially_refunded` (R$ 25, 2 un). O ML conta venda reembolsada no "Vendas brutas"; o app filtrava só `status='paid'`. `802 = 776,83 + 25`. A tabela `ml_vendas` **já contém** esse pedido — o defeito era só na contagem.
2. **Cada menu calcula líquido de fonte/data diferentes**, então divergem entre si:
   - Publicados e Financeiro: líquido do Mercado Pago ao vivo, por `date_approved`.
   - Faturamento: `ml_vendas.liquido` por `date_closed`.
3. **Frete duplicado em packs.** O `sync-venda` grava o frete do envio inteiro em **cada** pedido do pack (mesmo `shipping_id`). Frete somado por pedido = R$ 550,89; frete real por envio = R$ 280,72 (6 packs). Corrompe a coluna "Frete vendedor" e o líquido *estimado* (fallback sem MP).

## Decisão

1. **Fonte única = `ml_vendas`.** Os KPIs dos três menus (bruto, líquido, descontos, estornos, unidades, pedidos, ticket, markup, ranking por anúncio) passam a ser derivados de `ml_vendas` + `ml_vendas_itens` (+ `variacoes.custo` para markup). Acaba a leitura "ao vivo" divergente de ML/MP no caminho dos KPIs. Os dados continuam alimentados por webhook + backfill + reconciliação (ADR-0037), que já batem pedido-a-pedido com `/orders`.

2. **Bruto/contagem igual ao ML.** Faturamento bruto, unidades, pedidos e líquido contam `status ∈ {paid, partially_refunded, refunded}` (exclui `cancelled`). Estorno continua segregado à parte. Resultado: bate com "Vendas brutas" do ML.

3. **Rateio de frete por envio na leitura.** O agregador rateia o frete de cada envio compartilhado uma única vez (porta a lógica de `rateio.ts`), corrigindo a soma e a atribuição por linha. Zero-soma nos totais.

4. **"A receber / lançamentos futuros" continua não reproduzido** (mantém ADR-0031). É projeção de liberação futura, conceito distinto de "líquido das vendas do período". Apenas clarificamos os rótulos para não dar a entender que deveria bater com o "A receber" do app do MP.

## Consequências

- Os três menus passam a mostrar exatamente o mesmo número para o mesmo período. Diferenças só por janela/filtro escolhidos na própria tela.
- A leitura fica mais rápida e resiliente (sem depender de ML/MP no request do usuário).
- A data de "Liberação" do `DetalheFinanceiro` (`money_release_date`) é exclusiva do MP e não vive em `ml_vendas` — ver "Plano" para o tratamento.
- Edge functions `metricas-vendas` e `resumo-financeiro` deixam de ser o caminho dos KPIs (podem ser depreciadas depois).

## Plano de implementação (o que foi feito)

- Agregador puro `src/lib/resumo-vendas.ts` (`calcularResumo`, `ehFaturavel`, `fretePorPedidoRateado`) + testes.
- `calcularKpis` (Faturamento) e o agregador contam `paid/partially_refunded/refunded`.
- Custo client-side `src/lib/custos.ts` + `useCustos` (lê `variacoes` por RLS) para o markup.
- Hook `useResumoVendas` consumido por **Financeiro** e **DetalheFinanceiro**; **Publicados** usa o agregador inline. Todos sobre `useVendas` (tabela `ml_vendas`).
- Fase 2: migration `20260623120000_ml_vendas_estorno_liberacao.sql` (colunas `estorno`, `money_release_date`) + escrita em `enriquecimento.ts` (mapa MP net/estorno/release) → `venda.ts` → `io.ts`.

## Sequência de deploy (ordem importa)

1. Aplicar a migration (cria as colunas) **antes** de deployar as functions — senão o upsert de `ml_vendas` falha.
2. Deploy das edge functions afetadas (`backfill-faturamento`, `sync-venda`, `reconciliar-faturamento` e as `_shared`).
3. Rodar o backfill/reconciliação para popular `estorno` + `money_release_date` nas linhas existentes.

Antes do passo 3, o bruto/líquido/unidades já batem com o ML; "Estornos" e "Liberação" aparecem zerados/“—” até o re-backfill.
