# Spike 052 — Contratos reais de visitas e de preço de oferta do Mercado Livre

**Status:** spike (pesquisa, não implementação)
**Data:** 2026-09-27
**Relacionado:** Vendas SKU — Fatia 2b (Tráfego e oferta), Task 1. Alimenta o parser da Task 3
(`supabase/functions/_shared/trafego/`) e o worker de coleta.

Toda afirmação abaixo foi medida contra a **API real**, com o token da conexão Mercado Livre da
Avil, **somente com GET**. O token nunca foi renovado fora do app (o ML rotaciona o refresh token)
nem impresso; foi lido em memória via `select ... from public.get_connection_tokens(...)` pela
Management API (SQL read-only). Script reproduzível: `scripts/spike-trafego-ml.py`
(`python3 scripts/spike-trafego-ml.py <connection_id> <saida_dir> MLB1 MLB2 ...`).
Execução em 2026-09-27 entre 08:00Z e 08:40Z (05:00–05:40 BRT).

## 1. Amostra

| Papel | Como foi escolhido | Estado no ML |
|---|---|---|
| Legado multi-cor | `anuncios_externos.variacoes_externas` com 23 códigos | `active` |
| Filho User Products | `anuncios_externos_itens.item_externo_id` | `active` |
| Simples | `anuncios_externos` com 1 código | `active` |
| Pausado | filho UP `retirado = true` | `paused` / `paused_by_seller` |
| Encerrados (extra) | vendidos em 180 dias fora do inventário | `closed` / `deleted` e `closed` sem sub_status |
| Pausado sem estoque (extra) | idem | `paused` / `out_of_stock` |

Mais 8 MLBs ativos para latência de visitas e **todos os 270 MLBs do inventário** para o formato
de `sale_price`. MLBs reais não aparecem aqui; as fixtures usam ids fictícios `MLB10000000NN`.

## 2. Visitas — `GET /items/{id}/visits/time_window?last=N&unit=day[&ending=YYYY-MM-DD]`

### 2.1 Formato

```json
{
  "item_id": "MLB1000000001",
  "date_from": "2026-04-30T00:00:00Z",
  "date_to": "2026-09-27T00:00:00Z",
  "total_visits": 5064,
  "last": 150,
  "unit": "day",
  "results": [
    { "date": "2026-08-25T00:00:00Z", "total": 94,
      "visits_detail": [{ "company": "mercadolibre", "quantity": 94 }] }
  ]
}
```

Fixtures: `supabase/functions/_shared/trafego/__tests__/fixtures/visits-150-esparso.json`,
`visits-10-ending-2026-09-20.json`, `visits-150-pausado-vazio.json`.

### 2.2 Achados

1. **Dias com zero visita são omitidos (resposta esparsa).** Em 12 itens, nenhum ponto com
   `total = 0` foi devolvido; `Σ results[].total = total_visits` em todos; o item de maior tráfego
   tem pontos contíguos desde o 1º dia de vida, e itens de pouco tráfego têm buracos. O 1º ponto de
   cada item coincide com a data de criação dele (6 itens verificados). **Conclusão: dentro da
   janela `[ending − N, ending]` de uma resposta HTTP 200, dia ausente em `results` = 0 visitas.**
2. **`results` vem fora de ordem.** O parser precisa ordenar/indexar por data, nunca confiar na
   posição.
3. **`last=N` devolve N + 1 dias, com as duas pontas inclusivas.** `last=10&ending=2026-09-20`
   → pontos de 2026-09-10 a 2026-09-20 (11 dias). `last=150` sem `ending` → janela
   2026-04-30..2026-09-27 (151 dias, hoje incluído).
4. **`ending` é inclusivo** (o dia `ending` vem na resposta). Sem `ending`, a ponta é hoje.
5. **`date_from`/`date_to` mudam de fuso conforme a chamada:** `...T00:00:00Z` sem `ending`,
   `...T00:00:00-04:00` com `ending`. Os pontos em `results[].date` vêm **sempre** `T00:00:00Z`.
   O parser deve usar `results[].date[:10]` como rótulo e derivar a janela de `last`/`ending`
   (ou de `date_from[:10]`/`date_to[:10]`), nunca do instante com fuso.
6. **As duas chamadas concordam:** para os 11 dias sobrepostos, os valores de `last=10&ending` são
   idênticos aos de `last=150` em todos os itens.
