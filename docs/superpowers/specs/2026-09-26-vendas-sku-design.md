# Vendas SKU — design

**Data:** 2026-09-26 · **Origem:** grilling com Diego (8 perguntas) + benchmark do Mercado Turbo
*Vendas por SKU* · **ADR:** [0172](../../decisions/0172-vendas-sku-analise-por-variacao.md) ·
**Termos:** `docs/reference/glossario.md` → seção "Vendas SKU".

## Objetivo

Uma aba nova em Faturamento, **Vendas SKU**, que diz quais variações sustentam o resultado e conta a
**história** de cada uma desde a primeira venda registrada no PubliAI. Não é cópia do benchmark: ele é um
ranking de faturamento bruto do período. Aqui a análise é por **lucro**, ao longo do tempo, com eventos e
sinais de risco.

## Benchmark (Mercado Turbo, visitado 2026-09-26, só leitura)

| Tem lá | Fica? |
|---|---|
| KPIs: valor, qtde, ticket, SKUs com venda, concentração top 5 | fica, com Δ% contra o período anterior |
| Frase "X lidera com Y%" | vira 3 insights automáticos |
| Ranking com participação valor/qtde | fica, ordenado por lucro |
| Top 10 em barras (valor + ticket) | sai: o ranking ordenável (lucro, unidades, lucro/unidade) responde |
| Volume × Faturamento (5 cards) | sai, pelo mesmo motivo |
| Vendas por UF do SKU (modal) | vai para o dossiê |
| Faixas de ticket | sai (nunca definida) |
| Curva ABC em outra página e outro período | embutida, no mesmo período, por lucro ou faturamento |

O que falta lá e é o diferencial daqui: lucro/Markup/Margem s/ venda, comparação de períodos, canceladas e
devolvidas separadas, eixo de tempo, eventos, estoque/cobertura, visitas/conversão, busca e filtros, e
atalhos de período (lá é texto dd/mm/aaaa).

## Fatia 1 — aba `/faturamento?aba=sku`

**Fonte:** os itens de `agruparPorPedido` (a mesma da aba Vendas), agrupados por `codigo` no navegador
(ADR-0172 D-5). Sem RPC e sem fórmula nova. Enriquecimento pela família mais recente do `(org, codigo)`.

- **Filtros:** período com atalhos (7/30/90 dias, mês, custom) + comparar com o período anterior; busca
  por código/título; família, fornecedor, origem (nacional/importado); filtro **sem custo**; alternador
  **agrupar por família**.
- **Faixa "sem custo"** no topo quando houver: "N SKUs sem custo · R$ X de faturamento sem lucro calculado".
  Todo produto tem que ter custo.
- **KPIs:** faturamento, lucro, Markup, Margem s/ venda, unidades, SKUs com venda (e quantos venderam 1
  vez), concentração top 5, **% do faturamento com custo real** e **prejuízo total** (quanto os SKUs
  negativos tiraram). Δ contra o período anterior: % nos valores, **pontos percentuais** em Markup e Margem,
  e R$ quando a base anterior é zero ou negativa.
- **Quem explica a variação do lucro:** os SKUs que mais somaram ou tiraram em R$, incluindo "entrou no
  período" e "deixou de vender".
- **Insights:** de 0 a 3, só com evidência (ex.: "3 SKUs fazem 50% do lucro", "4 SKUs com cobertura
  < 15 dias").
- **Ranking:** código + título + miniatura, unidades, faturamento, lucro, **lucro por unidade**, Markup,
  Margem s/ venda, ticket, canceladas, taxa de devolução, **tendência** e **alertas** (glossário). Ordena
  por lucro por padrão. Selos: "custo estimado", "lucro parcial", "sem custo". Linha extra: "devolução não
  atribuída" e "sem código".
- **Abrir a conta da linha:** bruto → comissão + frete → imposto → custo → lucro, com a quantidade de
  pedidos. Comissão e frete aparecem juntos porque o item só carrega o líquido rateado. O link para os
  pedidos fica no dossiê (2a).
- **Curva ABC** (lucro | faturamento). Por lucro, só sobre o lucro positivo; SKUs com prejuízo ficam na
  faixa "D — prejuízo".
- **Cobertura:** kit vinculado mostra "estoque compartilhado com a base", sem dias.
- **Invariante:** a soma dos SKUs no período = total da aba Vendas no mesmo filtro (por construção; teste
  de guarda).

## Fatia 2a — Dossiê `/faturamento/sku/:codigo` (dados existentes)

- Cabeçalho: foto, título, família, MLB(s) atual/anteriores, 1ª e última venda, idade, tendência, alertas.
- **Linha do tempo** semanal/mensal: unidades, faturamento, lucro, e o **preço praticado** tirado das vendas.
- **Eventos** (glossário "Evento da história"): publicação/republicação, entrada de mercadoria + mudança de
  custo, ruptura, mudança de preço, moderação, devolução; perguntas como faixa semanal; promoção marcada
  como aproximada.
- Estoque canônico + **cobertura**; devoluções com motivos; UFs; variações irmãs (mix da família).
- Família (`/faturamento/sku/familia/:codigo_pai`): mesma tela somando as variações, com seletor.

## Fatia 2b — coleta diária (visitas, conversão, preço)

- Worker diário (QStash, `verify_jwt=false`, idempotente por `(org, item, dia)`), só leitura no ML.
- Visitas: `items/{id}/visits/time_window`, carga inicial de até 150 dias (cobre desde jun/2026). O ML
  consolida em até 48h, então o dia corrente fica pendente.
- Preço diário: multiget do próprio anúncio, 20 por chamada.
- No dossiê: visitas/dia, **conversão** (unidades ÷ visitas) e preço diário sobre a linha do tempo.

## Fatia 2c — Ads e posição (após spikes)

- **Spike Ads (1 dia):** o app tem permissão de Product Ads? Avil/DSA anunciam? Métrica diária por
  anúncio (cliques, impressões, CPC, ROAS, orgânico × pago). Se sim, entra no dossiê e o lucro ganha
  "lucro após Ads".
- **Spike posição:** custo mensal medido (Apify × SKUs × frequência) + de onde vem a palavra-chave de cada
  SKU. Diego aprova o custo antes de ligar.

## Fatia 3 — depois

Recompra (compradores que voltam ao SKU), exportação, ações diretas (abrir família, ver promoção).

## Fora

Pausa/reativação na linha do tempo, enquanto não houver registro. Tela de configuração dos limites.
Backfill de pedidos anteriores à entrada no PubliAI.

## Pré-requisitos corrigidos antes da Fatia 1 (2026-09-26)

- **Centavos:** o rateio do líquido entre itens (`agruparPorPedido`) agora joga o resíduo no item faturável
  de maior valor. A soma dos itens = líquido do pedido.
- **Unidades:** `Pedido.unidadesFaturaveis` alimenta o KPI "Unidades" da aba Vendas e a Geografia. Pack
  com order cancelada não conta o item cancelado, igual ao Financeiro.
- **Não alterado, de propósito:** o markup por pedido/pack continua entrando com o líquido inteiro quando
  qualquer item tem custo (`sales-summary.ts`, comentário "assim markup/lucro batem entre todas as telas").
  Medido: 1 pack em 3.778. A Vendas SKU calcula por item e não herda isso.

## Riscos

- Dossiê de SKU com pouco volume vira ruído: a tendência exige ≥ 5 unidades na janela.
- Kit vinculado: estoque vem da base (`floor(base/N)`). A cobertura do kit usa o estoque resolvido, não
  `variacoes.estoque`.
- Janela de 48h das visitas: a conversão do dia corrente não é mostrada.
