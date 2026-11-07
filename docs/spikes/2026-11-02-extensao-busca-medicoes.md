# Spike — medições da fatia 2 da extensão (modo busca completo)

**Data:** 2026-11-02 · **Plano:** `docs/superpowers/plans/2026-11-02-extensao-busca-completa.md` (Task 7) · **ADR:** 0189 (emenda 2026-11-02)

Medição antes do código funcional. Só GET no Mercado Livre, com a conexão da org do Diego, a ≤ 1 req/s e 0 respostas 429 (120 GETs no total). SQL somente leitura e logs pela Management API. O repositório é público, então este arquivo traz só agregados: nenhum ID de catálogo, item, vendedor ou org, e nenhum preço de terceiro. As respostas cruas ficaram fora do repositório.

## 1. Contratos do ML

**Amostra.** 28 catálogos vieram de `/products/search?q=` (8 termos genéricos, como "creatina", "protetor solar" e "air fryer"). Outros 14 catálogos vieram de buscas reais já registradas (Sonar e famílias com concorrência medida). O dimensionamento usa só os 14.

| Achado | Medido |
|---|---|
| **Catálogo sem ofertas** | `/products/{id}/items` responde **HTTP 404 `No winners found`** (78 B), sem `paging.total=0`. Aconteceu em 17 de 28 catálogos do `/products/search` (fichas genéricas/pai) e em 1 de 14 catálogos de busca real. O `mlGet` atual devolve `null` em 404, e `catalogo()` mostra "falha ao consultar o ML". **A Task 9 precisa tratar 404 `No winners found` como "0 ofertas", não como falha.** |
| `paging` | Presente em 100% das respostas 200 (`total`, `offset`, `limit`). `total` = número de **ofertas**. |
| > 100 ofertas | 1 catálogo com `total=117`: a primeira página traz 100 ofertas, `offset=100` traz as 17 restantes (todas de vendedores novos). Uma leitura de `limit=100` é parcial nesses casos. |
| Distribuição de `total` (14 reais) | 1, 1, 1, 1, 3, 4, 5, 16, 18, 63, 71, 90, 117, mais um catálogo com 404 |
| Vendedor repetido | 6 de 13 catálogos têm o mesmo `seller_id` em mais de uma oferta: 31 ofertas repetidas em 374 (8%), até 10 num mesmo catálogo. |
| `category_id` por oferta | Presente em 374 de 374. **Varia dentro do catálogo**: 5 de 13 catálogos têm 2 ou 3 categorias distintas. Isso confirma a regra de usar a categoria só da oferta exata. |
| `listing_type_id` | Presente em 374 de 374: `gold_special` 268, `gold_pro` 106. Nenhum outro valor. |
| `seller_id`, `item_id` | Presentes em 374 de 374. O casamento card → oferta por `item_id` é viável. |
| `shipping.logistic_type` | Presente em 374 de 374 (`drop_off`, `xd_drop_off`, `cross_docking` etc.). |
| `/products/{id}` | `date_created` presente em 30 de 30 fichas. **`buy_box_winner`**: a chave existe, mas o valor veio `null` em 30 de 30. Não serve para inferir vencedor. |
| Tamanho | `/products`: mediana 8,3 KB (máx. 31 KB). `/products/items`: cerca de **1,04 KB por oferta**, ou seja, ~105 KB para 100 ofertas. `/users`: ~370 B (máx. 401 B). Latência de `/items`: mediana 290 ms, máx. 574 ms. |

**`/users/{id}` de terceiros (32 vendedores distintos):**

| Campo | Medido |
|---|---|
| `seller_reputation.power_seller_status` | Chave presente em 32 de 32. Valor **`null` explícito em 23**; `platinum` 5, `gold` 2, `silver` 2. |
| `level_id` | Presente em 32 de 32: `5_green` 26, `4_light_green` 3, `3_yellow` 1, `null` 2. |
| `address.state` | Preenchido em 32 de 32. |
| `transactions` | Para terceiros, contém **só `period` e `total`**. Faltam `completed`, `canceled`, `ratings` e `metrics`, que aparecem apenas no perfil da própria conta. |
| `normalizarPerfilVendedor` | `transactions.total` veio em 32 de 32. **Não houve descarte nesta amostra.** O risco de descartar medalha/UF válidas quando falta `total` continua teórico: não foi observado, mas também não está descartado. O módulo novo deve aceitar o perfil sem `total`. |

## 2. Baseline de CPU da edge `extensao`