7. **Hoje vem presente e parcial.** Às 08:05Z o dia 2026-09-27 já existia com 3 visitas num item
   que faz ~170/dia, e 49 no total do vendedor (~1.100/dia). Ver 2.4 sobre a evolução.
8. **`unit=hour` não existe** nesta rota: o parâmetro é ignorado e a resposta volta com
   `unit: "day"`. `GET /visits/items?ids=&date_from=&date_to=` ignora as datas (devolve sempre o
   total do item) — não serve para janela.
9. **Pausado e encerrado:** HTTP 200 normal. Encerrado (`closed`/`deleted`) mantém o histórico
   (80 pontos, último em 2026-09-21; outro encerrado: 9 pontos, último em 2026-08-29). Pausado sem visitas → `results: []`,
   `total_visits: 0` (que, pela regra 1, é zero em todos os dias da janela).
10. **Nenhum 429/5xx** em ~1.000 GETs nesta sessão (ritmo sequencial, ~4 GET/s).

### 2.3 Calendário do dia — **não é UTC**

O rótulo `T00:00:00Z` sugere dia UTC, mas a prova contradiz:

- De 96 itens criados entre 01:00Z e 05:00Z, **3 itens criados entre 01:28Z e 01:35Z**
  (22:28–22:35 BRT do dia anterior) têm ponto de visita **no dia anterior em UTC** (os demais só
  tiveram a 1ª visita depois da meia-noite local, o que é compatível com qualquer calendário). Ex.: criado em `2026-08-07T01:28Z` (= 06/08 22:28 BRT) com visitas em
  `2026-08-06`; criado em `2026-07-16T01:34Z` (= 15/07 22:34 BRT) com visitas em `2026-07-15`.
  Em calendário UTC isso é impossível — o item não existia no dia 06/08 UTC.
- Às 08:05Z o dia "hoje" tinha ~4 % do volume diário do vendedor. Um dia UTC já conteria
  21:00–24:00 BRT, faixa forte de tráfego.
- As respostas com `ending` ecoam `date_from`/`date_to` em **-04:00**.

**Resíduo não resolvido: BRT (-03:00) ou -04:00.** Só um item criado entre 03:00Z e 04:00Z
decidiria, e a conta não tem nenhum (587 itens verificados). A diferença é de 1 hora
(00:00–01:00 BRT) na borda do dia; não afeta a métrica em janelas de vários dias.

### 2.4 Evolução de hoje e ontem

Leitura a cada 5 min, de 08:05Z a 08:35Z (05:05–05:35 BRT), com `last=1`:

| Hora (Z) | Vendedor: ontem (26/09) | Vendedor: hoje (27/09) | Item: ontem | Item: hoje |
|---|---|---|---|---|
| 08:05 | 902 | 49 | 179 | 3 |
| 08:15 | 902 | 50 | 179 | 3 |
| 08:25 | 902 | 53 | 179 | 3 |
| 08:35 | 902 | 55 | 179 | 4 |

- **Hoje cresce quase em tempo real** (~1 visita a cada 5 min no vendedor, madrugada BRT), o que
  confirma que o dia corrente é parcial e aberto. Ele deve ficar `pendente`.
- **Ontem ficou estável** em 30 min, mas 902 está abaixo da faixa usual (1.100–1.400). Pode ser
  tendência de queda (23→26/09: 1.411, 1.202, 1.109, 902) ou consolidação tardia. Não dá para
  provar em 30 min que ontem já está fechado. A regra de 48 h das restrições globais continua sendo
  a salvaguarda: reconsultar depois de 48 h antes de marcar o dia como estabilizado.

## 3. Preço de oferta — `GET /items/{id}/sale_price?context=channel_marketplace`

```json
{ "price_id": "25", "amount": 12.69, "regular_amount": 14.1, "currency_id": "BRL",
  "reference_date": "2026-09-27T08:03:06Z",
  "metadata": { "campaign_id": "P-MLB00000000",
                "promotion_id": "OFFER-MLB1000000004-00000000000",
                "promotion_type": "marketplace_campaign" } }
```

- Sempre as mesmas 6 chaves nos 270 MLBs do inventário (HTTP 200 em todos).
- **Sem promoção (262):** `regular_amount: null`, `metadata: {}`; `amount` = preço de lista.
- **Com promoção (8):** `regular_amount` = preço "de", `amount` = preço "por";
  `metadata` com `campaign_id`, `promotion_id`, `promotion_type` (só `marketplace_campaign` visto).
