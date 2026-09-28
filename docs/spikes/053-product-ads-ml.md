# Spike 053 — Product Ads (Mercado Ads) do Mercado Livre

**Status:** spike (pesquisa, não implementação)
**Data:** 2026-09-27
**Relacionado:** Vendas SKU — Fatia 2c (Ads). Responde às 5 perguntas da seção "Fatia 2c" de
`docs/superpowers/specs/2026-09-26-vendas-sku-design.md`.

Toda afirmação sobre a API foi medida contra a **API real**, com os tokens das conexões Mercado
Livre de Avil, DSA e Daludi Shop, **somente com GET**. Nenhum token foi renovado nem impresso. Os
tokens foram lidos em memória via `public.get_connection_tokens(...)` pela Management API, com SQL
só de leitura. Script reproduzível: `scripts/spike-ads-ml.py`
(`python3 scripts/spike-ads-ml.py conexoes`, depois
`python3 scripts/spike-ads-ml.py coletar <connection_id> <saida_dir> [dias]`). A execução foi em
2026-09-27, entre 11:26Z e 11:45Z (08:26–08:45 BRT), com **50 GETs** no ML, nenhum 429 e nenhum 5xx.
IDs de anunciante, campanha, grupo, família e MLB aparecem abaixo como fictícios. Nomes de conta
saíram mascarados (`***`) já na coleta.

## 1. Amostra e matriz de acesso

Janela das métricas: **2026-06-29 a 2026-09-26** (90 dias, o máximo aceito). Todas as conexões
ML existentes entraram (`marketplace_connections`).

| Org | Token | Escopo `ads` no token | `GET /advertising/advertisers?product_id=PADS` | Campanhas | Gasto na janela |
|---|---|---|---|---|---|
| Avil | válido | `urn:ml:mktp:ads:/read-write` | **200**, 1 anunciante MLB | 7 (2 ativas, 3 pausadas, 2 em `error`) | total no relatório privado do spike |
| DSA | válido | idem | **200**, 1 anunciante MLB | 1 (pausada desde 18/08) | total no relatório privado do spike (04/08–18/08); **zero comprovado** de 19/08 a 26/09 |
| Daludi Shop (extra) | válido | idem | **200**, 1 anunciante MLB | 1 (ativa desde 19/09) | total no relatório privado do spike |

- A permissão funcional "Publicidade" **está efetiva** no app: o escopo `urn:ml:mktp:ads:/read-write`
  está gravado nas três conexões, e todas as leituras de Ads deram 200. **Não há passo manual
  pendente para Ads.**
- Os estados que a 2c precisa distinguir apareceram todos, menos "sem advertiser": bearer malformado
  (403, ver 6; token expirado não testado, pela regra de não renovar), acesso negado a outro anunciante (401), sem campanha ativa (DSA), zero comprovado
  (dias com `cost: 0` numa série densa, ver 3.2) e gasto > 0. "Sem advertiser" é o
  `404 No permissions found for user_id`, segundo a doc. Nenhuma conta o devolveu.

## 2. Documentação oficial

A página em pt-BR (`developers.mercadolivre.com.br/pt_br/product-ads`) deu 403 no WebFetch e 404 no
curl. As versões `en_us` foram lidas com um User-Agent de navegador:

- `developers.mercadolivre.com.br/en_us/product-ads-us-read`, última atualização em 30/12/2025
  (campanhas, anúncios e métricas no formato antigo);
- `global-selling.mercadolibre.com/devsite/category-predictor/new-product-ads`, última atualização
  em 03/07/2026 ("Product Ads for Catalog and User Products", com Ad Groups);
- `ads.mercadolivre.com.br/l/atribucion` (modelo de atribuição);
- `developers.mercadolibre.com.ar/en_us/en_us/billing-reports` (faturamento, cobrança `PADS`).

Pontos da documentação:

- **Ad Groups.** A unidade de gestão e de métrica passou a ser o `ad_group_id`, com
  `ad_group_type` ∈ `ITEM` (`ad_group_external_id` = MLB), `FAMILY` (= `family_id` de User Products)
  e `CATALOG` (= `parent_id` do catálogo). "Ads metrics" foi substituído por "Ad Group metrics". A
  doc diz que os endpoints legados `.../product_ads/ads/search` e `.../ads/{item}` sairiam em
  30/06/2026 (e 27/05/2026 para outros).