Fonte: logs da função na Management API, endpoint `analytics/endpoints/logs`, tabela `logs`. A CPU vem de `source='function_logs'`, campo `log_attributes['cpu_time_used']`; a requisição vem de `function_edge_logs`. As duas fontes foram cruzadas por `execution_id`. Janela: 7 dias (26/10 a 02/11).

| Métrica | Valor |
|---|---|
| Execuções com CPU registrada | 295 (todas `Shutdown`/`EarlyDrop`; **0 por `CPUTime`**) |
| Execuções com 1 requisição POST | 286 de 295 |
| `cpu_time_used` | mediana **53 ms**, p95 **75 ms**, máx. **109 ms** |
| Por duração da requisição (proxy de frio/quente) | < 1 s: n=11, mediana 46 ms · 1–3 s: n=142, mediana 48,5 ms · ≥ 3 s: n=114, mediana 59,5 ms, p95 84 ms |
| Duração (rede inclusa) | mediana 2,4 s, p95 4,9 s, máx. 6,9 s |
| Status | 200: 301 · 401: 1 |

**Limites da medição:**

- O corpo da requisição não é logado, então não dá para separar `analisar_anuncio`, `catalogo` e `analisar_busca`.
- O acerto ou erro de cache no Redis não fica registrado. A duração é só um proxy de frio/quente.
- `content_length` da resposta tem máx. ~2,2 KB, e nada prova que a amostra inclui uma ficha de 100 ofertas.

Conclusão: a análise atual consome cerca de 5–10% do critério de 1.000 ms. Não extrapolar para o lote: a CPU do lote (1/3/5 catálogos com 100 ofertas) será medida na Task 11.

## 3. Folga do app no ML

As chamadas ao ML não são logadas uma a uma, então **não há contagem medida de chamadas ML por minuto**. O que foi medido, nos 7 dias de 26/10 a 02/11:

| Medida | Valor | Natureza |
|---|---|---|
| Linhas de log com 429 do ML (todas as edges) | **154** em 7 dias, distribuídas em 56 minutos distintos | medido (contagem de mensagens, não de chamadas) |
| Origem | `sincronizar-promocoes` 96, `reconciliar-faturamento` 38, `backfill-faturamento` 8, outras 12 | medido |
| Endpoint | 97 de 154 em **`listing_prices`**; 122 de 154 com corpo `local_rate_limited` | medido |
| Concentração | 101 de 154 entre **06:00 e 06:59 UTC** (03h BRT), na rodada de promoções; pior minuto: 34 linhas. Fora dessa janela, ~7 por dia, espalhadas. | medido |
| Invocações de edge por minuto (todas as funções) | 4,6 a 5,6 mil/dia em ~860 minutos ativos; pico de 147/min (rajada de `ml-webhook`); `reconciliar-faturamento` faz ~54/min na virada da hora | medido (invocações de entrada, não chamadas ML) |
| Chamadas ML por minuto no pico | não medido; a proporção chamadas/invocação varia por função | **inferido: não estimado** |

Leitura: o único 429 recorrente é `local_rate_limited` em `listing_prices`, justamente o endpoint que a comissão do enriquecimento vai usar. Ele se concentra numa janela noturna, de baixo uso da extensão. Não há sinal de 429 em `/products`, `/products/items` ou `/users`. Isto não prova a existência de folga de 120/min: só mostra que, hoje, o gargalo observado é `listing_prices`.

## 4. Custo do Redis (Upstash)

