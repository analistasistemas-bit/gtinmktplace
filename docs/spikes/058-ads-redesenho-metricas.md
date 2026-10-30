# Spike 058 — redesenho do /ads: métricas por período do Mercado Ads

**Data:** 2026-10-30 · **Relacionado:** emenda de 2026-10-30 ao [ADR-0179](../decisions/0179-painel-de-ads.md),
[spike 054](054-total-de-ads-por-periodo.md), [spike 057](057-ads-campanhas-agora.md),
plano `docs/superpowers/plans/2026-10-30-ads-redesign-premium.md` (seções 2.2–2.7 e 9)
**Método:** API real, só GET, token lido em memória via Management API (SQL read-only), nunca renovado nem impresso.
Script: `python3 scripts/spike-ads-redesenho.py coletar <connection_id>` (teto de 40 chamadas, para no 1º 429), mais
duas sondas descartáveis de 8 chamadas cada na Avil (mesma classe `Ml`, sem versionar). Tokens vigentes nas duas
contas. Total: 18 + 18 (script, Avil e Hairfly) + 16 (sondas, só Avil) = 52 GET, nenhum 429.
**Janelas (BRT):** atual = 2026-09-30..2026-10-29 (30 dias completos até ontem); anterior = 2026-08-31..2026-09-29.
**Contas:** Avil (gasto alto: R$ 3.213,15 atual / R$ 4.173,95 anterior; 10 campanhas; 603 anúncios no Ads) e
Hairfly (gasto baixo: R$ 119,34 atual / R$ 0,00 anterior — campanha criada em 20/10; 2 campanhas; 45 anúncios).

Rotas (prefixo `/marketplace/advertising/MLB/advertisers/{adv}/product_ads`, `api-version: 2`):
E1 `campaigns/search` + `metrics_summary=true` · E2 `campaigns/search` + `aggregation_type=DAILY` ·
E3 `campaigns/{id}` · E4 `campaigns/{id}?aggregation_type=DAILY` · E5 `ads/search?metrics=…`.

## Respostas

**(a) E1 resumo × Σ E2 diária × Σ campanhas: batem em centavos — sim, nas duas contas, em todas as métricas
aditivas.**

| Janela | E1 `metrics_summary` | Σ linhas de E1 | Σ 30 linhas de E2 | Σ anúncios (E5, todas as páginas)* |
|---|---|---|---|---|
| Avil atual `cost` | 3213,15 | 3213,15 | 3213,15 | n/d (50 de 603) |
| Avil atual `total_amount` | 40.812,84 | 40.812,84 | 40.812,84 | n/d |
| Avil anterior `cost` / `total_amount` | 4173,95 / 47.816,41 | idem | idem | n/d |
| Hairfly atual `cost` / `total_amount` | 119,34 / 1958,48 | idem | idem | 119,34 / 1958,48 |
| Hairfly anterior | 0 | 0 | 0 | 0 |

\* Hairfly cabe numa página (45); Avil só foi lida a 1ª página (ver paginação).
`prints`, `clicks`, `direct_amount`, `indirect_amount`, `*_items_quantity` e `*_units_quantity` também coincidem.
**E3 × Σ E4 (campanha):** `cost` 1500,62 (Avil) e 109,67 (Hairfly) idênticos; `total_amount` 27.459,13 e 1559,94
idênticos. Valores em reais com 2 casas (`cost: float`), não em centavos inteiros — converter na borda.
Razões (`acos`, `roas`, `cpc`, `ctr`, `cvr`, `sov`) vêm prontas no resumo e **não** se somam: recalcular a partir
das aditivas. Cada dia de E2/E4 traz uma linha por data, 30 datas distintas, **sem duplicar o resumo** (o resumo
só existe em E1, no topo, fora de `results`).

**Armadilha medida — `metrics_summary` é do que veio na página.** Com `limit=1` o resumo da Avil foi R$ 1.500,62
(só a 1ª campanha); com `limit=5` e `limit=50`, R$ 3.213,15. Sempre ler com `limit` ≥ `paging.total` (ou paginar e
somar) ou usar a Σ de E2 como total da conta. Resumo de página não é total da conta.

**(b) Status históricos.** `filters[status]=active,paused,deleted` → 200; trouxe 10 campanhas na Avil
(5 `active`, 3 `paused`, 2 com status `error`) e as 2 da Hairfly (`active`). Sem filtro: 8 na Avil (as 2 `error`
somem; o gasto é o mesmo, 3213,15). `filters[status]=active,paused,deleted,error` também → 200, 10 linhas.
Limite da evidência: as duas campanhas `error` não tiveram gasto no período, então **não foi observada campanha
excluída com gasto histórico**; a regra "campanha removida mantém a métrica do ML" fica confirmada só para o
filtro aceito, não para um caso real.