- **Métricas:** "range of up to 90 days back", "updated at 10:00 AM GMT-3". Só um
  `aggregation_type` por chamada.
- **Atribuição** (página de atribuição do Mercado Ads): 100% do crédito vai para o **último clique
  nos 14 dias** antes da compra. Sem clique, vai para a última impressão nas 24 h anteriores.
  "Conversões podem continuar a ser contadas até que a janela de atribuição de 14 dias termine."
  `direct_*` = compra do próprio anúncio clicado. `indirect_*` = compra de outro anúncio do
  vendedor. `organic_*` = vendas sem publicidade.
- **Requisitos da conta:** reputação amarela ou melhor, 15 dias de cadastro, vendas mínimas e
  nenhuma fatura vencida. Um 404 no advertiser se resolve em *Meu perfil → Publicidade*, pelo
  vendedor.
- **Cobrança:** a fatura mensal do ML traz a linha "Advertising campaigns - Product Ads",
  `type: "PADS"`, em `/billing/integration/periods/key/{key}/summary/details?group=ML`.

## 3. Chamadas reproduzíveis e respostas sanitizadas

Todas usam `Authorization: Bearer <token>`. O header `api-version: 2` vale para todas, exceto o
advertiser, que usa `Api-Version: 1`. `<SITE>` = `MLB`.

### 3.1 Descoberta

```
GET /advertising/advertisers?product_id=PADS                       (Api-Version: 1)
→ 200 {"advertisers":[{"advertiser_id":1000001,"site_id":"MLB","advertiser_name":"***","account_name":"***"}]}

GET /marketplace/advertising/MLB/advertisers/{adv}/product_ads/campaigns/search
    ?limit=50&offset=0&date_from=2026-06-29&date_to=2026-09-26&metrics=<lista>&metrics_summary=true
    &filters[status]=active,paused,deleted
→ 200 {"paging":{"offset":0,"total":7,"limit":50},
       "results":[{"id":2000001,"name":"<nome>","status":"active","strategy":"PROFITABILITY",
                   "budget":…,"roas_target":…,"acos_target":…,"channel":"marketplace",
                   "metrics":{"clicks":…,"prints":…,"cost":…,…}}, …],
       "metrics_summary":{"cost":…,"clicks":…,"direct_amount":…,"roas":…,"acos":…,…}}
```

**Armadilha:** sem `filters[status]`, o search devolve só `active`/`paused`. Na Avil, isso tirou
**2 campanhas em status `error`**, uma delas responsável por 2,4 % do gasto total na janela (fração
escondida sem o filtro). Com o filtro, o total bate com o `metrics_summary` dos Ad Groups. `currency_id` não vem
na campanha. A moeda é a do site (BRL).

### 3.2 Métrica diária (densa)

```
GET …/advertisers/{adv}/product_ads/campaigns/search?…&aggregation_type=DAILY
GET /marketplace/advertising/MLB/product_ads/campaigns/{campaign_id}?date_from&date_to&metrics&aggregation_type=DAILY
GET /marketplace/advertising/MLB/product_ads/ad_groups/{ad_group_id}?date_from&date_to&metrics=<MAIÚSCULAS>&aggregation_type=daily
→ 200 {"results":[{"date":"2026-09-26","clicks":38,"prints":27213,"cost":…,"cpc":…,
                   "direct_amount":…,"indirect_amount":0.0,"total_amount":…,
                   "direct_units_quantity":3,"units_quantity":3,"organic_units_quantity":0,
                   "acos":…,"roas":…,"sov":100.0,…}, …]}
```

- **A série é densa:** 90 linhas para 90 dias. A DSA tem 76 dias com `cost: 0` na série. Ao
  contrário das visitas (spike 052), dia ausente não significa zero, e zero vem explícito.
- `date` = `YYYY-MM-DD`, sem hora nem fuso. `date_from` e `date_to` são **inclusivos** (29/06 e
  26/09 vieram).
- A série da campanha **agregada por advertiser** (`campaigns/search` + `DAILY`) vem **sem**
  `campaign_id` na linha: é o total diário do anunciante.
- **Hoje já vem parcial:** `date_from=date_to=2026-09-27` às 08:30 BRT → 200 já com valor parcial. Isso é
  antes das "10:00 GMT-3" da doc.
