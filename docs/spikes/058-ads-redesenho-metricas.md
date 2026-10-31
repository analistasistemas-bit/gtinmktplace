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

Rotas (`api-version: 2`). Prefixo A = `/marketplace/advertising/MLB/advertisers/{adv}/product_ads`:
E1 `A/campaigns/search` + `metrics_summary=true` · E2 `A/campaigns/search` + `aggregation_type=DAILY` ·
E5 `A/ads/search?metrics=…`. Prefixo B = `/marketplace/advertising/MLB/product_ads` (sem advertiser):
E3 `B/campaigns/{id}` · E4 `B/campaigns/{id}?aggregation_type=DAILY`.

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
Razões (`acos`, `roas`, `cpc`, `ctr`, `cvr`, `sov`) vêm prontas no resumo e **não** se somam. Recalcular só as de
fórmula definida (ROAS, ACOS, CTR, CPC) a partir das aditivas; `cvr` e `sov` são agregados nativos do ML, usados como
vêm e indisponíveis quando ausentes (nunca presumir numerador/denominador nem recalcular). Cada dia de E2/E4 traz uma linha por data, 30 datas distintas, **sem duplicar o resumo** (o resumo
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
→ **400** em E1 (Avil e Hairfly) e em E2 (testado só na Avil); `hoje − 100` → 400 em E1 (Avil e Hairfly). `hoje − 90` → 200. Atual de 30 dias + anterior de 30 dias
cabe (a anterior começa em hoje − 60); a anterior só é consultável se começar em hoje − 91 ou depois. Para períodos maiores que 91 dias a fonte tem de ser o histórico persistido no PubliAI. (As linhas
de retenção do script usam `limit=1` sem filtro de status e por isso imprimem `summary` de 1 linha, às vezes 0,0 —
usar só o HTTP dessas linhas.)

**(f) Métricas por anúncio em `ads/search` (`metrics=`): vieram, nas duas contas, atual e anterior.** A 1ª leitura
pediu só 10 campos (`prints`, `clicks`, `cost`, `cpc`, `acos`, `direct_amount`, `indirect_amount`, `total_amount`,
`units_quantity`, `advertising_items_quantity`); a ausência de `cvr`, `ctr`, `roas`, `sov` e `organic_*` registrada na
Task 03 era **falta de pedido, não ausência no ML** — corrigido na Task 04 (seção abaixo: todos vêm por anúncio, exceto
competitividade, recusada). Ainda em E5 aparecem anúncios `idle`/`hold` (inclusive `paused` na Hairfly).

## Diferenças e bloqueios

- Nenhuma diferença não explicada entre E1, E2, E3 e E4. A única divergência medida (`limit=1`) é do próprio
  `metrics_summary` por página, explicada acima: **bloqueia** apenas ler o resumo com `limit` menor que o total.
- E5 na Avil foi conciliado na Task 04 (seção abaixo): Σ por anúncio = total da conta em centavos. Mesmo assim o
  total exibido vem de E1/E2; a soma de E5 só serve para auditoria.
- Competitividade em lista/E1 recusada (400): mostrar só no detalhe da campanha.

## Consequências para o design

- Total da conta e resumo: E1 com `limit=50` ≥ `paging.total` ou Σ de E2; nunca resumo de página.
- Comparação "vs período anterior" é viável quando `anterior.desde ≥ hoje − 91`; senão indisponível (motivo
  explícito). Anterior zerado (Hairfly) é dado real do ML, não ausência: variação percentual indefinida.
- Gráfico padrão "Vendas atribuídas × Outras vendas + ROAS" (seção 9.2): confirmado pelos campos `organic_*`.
- Dado do ML em reais (float): arredondar a 2 casas ao somar/gravar.
- Classificação final dos campos, escalas e conciliação de E5: seção "Task 04" abaixo.

---

# Task 04 — classificação dos campos, escalas e conciliação de E5

**Método:** `python3 scripts/spike-ads-redesenho.py conciliar <connection_id>` (só GET, teto 60 chamadas, para no 1º
429, token não renovado). Janela atual = 2026-09-30..2026-10-29. Cada endpoint pede todas as métricas; se a rota
responde 400, repete por grupo (base / quantidades / competitividade) para isolar o que foi recusado. Total da Task 04:
180 GET (126 nas três primeiras rodadas, que ajustaram o script, + 54 na rodada final após a revisão: Avil 33, Hairfly 21), nenhum 429. Transcrição sanitizada da rodada final: [anexo](058-anexo-classificacao.md).
Prefixos e rotas como no topo (E1 lista+resumo, E2 diária da conta, E3 detalhe da campanha, E4 diária da campanha,
E5 `ads/search` por anúncio).

## Classificação por campo (idêntica nas duas contas)

Legenda: **C** confirmado (número válido — não nulo, não booleano, não texto — em todas as linhas; em E5, em todas as 603/45 linhas de todas as páginas) · **R** recusado (HTTP 4xx isolado pedindo só o campo; 5xx/rede seria falha operacional, não recusa)
· **A** ausente (rota 200 sem o campo).

| Campo | E1 | E2 | E3 | E4 | E5 |
|---|---|---|---|---|---|
| `cost`, `clicks`, `prints`, `cpc`, `ctr`, `acos`, `roas` | C | C | C | C | C |
| `direct_amount`, `indirect_amount`, `total_amount` | C | C | C | C | C |
| `cvr`, `sov` | C | C | C | C | C |
| `direct_items_quantity`, `indirect_items_quantity`, `advertising_items_quantity` | C | C | C | C | C |
| `direct_units_quantity`, `indirect_units_quantity`, `units_quantity` | C | C | C | C | C |
| `organic_items_quantity`, `organic_units_quantity`, `organic_units_amount` | C | C | C | C | C |
| `impression_share`, `top_impression_share`, `lost_impression_share_by_budget`, `lost_impression_share_by_ad_rank` | R | R | C | C | R |

Não houve campo ausente (A) entre os pedidos; competitividade só em E3/E4 (nos pedidos de lista, resumo e anúncio o ML
devolve 400 e as outras três famílias de métricas seguem 200 pedidas sem ela). Em E4 também existe `acos_benchmark`
(não pedido na Task 04).

## Escala dos percentuais (medida)

| Campo | Escala | Prova (números reais) |
|---|---|---|
| `ctr` | **percentual 0–100** | Avil resumo 0,36 × `clicks/prints` = 0,003554 (×100 = 0,36); Hairfly 0,74 × 0,007399 |
| `acos` | **percentual 0–100** | Avil resumo 7,87 × `cost/total_amount` = 0,078729; por anúncio, maior diferença para 100·cost/total_amount = 0,0049 (47 anúncios Avil) e 0,0044 (5 Hairfly) |
| `cvr` | **percentual 0–100** | Avil 10,31; Hairfly 15,13; máximo por anúncio 57,14 |
| `sov` | **percentual 0–100** | Avil 43,59; Hairfly 69,44; máximo 100,0 |
| `roas` | razão (×), não percentual | 12,70 = `total_amount/cost` = 12,7018 |
| `cpc` | R$ | = `cost/clicks` (0,39 × 0,3865) |
| `impression_share`, `lost_impression_share_by_budget`, `lost_impression_share_by_ad_rank` | **fração 0–1 (indício forte)** | nos dois detalhes a soma dá exatamente 1,00 (Avil 0,05 + 0,61 + 0,34; Hairfly 0,13 + 0,17 + 0,70) |
| `top_impression_share` | **escala indeterminada** | Avil 3,5 (E3) e até 10,0 (E4) — acima de 1 e maior que `impression_share` (0,05), incompatível com fração; Hairfly 0,5 e máx. 1,0 |

Valores monetários vêm em reais (float). `*_items_quantity`/`*_units_quantity` são inteiros.

## CVR nativo × numeradores candidatos

Comparação do `cvr` nativo (÷100) com cada numerador ÷ `clicks`, em resumo E1 e campanhas das duas contas (8
recortes com cliques; E3 repete uma campanha):

| Recorte | `cvr` nativo | `units_quantity`/`clicks` | `advertising_items_quantity`/`clicks` | `direct_units_quantity`/`clicks` | `direct_items_quantity`/`clicks` |
|---|---|---|---|---|---|
| Avil resumo | 10,31 | **10,31** | 7,69 | 9,61 | 7,09 |
| Avil campanha A | 12,13 | **12,13** | 9,33 | 11,18 | 8,46 |
| Avil campanha B | 7,30 | **7,30** | 5,69 | 6,74 | 5,32 |
| Hairfly resumo | 15,13 | **15,13** | 10,50 | 13,45 | 9,24 |
| Hairfly campanha | 22,50 | **22,50** | 12,50 | 17,50 | 10,00 |

(Demais recortes — mais 2 campanhas Avil e 1 Hairfly — seguem o mesmo padrão.) Só `units_quantity/clicks`
bate, em 8 de 8, com a precisão de 2 casas do ML. Registro de fato, não decisão de fórmula: **o app usa o `cvr`
nativo**, nunca recalcula, e indisponibiliza quando ausente.

## Conciliação completa de E5 na Avil (603 anúncios, 13 páginas, janela atual)

603 linhas lidas de `paging.total=603`, 603 `item_id` distintos. Σ por anúncio × resumo E1 da conta, em centavos (R$) ou
unidades; diferença **0 em todas as 15 métricas aditivas**: `cost` 321.315, `total_amount` 4.081.284,
`direct_amount` 3.768.134, `indirect_amount` 313.150, `organic_units_amount` 4.449.200 (centavos);
`prints` 2.338.925, `clicks` 8.313, `units_quantity` 857, `direct/indirect_units_quantity` 799/58,
`direct/indirect_items_quantity` 589/50, `advertising_items_quantity` 639, `organic_items_quantity` 827,
`organic_units_quantity` 1.179. Hairfly (1 página, 45 anúncios): também 0 em todas. Portanto **sem duplicação nem rateio**
entre anúncios e a soma por anúncio fecha com a conta. Chamadas de página: `limit=50`, `offset` 0…600 com
`metrics=` base + quantidades (competitividade recusada, 400).

# Decisões para a implementação

| Painel / campo | Decisão | Motivo |
|---|---|---|
| Totais, razões (ACOS, ROAS, CTR, CPC), direto × indireto | **Habilitado** | confirmado em E1–E5, concilia em centavos |
| `cvr` e `sov` (conta, campanha, anúncio) | **Habilitado, nativo** (percentual 0–100, sem recálculo) | confirmado em todas as rotas; ausente → indisponível com motivo |
| Gráfico padrão "Vendas atribuídas × Outras vendas + ROAS" e `organic_*` | **Habilitado** | `organic_*` confirmado em E1–E5 e conciliado (Σ anúncios = conta) |
| Tabela "Anúncios patrocinados" (Task 31) com impressões, cliques, CPC, vendas atribuídas, receita, ACOS, CVR, SOV, ROAS | **Habilitada** (ordenável; variação vs anterior com `anterior.desde ≥ hoje − 91`) | todas as colunas vêm de E5; Σ fecha com a conta; chamada paginada (Avil: 13) |
| Competitividade `impression_share`, `lost_impression_share_by_budget`, `lost_impression_share_by_ad_rank` | **Habilitada só no detalhe da campanha** (fração 0–1 → exibir em %) | confirmadas em E3/E4; soma = 1,00 nos dois detalhes medidos; recusadas (400) em lista, resumo e anúncio |
| `top_impression_share` | **Indisponível** | escala indeterminada (3,5 e 10,0 na Avil) até o ML documentar |
| Competitividade em lista, resumo da conta ou por anúncio | **Indisponível** | recusada pelo ML (HTTP 400) |
| Período anterior fora dos 91 dias | **Indisponível** (motivo explícito) | ML recusa `date_from` além de hoje − 91 |

## Conferência com o painel do Mercado Ads (2026-10-31)

Print do painel da Hairfly ("Últimos 30 dias", tirado em 30/10) comparado com a série diária E2 da API acumulada até 29/10:

| Painel do Mercado Ads | Valor | Campo da API | Valor na API |
|---|---|---|---|
| Receita | R$ 1.958 | `total_amount` | 1.958,48 |
| Vendas atribuídas | 36 | `units_quantity` | 36 (`advertising_items_quantity` era 25) |
| Outras vendas | 13 | `organic_items_quantity` | 13 (`organic_units_quantity` já era 14) |

Conclusão: no painel, "Vendas atribuídas" = unidades atribuídas (`units_quantity`) e "Outras vendas" = `organic_items_quantity`. Na Avil (outubro) isso dá 862 unidades contra 646 vendas (pedidos). O /ads passa a mostrar `units_quantity` como "Vendas atribuídas"; `advertising_items_quantity` fica como "Pedidos atribuídos" no detalhe da campanha.