- `price_id` é string; `reference_date` é o instante da consulta em UTC (não é início de promoção).
- **Pausado e encerrado devolvem preço normalmente** (200 com `amount`). O preço não indica que o
  anúncio está à venda — o worker não pode inferir estado do anúncio a partir dele.
- Fixtures: `sale-price-com-promocao.json`, `sale-price-sem-promocao.json`.

## 4. Latência e carga

| Chamada | n | mediana | p90 | máx |
|---|---|---|---|---|
| visits `last=150` | 12 | 283 ms | 288 ms | 298 ms |
| visits `last=10&ending` | 12 | 270 ms | 292 ms | 300 ms |
| sale_price | 270 | 250 ms | 260 ms | 300 ms |

O tamanho da resposta não pesa: `last=150` custa o mesmo que `last=10`.

**Inventário da Avil** (7 fontes de `varrer-anuncios-orfaos` + `ml_vendas_itens.ml_item_id` com
`ml_vendas.date_closed` nos últimos 180 dias), MLBs distintos:

| Fonte | MLBs |
|---|---|
| `familias.ml_item_id` | 146 |
| `anuncios_externos.item_externo_id` | 134 |
| `anuncios_externos_itens.item_externo_id` | 134 |
| `kits_virtuais.ml_item_id` | 0 |
| `variacoes.catalog_listing_id` | 294 |
| `anuncios_externos_itens.catalog_listing_id` | 2 |
| `anuncios_externos.ml_item_id_anterior` | 0 |
| vendidos em 180 dias | 285 |
| **União** | **574** |

(Referência: `GET /users/{id}/items/search` lista 587 itens ativos+pausados na conta.)

**Estimativa por execução diária:** 574 MLBs × 2 GETs (visitas + `sale_price`) = **~1.150 GETs**.
Sequencial: 574 × ~0,53 s ≈ 5 min. Com concorrência 6 ≈ **~50 s de rede no total**.
Com lote 20: 574 / 20 = **29 mensagens (1 + 28 continuações)**, cada uma com ~2 s de rede
(20 × 2 GETs / 6 × ~0,28 s) — muito abaixo do orçamento de 90 s. O limite é o tamanho do lote,
não a latência: cabe com folga num dia (e caberia em 3 mensagens com lote 200). A carga inicial de
150 dias custa o mesmo número de GETs que a execução diária (1 GET cobre a janela inteira).

## 5. Decisões

| Decisão | Valor | Base |
|---|---|---|
| `calendario_trafego` | **`brt`** | 2.3: visitas rotuladas no dia local de itens criados 22h BRT; UTC descartado. Resíduo -04:00 registrado. |
| Rótulo do dia | `results[].date[:10]` **literal** | Não converter `T00:00:00Z` para BRT (daria D−1). |
| `ending` exclusivo? | **Não — inclusivo** | 2.2 item 4. `last=N` devolve N+1 dias. |
| 1 GET cobre 150 dias? | **Sim** | 151 dias numa resposta, sem paginação; histórico provado até 2026-06-04 (115 dias — nenhum item da conta é mais antigo com tráfego). |
| Dia ausente numa resposta 200 | **= 0 visitas (estado `ok`)** | 2.2 item 1. |
| Hoje | parcial → `pendente` | 2.2 item 7 e 2.4. |
| Pausado/encerrado | 200, tratar igual a ativo | 2.2 item 9; `sale_price` também 200. |
| Carga diária | 574 MLBs, ~1.150 GETs, 29 mensagens de lote 20, ~2 s cada | Seção 4. |

## 6. Consequências para as próximas tasks

- **Conflito com a regra "dia ausente ≠ zero"** das restrições globais: ela vale para dia **sem
  resposta 200** (falha, pendente, fora da janela consultada). Dentro da janela de uma resposta 200,
  a própria API codifica zero como ausência — tratar como `ok` com 0. Sem isso, todo dia sem visita
  vira `pendente` para sempre e a métrica fica indisponível em quase todo anúncio pequeno.
- O parser da Task 3 precisa: ordenar `results`; preencher com 0 os dias de `[ending − last, ending]`
  sem ponto; ignorar `visits_detail`; aceitar `date_from`/`date_to` em `Z` e em `-04:00`.
- Não usar `/visits/items` nem `unit=hour`.