- Janela > 90 dias → `400 {"error_code":"invalid_request_param","description":"difference between
  dates must be less than equals to 90 days"}`.

### 3.3 Ad Groups

```
GET …/advertisers/{adv}/product_ads/ad_groups/search?limit=100&offset=0&date_from&date_to
    &metrics=CLICKS,PRINTS,COST,…&metrics_summary=true
→ 200 {"paging":{"offset":0,"total":292,"limit":100},
       "results":[{"id":3000001,"ad_group_type":"FAMILY","ad_group_external_id":"4000001",
                   "campaign_id":2000001,"status":"ACTIVE","catalog_listing":false,
                   "date_created":"2026-07-20T07:35:32Z","current_advertiser_id":1000001,
                   "metrics":{"cost":…,…}}, …],
       "metrics_summary":{"cost":…,…}}

GET /marketplace/advertising/MLB/product_ads/ad_groups/{ad_group_id}/ads?date_from&date_to&metrics
→ 200 {"paging":{"total":10,…},
       "results":[{"item_id":"MLB1000000001","ad_group_id":3000001,"campaign_id":2000001,
                   "status":"active","catalog_listing":false,"family_id":4000001,
                   "user_product_id":"MLBU1000000001","metrics":{"cost":…,…}}, …]}

GET …/advertisers/{adv}/product_ads/items?item_ids=MLB…,MLB…         (mapa MLB → grupo)
→ 200 {"results":[{"item_id":"MLB1000000002","ad_group_id":3000002}, …]}   (sem paging)

GET …/advertisers/{adv}/product_ads/ads/search?limit=100&offset=N&date_from&date_to&metrics
→ 200  (endpoint "legado": ainda responde em 27/09/2026, total=586 MLBs na Avil, com
        ad_group_id e métricas por MLB)
```

- `GET /campaigns/{id}/ad_groups/metrics` com 1 dia devolve `[{"date":"2026-09-26","results":
  [{"ad_group_id":…,"metrics":{…}}]}]`, uma lista na raiz.
- `GET /ad_groups/{id}/ads?…&aggregation_type=DAILY` **ignora o grupo** e devolveu a série diária
  do anunciante inteiro (praticamente 100,0 % do gasto total do anunciante, não do grupo). Não existe série diária por MLB.
- `filters[status]=DELETED` no `ad_groups/search` é ignorado: volta a mesma lista de 292.

### 3.4 Contagens por org

| | Avil | DSA |
|---|---|---|
| Ad Groups listados | 292 (ITEM 123, FAMILY 102, CATALOG 67) | 73 (FAMILY 45, CATALOG 28) |
| Status | EMPTY 95, IDLE 100, ACTIVE 66, HOLD 27, PAUSED 4 | EMPTY 33, HOLD 26, IDLE 12, ACTIVE 1, PAUSED 1 |
| Com gasto na janela | 134 | — |
| Grupos com `campaign_id: 0` (fora de campanha hoje) | 181, com 4,5 % do gasto total na janela | — |
| MLBs anunciáveis (`ads/search`) | 586 | 73 |

## 4. Granularidade: grupo → MLB → código

Mapa MLB → código: a mesma UNION de `vendas_sku_mlbs` (`ml_vendas_itens`,
`anuncios_externos_itens`, `anuncios_externos.variacoes_externas`), mais
`anuncios_externos_itens.catalog_listing_id`, `variacoes.catalog_listing_id` e `kits_virtuais`, com
`org_id` explícito. A RPC depende de `current_org_id()` e não roda pela Management API.
`familias.ml_item_id` **ficou de fora**: em UP ele aponta para o MLB de uma cor, e o join com
`variacoes` atribuía as N cores da família a esse único MLB. No teste, isso gerou 9 falsos
"FAMILY multi-código".

MLBs de cada grupo: os membros atuais vêm de `ads/search`. Um grupo sem membros hoje
(EMPTY/IDLE/HOLD) é resolvido pelo `ad_group_external_id`: em ITEM ele já é o MLB, e em FAMILY o
`family_id` é traduzido em MLBs pelas linhas de `ads/search`.

**Avil** (todos os 292 grupos listados; gasto na janela, soma 97,4 % do total):