**(c) Paginação.** E1: `paging {offset,total,limit}`; `limit=50` cobre as 10 e as 2 campanhas. E2/E4: sem
`paging`, devolvem as N datas do período (30, 90 e 91 linhas observadas). E5 (`ads/search`): `limit=50`, Avil
`total=603` (conta) e `76` (filtrada por `campaign_id`; o filtro é confiável quanto ao `campaign_id` da linha neste
período, mas manter a regra do spike 057 de descartar linhas de outra campanha); Hairfly 45 e 36. Somar métricas
por anúncio exige varrer todas as páginas (Avil: 13 chamadas por janela) — caro, não é caminho de total.

**(d) Campos opcionais, presentes em E1, E2, E3 e E4 nas duas contas (30/30 dias, 10/10 campanhas):**
`advertising_items_quantity`, `direct_items_quantity`, `indirect_items_quantity`, `organic_items_quantity`,
`units_quantity`, `direct_units_quantity`, `indirect_units_quantity`, `organic_units_quantity`,
`organic_units_amount`, `cvr`, `sov`, `acos`, `roas`, `cpc`, `ctr`. Em E4 também `acos_benchmark`.
`impression_share`, `top_impression_share`, `lost_impression_share_by_budget` e
`lost_impression_share_by_ad_rank` vêm **só no detalhe (E3/E4)** (percentuais, ex.: 0,05 e 3,5 na Avil); pedidas
em E1 ou na lista (`campaigns/search`), a rota responde **400** (confirmado isolando só competitividade em E1).
Portanto "Vendas atribuídas × Outras vendas" (plano seção 9.2) é viável: `organic_items_quantity` e
`organic_units_amount` existem, com valor não nulo. Na Avil atual `units_quantity` (857) = `direct_units_quantity` + `indirect_units_quantity` (799 + 58). `cvr`, `sov` e `acos` do resumo ficam como o ML os
entrega.

**(e) Retenção real: 91 dias.** `date_from = hoje − 91` (2026-07-31, até ontem = 91 dias inclusivos) → 200 e dados
(Avil E1: R$ 7.137,89 só da 1ª campanha, com `limit=1`; E2 de 91 linhas: R$ 11.712,53 de conta). `hoje − 92`
→ **400** em E1 e em E2, nas duas contas; `hoje − 100` → 400. `hoje − 90` → 200. Atual de 30 dias + anterior de 30 dias
cabe (a anterior começa em hoje − 60); a anterior só é consultável se começar em hoje − 91 ou depois. Para períodos maiores que 91 dias a fonte tem de ser o histórico persistido no PubliAI. (As linhas
de retenção do script usam `limit=1` sem filtro de status e por isso imprimem `summary` de 1 linha, às vezes 0,0 —
usar só o HTTP dessas linhas.)

**(f) Métricas por anúncio em `ads/search` (`metrics=`): vieram, nas duas contas, atual e anterior.** Campos em
`metrics`: `prints`, `clicks`, `cost`, `cpc`, `acos`, `direct_amount`, `indirect_amount`, `total_amount`,
`direct_units_quantity`, `indirect_units_quantity`, `units_quantity`, `advertising_items_quantity`. **Ausentes:**
`cvr`, `ctr`, `roas`, `sov`, `*_items_quantity` exceto `advertising_items_quantity`, `organic_*` e competitividade
(não vêm por anúncio). Hairfly: Σ por anúncio das 45 linhas = totais de conta (119,34 / 1958,48 / 36 unidades), sem
duplicação entre anúncios do mesmo grupo. Avil: só a 1ª página foi somada (50 de 603: R$ 555,48), então a conciliação
com a conta ficou aberta — **Task 04**. Ainda em E5 aparecem anúncios `idle`/`hold` (inclusive `paused` na Hairfly).

## Diferenças e bloqueios

- Nenhuma diferença não explicada entre E1, E2, E3 e E4. A única divergência medida (`limit=1`) é do próprio
  `metrics_summary` por página, explicada acima: **bloqueia** apenas ler o resumo com `limit` menor que o total.
- E5 na Avil não foi conciliado com o total (603 anúncios, 13 páginas por janela); a tabela "Anúncios patrocinados"
  da Task 31 pode usar as métricas por anúncio, mas qualquer total tem de vir de E1/E2.
- Competitividade em lista/E1 recusada (400): mostrar só no detalhe da campanha.

## Consequências para o design

- Total da conta e resumo: E1 com `limit=50` ≥ `paging.total` ou Σ de E2; nunca resumo de página.
- Comparação "vs período anterior" é viável quando `anterior.desde ≥ hoje − 91`; senão indisponível (motivo
  explícito). Anterior zerado (Hairfly) é dado real do ML, não ausência: variação percentual indefinida.
- Gráfico padrão "Vendas atribuídas × Outras vendas + ROAS" (seção 9.2): confirmado pelos campos `organic_*`.
- Dado do ML em reais (float): arredondar a 2 casas ao somar/gravar.
- Classificação final de campos opcionais (obrigatório × opcional por rota) e a conciliação completa de E5 na Avil:
  Task 04.
