# ADR-0032 — KPIs do topo de Publicados contam a conta inteira do ML

**Status:** Aceito
**Data:** 2026-06-19
**Relacionado:** [spec dashboard-kpis-publicados](../superpowers/specs/2026-06-17-dashboard-kpis-publicados-design.md), `metricas-vendas`, `_shared/ml/vendas.ts`

## Contexto

Diego comparou os KPIs do topo da tela **Publicados** com a tela de **Métricas** do próprio
Mercado Livre e os números não batiam (últimos 30 dias):

| | PubliAI | Mercado Livre |
|---|---|---|
| Faturamento | R$ 417,50 | R$ 606,80 |
| Unidades | 23 | 36 |
| Pedidos | 17 | 24 |

Investigação (skill `systematic-debugging`) consultando a API real do ML (`/orders/search`,
mesma janela e mesmo filtro `order.status=paid` do código) provou que **não havia erro de
cálculo**: a API retornou exatamente os 24 pedidos / 36 unidades / R$ 606,80 do ML, e a soma
restrita ao escopo do app dava precisamente os R$ 417,50 / 23 / 17 exibidos.

A diferença vinha do **filtro de escopo** em `agregarPedidos` (`vendas.ts`), que — por decisão
da spec original — só somava pedidos de `item.id` presentes em `familias.ml_item_id`. Os 7
pedidos faltantes eram de **6 anúncios publicados direto no ML, fora do PubliAI** (5 anúncios
de catálogo de fita de cetim + 1 kit de pistola de cola; todos com `seller_custom_field` nulo,
confirmando que não saíram do app).

Ou seja: a spec escolheu deliberadamente "os KPIs refletem o catálogo do PubliAI", mas, na
prática, isso confunde o operador, que usa o card como resposta para *"quanto vendi no ML"* e
o compara com o painel do próprio ML.

## Decisão

Os **totais do topo** (Faturamento, Unidades, Pedidos, Ticket médio) passam a refletir **toda a
conta do vendedor** no período, batendo com a tela de Métricas do ML.

A granularidade por anúncio **continua restrita ao escopo do app**: a tabela (colunas Unidades/
Valor vendido), os rankings (Top produtos) e o card de Encalhados seguem usando apenas os
anúncios gerenciados pelo PubliAI — são informações que só fazem sentido para o catálogo do app.

Implementação (cirúrgica, em `agregarPedidos`):

- `totais` = soma de **todos** os `order_items` de todos os pedidos pagos da janela; `pedidos`
  = nº de pedidos com ≥1 item.
- `porItem` = inalterado, agregado **só** para `item.id` dentro do escopo.

Como o tipo `MetricasVendasCanal` não mudou de forma, **nenhuma mudança no frontend** foi
necessária — o dashboard já consome `totais` para os cards e `porItem` para tabela/rankings.

## Consequências

- Os 4 cards passam a casar com o painel de Métricas do ML (validado: 24 / 36 / R$ 606,80;
  ticket R$ 25,28 ≈ "preço médio por venda" R$ 25,29 do ML).
- Mantém-se o desenho multicanal: a semântica "totais = conta inteira do canal, porItem =
  escopo do app" é canônica no contrato `MetricasVendasCanal`, não acoplada ao ML.
- Reverte parcialmente a decisão de escopo da spec de 2026-06-17 (item "Escopo" do adapter ML),
  que fica registrada aqui como superada para os **totais**.
- A edge function `metricas-vendas` precisa ser **redeployada** para o efeito valer em produção
  (a mudança está em `_shared/ml/vendas.ts`, compartilhado).