| Classe | Grupos | Gasto | Alcance possível |
|---|---|---|---|
| ITEM com N códigos (legado multi-cor) | 65 | 49,0 % do gasto | **anúncio**, sem SKU |
| ITEM com 1 código | 54 | 8,0 % do gasto | SKU (quase todos EMPTY: é o grupo antigo do MLB antes de virar UP) |
| FAMILY (UP) com 1 código | 60 | 11,9 % do gasto | SKU |
| FAMILY (UP) com N códigos | 13 | 26,5 % do gasto | grupo; por MLB/cor só no total da janela (ver 3) |
| CATALOG com 1 código | 15 | 0,1 % do gasto | SKU |
| CATALOG com N códigos | 38 | 1,5 % do gasto | grupo |
| Sem MLB/código resolvido (FAMILY sem membros, CATALOG, ITEM fora do app) | 47 | 0,5 % do gasto | nenhum |
| Kit | 0 | — | — |
| Fora da listagem (Σ summary − Σ listados) | ? | 2,6 % do gasto | nenhum (provável `deleted`) |

**Gasto atribuível integralmente a um SKU** (o código só aparece em grupos de 1 código; a soma é
por código sobre esses grupos): **Avil 19,8 % do total**. Se a regra for mais
estrita (código com exatamente 1 grupo no histórico), a Avil cai para 2,0 %. A queda
vem do par "grupo ITEM antigo + grupo FAMILY novo" de um mesmo MLB migrado, em que os dois grupos
são do mesmo SKU. **DSA:** 99,2 % do total. Classes: CATALOG com 1 código, 22 grupos, 80,2 % do total;
FAMILY com 1 código, 26 grupos, 19,1 % do total (inclui 7,4 % de grupos EMPTY); FAMILY sem código no
app, 19 grupos, 0,8 % do total; **kit, 3 grupos, R$ 0**. Os 21 MLBs anunciáveis sem vínculo no app são
anúncios criados fora do PubliAI.

Achados:

1. **O gasto é disjunto por `ad_group_id`; a associação MLB → grupo é só a atual.** `ads/search`
   devolve 1 linha por MLB e, por isso, mostra só o grupo corrente. O histórico mostra MLBs que
   passaram por dois grupos (achado 3). Somar por grupo e depois por família não duplica gasto,
   desde que a soma seja por `ad_group_id`, nunca por MLB.
2. **O mesmo código aparece em mais de um grupo:** 159 de 1.241 na Avil (CATALOG+CATALOG 115,
   CATALOG+ITEM 22, ITEM+ITEM 18, FAMILY+ITEM 4, contando só os membros atuais) e 1 de 27 na DSA
   (CATALOG+FAMILY). Isso vem do anúncio de catálogo paralelo ao anúncio próprio, de legados com
   cores sobrepostas e da migração ITEM → FAMILY. **Regra:** deduplicar por `ad_group_id` ao somar
   em família. O gasto "do SKU" só existe quando **todos** os grupos em que o código aparece têm
   exatamente 1 código.
3. **A métrica por MLB existe** (`/ad_groups/{id}/ads`), mas não fecha com a do grupo em 54 dos
   grupos da Avil. Ex.: grupo FAMILY criado em 20/07 com um MLB de 11/06: MLB fica +213,8 % sobre o
   grupo. A métrica por MLB soma a janela inteira do anúncio, inclusive o gasto no grupo
   anterior (hoje EMPTY ou `deleted`). A do grupo só conta enquanto o MLB esteve nele. A soma por
   MLB dá um total que **passa em +0,95 % o total das campanhas**.
   Por isso ela não serve para somar. Na DSA, Σ MLB = Σ grupos (sem diferença, ambos no total de
   referência), e a diferença de 1 grupo (+22,4 %) é exatamente os 7,4 % dos grupos EMPTY.
4. A métrica por MLB **não tem série diária** (3.3). Só serve para o total de uma janela, com 1
   chamada por grupo e janela.

## 5. Reconciliação com o que o app já soma

- **Código:** `grep -rniE "publicidad|publicidade|advertis|product_ads|mercado ads|billing/integration|/billing/"`
  em `supabase/functions`, `src` e `supabase/migrations` → **0 ocorrências** fora de testes. `PADS`
  com `-w` → 0. O app não lê Ads nem a fatura do ML.
