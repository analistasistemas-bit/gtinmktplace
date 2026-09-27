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
| Top 10 em barras (valor + ticket) | vira scatter volume × lucro de todos os SKUs |
| Volume × Faturamento (5 cards) | idem acima |
| Vendas por UF do SKU (modal) | vai para o dossiê |
| Faixas de ticket | fica como filtro |
| Curva ABC em outra página e outro período | embutida, no mesmo período, por lucro ou faturamento |

O que falta lá e é o diferencial daqui: lucro/Markup/Margem s/ venda, comparação de períodos, canceladas e
devolvidas separadas, eixo de tempo, eventos, estoque/cobertura, visitas/conversão, busca e filtros, e
atalhos de período (lá é texto dd/mm/aaaa).

## Fatia 1 — aba `/faturamento?aba=sku`

- **Filtros:** período com atalhos (7/30/90 dias, mês, custom) + comparar com o período anterior; busca
  por código/título; família, fornecedor, origem; alternador **agrupar por família**.
- **KPIs:** faturamento, lucro, Markup, Margem s/ venda, unidades, SKUs com venda (e quantos venderam 1
  vez), concentração top 5 — cada um com Δ%.
- **Insights (3):** ex.: "3 SKUs fazem 50% do lucro", "02989271 caiu 35% contra o período anterior",
  "4 SKUs com cobertura < 15 dias".
- **Ranking:** código + título + miniatura, unidades, faturamento, lucro, Markup, Margem s/ venda, ticket,
  canceladas, devolvidas + taxa de devolução, **tendência** e **alertas** (glossário). Ordena por lucro por
  padrão. "Sem custo" fica fora do ranking por lucro.
- **Curva ABC** (lucro | faturamento) e **scatter volume × lucro** com quadrantes.
- **Invariante:** a soma dos SKUs no período = total da aba Vendas no mesmo filtro (teste).

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

## Riscos

- Dossiê de SKU com pouco volume vira ruído: a tendência exige ≥ 5 unidades na janela.
- Kit vinculado: estoque vem da base (`floor(base/N)`). A cobertura do kit usa o estoque resolvido, não
  `variacoes.estoque`.
- Janela de 48h das visitas: a conversão do dia corrente não é mostrada.