**Preço público:** pay-as-you-go a **US$ 0,20 por 100 mil comandos**, 200 GB/mês de banda grátis e o primeiro 1 GB de armazenamento grátis ([upstash.com/pricing/redis](https://upstash.com/pricing/redis), consultado em 02/11/2026).

**Plano e uso atuais**, lidos pela CLI `upstash redis list/stats`. O plano aparece como `paid`, sem teto de orçamento, com limite de 10 mil comandos/s. O uso fica em ~90–96 mil comandos/dia (30/10 a 02/11), com cobrança diária de US$ 0,181 para 90.593 comandos, exatamente o preço público. Isso dá cerca de 2,8 milhões de comandos/mês, ou ~US$ 5,5/mês. Não há franquia grátis aplicada.

**Comandos por busca no desenho das Tasks 8/9**, com 25 catálogos em lotes de 5 e até 20 perfis por busca:

| Etapa | Comandos | Frio | Quente |
|---|---|---|---|
| Cota por lote (`INCRBY` + `EXPIRE` + `DECRBY` se exceder) | ≤ 3 × 5 lotes | 15 | 15 |
| Catálogo: `GET` da projeção `/products` e `/items` | 2 × 25 | 50 | 50 |
| Catálogo frio: `INCR` do orçamento ML por chamada + `SET` | (2 + 2) × 25 | 100 | 0 |
| Perfil: `GET` (+ `INCR` + `SET` quando frio) | 1–3 × 20 | 60 | 20 |
| Comissão por oferta exata, ~2 por catálogo (inferido): `GET` (+ `INCR` + `SET`) | 1–3 × 50 | 150 | 50 |
| `EXPIRE` da janela do orçamento global | ~1 por minuto | ~1 | ~1 |
| **Total por busca** | | **~375** | **~135** |

| Buscas/dia | Comandos/mês (frio) | Custo/mês (frio) | Custo/mês (quente) |
|---|---|---|---|
| 100 | 1,13 M | **US$ 2,25** | US$ 0,81 |
| 500 | 5,6 M | **US$ 11,25** | US$ 4,05 |

A banda fica bem abaixo dos 200 GB, porque as projeções gravadas são DTOs pequenos e não as respostas cruas.

## 5. Recomendação (Diego aprova)

Custo de ML de um catálogo frio = 2 chamadas (`/products` + `/products/items`) + perfis dos vendedores das ofertas exatas (~1) + comissão das ofertas exatas (~1–2). São **~4–5 chamadas por catálogo**. Os valores de ~1 perfil e ~1–2 comissões por catálogo são **inferidos**: o número de cards exatos por catálogo numa busca real não foi medido, e as contas de chamadas/min dependem dele.

| Controle | Proposta do plano | Recomendado | Medição que justifica |
|---|---|---|---|
| Cota de enriquecimento por usuário+org | 20 catálogos/min | **10/min** *(recomendado)*; 20/min só se o teto global ficar como limite efetivo | Com 20/min, um único usuário frio gasta ~80–100 chamadas/min (inferido), quase todo o teto de 120. Com 10/min, gasta ~40–50, e 2–3 usuários simultâneos cabem no teto. **Custo:** a cota é debitada antes do cache, também em cache quente. Com 10/min, uma busca de 25 catálogos atravessa até 3 janelas (até ~2 min a mais), contra até 2 janelas com 20/min. Diego escolhe entre latência por busca e justiça entre usuários. |
| Teto global do enriquecimento por app | 120 chamadas ML/min | **120/min**, fail-closed; a comissão fica "aguardando" com 429 e sem retry | Não houve 429 nos endpoints de catálogo. O 429 existente é `local_rate_limited` em `listing_prices`, que o enriquecimento também consumirá. |
| Catálogos por requisição | 5 | **5** | CPU atual: mediana 53 ms, p95 75 ms, máx. 109 ms (critério: 1.000 ms). 5 fichas de 100 ofertas ≈ 525 KB de JSON. A Task 11 confirma antes de distribuir. |
| Ofertas por catálogo | 100 | **100**, uma página, sem `offset` | 1 de 13 catálogos reais passou de 100 (`total=117`). Nesse caso, mostrar leitura parcial "≥ N vendedores identificados". |
| Perfis | 5 por requisição, 20 por busca | **5 / 20** | `/users` ≈ 370 B. Medalha e UF vieram em 32 de 32. Cada perfil custa 1 chamada do teto. |
| TTL `/products` | 6 h | **6 h** | Só `date_created` é usado (presente em 30 de 30). `buy_box_winner` veio sempre `null`. |
| TTL `/products/items` | 60 s | **60 s**; o 404 `No winners found` também entra no cache como "0 ofertas" por 60 s | Mesmo TTL do `catalogo()` atual. 0 ofertas responde 404, não `total=0`. |
| TTL `/users` | 24 h | **24 h** | Igual a `TTL_PERFIL` (`cache:seller:v2`). Reaproveitar a chave. |
| TTL comissão/frete | 6 h | **6 h** | Comportamento financeiro existente. A chave inclui o preço exato, então o reaproveitamento entre cards é baixo. |
| Custo Redis | — | aceitável | Base atual ~US$ 5,5/mês. +US$ 2,25/mês com 100 buscas/dia frias e +US$ 11,25/mês com 500. |

**Não medido:** CPU por ação (`catalogo` × `analisar_anuncio` × `analisar_busca`) e por cache frio/quente medido de fato; chamadas ML por minuto no app; CPU de um lote de 5 fichas de 100 ofertas (Task 11).

## 6. Spike "lote por página" (03/11/2026, Task 11.1)

**Motivo:** no teste real da 0.5.0, uma busca de ~50 cards ficou minutos em "Aguardando próxima janela" (cota de 10 catálogos/min). Diego escolheu enriquecer a página inteira numa rodada.

**Método:** edge experimental descartável (apagada após a medição), só `GET` na API oficial com o token de uma org própria; 150 catálogos reais em 3 grupos de 50; pool contínuo de 16 chamadas, comissão com sublimite de 4; timeout de 3 s por GET; parada da família no primeiro 429. Projeção para agregados, nenhum corpo guardado.

| Cenário | Páginas | Chamadas ML/página | Tempo da página (ML) | Total na edge | 429 |
|---|---|---|---|---|---|
| 20 catálogos, pool 5 | 1 | 78 | 2,9 s | 3,7 s | 0 |
| 50 catálogos, pool 16/4 | 11 sequenciais | 178–183 | 2,4–3,3 s | 2,8–4,2 s | 0 |
| 50 catálogos, 2 páginas simultâneas | 3 rodadas | 178–183 cada | 2,2–2,9 s | 2,9–3,8 s | 0 |

- **Por página de 50:** 50 `/products` + 50 `/products/{id}/items` (6–11 respondem 404 "No winners found") + 50 `/users` + 28–33 `listing_prices` distintos.
- **Latência p95 por endpoint:** 150–510 ms; máximo observado 540 ms.
- **Vazão sustentada:** ~2.900 chamadas em ~2,5 min (~1.100/min) com um token, **zero 429**, inclusive em `listing_prices`.
- **CPU:** `cpu_time_used` dos workers encerrados 35–89 ms (limite 2.000 ms); sem `CPUTime`/546. Payload de uma página ≈ 1,7 MB.
- **Limite:** um token, um horário (manhã, fora do pico de 06h UTC que gerou os 429 de `listing_prices`); ausência de 429 mostra capacidade observada, não o limite contratual do ML.

**Decisão:** gate aprovado para **uma requisição de até 50 catálogos**, pool 16 com sublimite 4 na comissão, deadline de 8 s. Orçamento global de chamadas ML passa de 120 para **1.000/min** (vazão sustentada medida, ~5 páginas frias/min no app inteiro), fail-closed.

## 7. Spike da fatia 2.1 (03/11/2026): marca, cidade, reputação e frete

Mesmo método da §6 (edge descartável, só `GET`, 3 grupos de 50 catálogos reais, depois apagada).

- **Cobertura:** `BRAND.value_name` em 147/148 produtos lidos; `address.city` em 65/65 perfis; `seller_reputation.level_id` em 64/65.
- **`/items/{id}/shipping_options?zip_code=01310100`** (1º item de cada catálogo, 39–44 por página): pool 4 → 5,5–5,7 s para a família; **pool 8 → 2,4–2,6 s**, p50 440–520 ms, p95 ≤ 552 ms (pior 760 ms no pool 4). Duas páginas simultâneas em pool 8: 2,5 s cada. **Zero 429.** 1–2 itens por página responderam 424 (sem cotação) → indisponível.

**Decisão:** frete com fila própria e sublimite 8; começa na fase 1 (o id do item vem do card), em paralelo com produtos/ofertas, para não somar ao tempo total. Pool total 24 (16 dos componentes existentes + 8 do frete). Gate final mede na edge real.

## 8. Cards sem catálogo: vendedor pela API (06/11)

Pergunta: card `/up/` sem `/p/` mostra só o frete. A API entrega o vendedor desses produtos? Só GET, com o token da
org, em 15 produtos de terceiros de moda, com pausa de 300 ms.

| Rota | Resultado |
|---|---|
| `/user-products/{MLBU}` | 403 em 15 de 15 ("caller is not allowed to access this user product"), ~145 ms |
| `/items/{id}`, com ou sem `attributes` | 403 |
| `/items?ids={id}&attributes=...` | 200 no lote, 403 no item |
| `/items/{id}/prices` e `/sale_price` | 403 `access_denied` |
| `/items/{id}/variations` | 200, sem dado de vendedor |
| `/sites/MLB/search?item_ids={id}` | 403 |

Conclusão: sem catálogo, a API oficial não entrega vendedor, categoria nem tipo de anúncio de terceiro com token de
vendedor. Esses cards ficam com o que a página mostra mais o frete cotado. Não repetir este teste sem mudança no acesso do app.