- **`ml_vendas.liquido`:** na Avil, na janela, `total_amount − sale_fee_total − frete_vendedor −
  liquido` deu **R$ 0,00 em todos os pedidos `paid`**: 2.514 com algum MLB anunciado e 573 sem.
  O líquido do app não carrega nenhum desconto de Ads.
- **`sale_fee`:** a razão `sale_fee / unit_price` em itens ≥ R$ 79 é igual com e sem anúncio
  (10,5 % e 11,5 %). A amostra é pequena (11 itens), mas mostra só comissão, sem Ads embutido.
- **Mercado Pago:** `_shared/mercadopago/financeiro.ts` lê `/v1/payments/search` só de pagamentos
  **recebidos** (`collector_id` = conta) e descarta `marketplace_shipment`. Uma cobrança de Ads, que
  a conta paga, não entra.
- **Fatura do ML:** `GET /billing/integration/monthly/periods?group=ML&document_type=BILL` →
  **403** `PA_UNAUTHORIZED_RESULT_FROM_POLICIES`. O app não tem a permissão de faturamento, então
  não deu para cruzar a linha `PADS` de agosto com a soma da API.

**Conclusão:** hoje **não há dupla contagem**. O gasto de Ads não está em `sale_fee`, em `liquido`
nem nas liberações do MP, e por isso também não está no lucro atual. Somá-lo como "despesa de Ads do
período", separada, não duplica nada. O risco futuro é alguém ligar a fatura do ML (linha `PADS`)
no Financeiro **e** a API de Ads no dossiê, somando os dois.

## 6. Operação

| Item | Medido |
|---|---|
| Latência | mediana ~310 ms, máx 735 ms (`ads/search` com limit=100); 50 GETs |
| Paginação | `limit`/`offset` com `paging.total` (campanhas, ad_groups, ads). `ad_groups/search` aceitou `limit=100`; a doc mostra 800. `product_ads/items?item_ids=` não tem `paging`. |
| Histórico | **90 dias** por chamada (400 acima disso). Grupos `deleted` ficam 90 dias no sistema (doc). Gasto anterior a 90 dias fica irrecuperável se não for coletado a tempo. |
| Carga diária (Avil) | Série diária por grupo: `GET /campaigns/{id}/ad_groups/metrics?date_from=D&date_to=D` devolve **todos os grupos da campanha com métrica naquele dia** em 1 GET. Em 26/09, vieram 2 dos 5 grupos da campanha: os 3 pausados não tiveram atividade, e a doc diz que dia sem métrica volta vazio. Custo: 7 campanhas × (1 dia novo + 14 dias de releitura da atribuição) ≈ **105 GETs/dia**, ou menos filtrando campanhas sem gasto. Mais 3 GETs de `ad_groups/search` (292 grupos) para o total da janela. **Não provado:** se um grupo que saiu da campanha (`campaign_id: 0`, 181 grupos na Avil) ainda aparece nos dias passados da campanha antiga. O fallback é 1 GET por grupo (`/ad_groups/{id}?aggregation_type=daily`, 90 dias numa chamada). |
| 401 | `GET` com o token da Avil no advertiser de outra conta → `401 {"error_code":"unauthorized"}`. |
| 403 | Bearer malformado (`APP_USR-0000-invalido`) → `403 {"blocked_by":"PolicyAgent","code":"PA_UNAUTHORIZED_RESULT_FROM_POLICIES"}`, **não 401**. Mesmo corpo do billing sem permissão. Token **expirado** não foi testado (regra de não renovar): o tratamento de 401 por expiração não foi comprovado. |
| 404 | `ad_group_id` inexistente → `404 {"error_code":"ad_group_not_found_exception"}`. Advertiser sem produto → `404 No permissions found for user_id` (doc). |
| 429 | não ocorreu em 50 GETs sequenciais. |

## 7. Decisões (respostas às 5 perguntas)

| # | Pergunta | Resposta |
|---|---|---|
| 1 | Acesso | **Sim nas três orgs.** Escopo `ads` efetivo, advertiser 200. Avil com gasto real (total no relatório privado do spike), DSA sem campanha ativa (zero comprovado desde 19/08), Daludi Shop com gasto. O spike **não encerra a 2c**. |
| 2 | Granularidade | A unidade confiável é o **Ad Group**. Alcance por SKU só quando todos os grupos do código têm 1 código: **Avil 19,8 %**, DSA 99 %. Legado multi-cor (49 % do gasto da Avil) só tem alcance de **anúncio**. FAMILY com N cores (26 %) tem gasto por MLB/cor medido pelo ML (não é rateio), mas só como total de janela, sem série diária e sem fechar com o grupo quando o MLB migrou. **Decisão para o Diego:** a spec proíbe rateio por cor e trata o grupo compartilhado como "lucro por SKU indisponível". O dado por MLB é medido, não rateado, então a regra pode ser revista. Não é premissa desta análise. Padrão: manter a spec e mostrar o gasto do grupo. |
| 3 | Métricas e calendário | Campos: `cost`, `clicks`, `prints`, `direct/indirect/total_amount`, `*_units_quantity`, `*_items_quantity`, `organic_*`, `acos`, `roas`, `cvr`, `ctr`, `sov`, `tacos`. Moeda: BRL (site). Datas `YYYY-MM-DD`, inclusivas, **série densa**. Fuso: BRT pela doc ("10:00 GMT-3"); a fronteira do dia não foi medida. Atribuição: último clique em 14 dias (senão última impressão em 24 h), `direct` = mesmo anúncio e `indirect` = outro anúncio do vendedor. Atraso: hoje já vem parcial às 08:30 BRT. Revisão: vendas atribuídas mudam por até 14 dias. Reler os últimos 14 dias a cada coleta; `cost` provavelmente fecha em D+1. **CPC/ROAS/ACOS recalculados** por Σ `cost` / Σ `clicks` e Σ `total_amount` / Σ `cost`, nunca pela média dos percentuais da API. |
| 4 | Reconciliação | Não há dupla contagem hoje (seção 5). A "despesa de Ads do período" = Σ `cost` dos grupos, com as campanhas `error` e `deleted` incluídas. A conferência com a fatura `PADS` ficou bloqueada (403 no billing). |
| 5 | Operação | Janela máxima de 90 d por chamada, paginação offset, ~310 ms, série diária por grupo em 1 GET por campanha e dia (~105 GETs/dia na Avil com releitura de 14 dias). Sem 429. Erros: 401 conta alheia, 403 bearer malformado ou sem política, 404 recurso ou produto ausente. |

## 8. Incertezas

- **Conferir com o painel oficial (não feito, pedir ao Diego):** em Mercado Ads → Relatórios da
  Avil, período **29/06 a 26/09/2026**, o investimento total deve bater com o total de referência do
  relatório privado do spike. Se o painel mostrar 2,4 % menos que esse total, ele também esconde
  campanhas em `error`.
- **2,6 % do gasto fora de qualquer grupo listado** (Σ summary − Σ listados). Hipótese: grupos
  `deleted`, mantidos 90 dias pela doc, que o `ad_groups/search` não lista e cujo filtro de status é
  ignorado. Sem esse valor, o gasto por família fica abaixo do total.
- **Σ por MLB > total (+0,95 % na Avil).** Não explicado. Por isso a métrica por MLB não serve
  de soma.
- **Revisão do `cost` de D-1:** não houve releitura depois das 10:00 BRT. O dia 26/09 já tinha
  valor às 08:26 BRT. Falta provar se `cost` muda depois disso e por quantos dias os `*_amount`
  mudam (até 14 pela regra de atribuição).
- **Fronteira do dia (BRT contra UTC):** não medida. A doc diz GMT-3 e as visitas (052) indicam
  BRT, mas não houve prova com evento perto da meia-noite.
- **Endpoints "legados" ainda vivos** (`ads/search` e `product_ads/items?item_ids=`). A doc marca
  a remoção para 30/06/2026. Não usar em produção sem fallback: podem virar 404 sem aviso.
- **Fatura do ML (403):** o app não tem permissão de faturamento. Para a conferência `PADS`, o
  **Diego** precisa habilitar a permissão de faturamento/"Billing" no portal de aplicações do ML
  (developers → Minhas aplicações → PubliAI → Permissões funcionais) e reautorizar as conexões.
  **Não é pré-requisito da 2c**, só da prova cruzada.
- A página de atribuição mistura Product Ads e Display. A janela de 14 dias vale para ambos pelo
  texto, mas a doc de Product Ads não repete o número.
