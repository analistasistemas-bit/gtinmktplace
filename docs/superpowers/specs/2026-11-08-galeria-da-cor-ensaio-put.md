# Galeria da cor — ensaio do contrato do ML (Task 1)

**Data:** 2026-11-09 (UTC). **Script:** `scripts/ensaio-galeria-put.ts` (fora da suíte). Desde o fix round 1: medição só aprova com HTTP 2xx **e** fotos do GET iguais ao corpo enviado (ids, ordem e quantidade, no item e em cada variação) **e** o resto igual; corpo de restauro gravado **antes** de cada escrita; GET pós-PUT com novas tentativas; restauro só é declarado depois de GET igual ao retrato. Desde o fix round 2: o restauro roda **sempre** (`finally`, também em `inverso`) quando o estado pós-PUT não é comprovadamente igual ao retrato, inclusive se o GET lançar; a gravação de evidência nunca lança e é feita **depois** do restauro. Comando `inverso` para (h).
**Status:** (a)–(h) medidos. (h) medido em 2026-11-09 ~10:54–10:59Z, com 3 escritas autorizadas pelo Diego (valores atuais, sem mudança real). **Portão: PASSOU nas formas medidas** (ver (h)). Fix round 1 (11:03Z): (i) UP com 7 fotos medido; contrato do upload registrado; evidência sanitizada versionada.

**Evidência versionada:** `docs/superpowers/specs/evidencias/galeria-ensaio/` (JSON por MLB e passo: horário, preço, estoque, status, SKU, `attribute_combinations`, ids de fotos na ordem, por variação; sem token nem dado de comprador). **Limite da prova:** (b) foi **re-medido** no fix round 2 com evidência versionada (ver (b)-4). Os brutos de (a), (c), (e)–(g) (09:55–09:57Z) não existem mais (`/tmp/ensaio-galeria` foi limpo); o que o doc diz dessas etapas vem do registro feito à época, e a prova versionada do estado final delas é o GET de 11:03:07–08Z (`*-estado-final-*.json`, MLB7168683146 e MLB7245326808) e o retrato de MLB7245326842 antes de (i) (7 fotos, como registrado). Os de 7168683146 e 7245326808 batem com os valores escritos em (b), (d) e (h) (preço, estoque, SKUs, fotos originais 667978…/943890…); isso prova o estado final, não cada passo intermediário. As medições originais de (b)/(d) conferiram o recorte com o script antigo, que **não** comparava as fotos contra o corpo enviado (só invariantes e contagem) — o casamento de ids/ordem de (f) foi lido à mão no GET. O contrato do upload tem JSON próprio (ver (e)).

Anúncios autorizados pelo Diego (org Avil). (a)–(g): só escrita de fotos, originais restauradas no fim; (h): 3 PUTs de estoque/preço com os valores atuais (ver (h)):

| MLB | Formato | Fotos | Guarda (sold=0, active, catalog=false, sem migration_pending) |
|---|---|---|---|
| MLB7168683146 (Fitas Veludo 16mm, 2 variações) | Legacy | 6 (3 por variação) | ok |
| MLB7245326808 (Lantejoula Búfalo, UP plano) | UP | 1 | ok |
| MLB7245326842 (Lantejoula Búfalo, UP plano, irmão) | UP | 7 | ok |

Nenhuma foto alheia foi usada: toda foto "nova" é a re-subida dos bytes da própria foto atual do item.

## (a) `catalog_listing` em item comum

Nos 3 itens o ML devolve `catalog_listing: false` **explícito** em: GET completo `/items/{id}`, `/items/{id}?attributes=id,status,catalog_listing,catalog_product_id` e `/items/bulk?ids=…&attributes=status_code,body.id,body.status,body.catalog_listing` (o mesmo caminho de `caminhoMultiget`/`varrer-itens.ts`).
**Decisão:** o ML não omite o campo em item comum → **ausente continua `catalogo_desconhecido`**.

## (e) Upload multipart e tempo até a URL

`POST /pictures/items/upload`, campo `file`, `User-Agent: Mozilla/5.0` → **HTTP 201** (o 405 registrado em `fotos.ts` na E1 não se repetiu).

| Origem (própria do item) | Bytes | HTTP | ms do POST | upload id | max_size | ms até GET 200 na `secure_url` |
|---|---|---|---|---|---|---|
| 667978-MLB113299208758_072026 (Legacy) | 198313 | 201 | 1156 | 897793-MLB121113625135_112026 | 1024x1024 | 1446 |
| 943890-MLB113772297516_072026 (UP 808) | 126810 | 201 | 909 | 823064-MLB119401209710_112026 | 807x953 | 1152 |

### Endpoint usado pela galeria (ruling do controller)

O brief pedia `POST /pictures`; o **medido** foi `POST /pictures/items/upload` (multipart, campo `file`, `User-Agent: Mozilla/5.0`). **A galeria usa o endpoint medido.** `POST /pictures` com `{source}` (URL; usado hoje em `_shared/ml/fotos.ts`) **não foi medido** neste ensaio e **não é usado pela galeria**.

Contrato observado (2ª medição, fix round 1, 11:03:24Z, re-subida da foto 659969-MLB113772252896_072026 do próprio MLB7245326842; evidência `upload-contrato-755051-MLB119404244560_112026.json`):

| Campo | Observado |
|---|---|
| HTTP | 201, ~950 ms |
| campos da resposta | `crop`, `dominant_color`, `hash`, `id`, `max_size`, `origin`, `status`, `variations` |
| `id` | `755051-MLB119404244560_112026` (formato igual ao dos ids do item) |
| `status` | `ACTIVE` |
| `variations[]` | 17 tamanhos, cada um só com `size`, `url`, `secure_url` — **não existe `variations[].id`** |
| `max_size` | 859x906 (a mesma foto no item está como 860x906: a re-subida pode diferir 1 px; não usar `max_size` para casar foto) |

Identidade: **id do upload = id enviado no PUT = id lido no GET** (provado em (f) com 897793-… e 823064-…). O casamento é só por `id`; `variations[]` do upload são tamanhos da imagem, não variações do anúncio. Esta 2ª re-subida não foi usada em PUT (órfã, como a de 500 px).

Resposta do upload já vem com `status: ACTIVE` e `variations[].secure_url` (`D_NQ_NP_<id>-F.jpg`); `GET /pictures/{id}` → 200/ACTIVE logo depois. A foto fica utilizável em ~1–1,5 s.
Achados: (1) `secure_url` do item (`D_<id>-O.jpg`) é a versão de **500 px**; a original está em `D_NQ_NP_<id>-F.<ext>` — uma 1ª re-subida pela `-O` gerou `858776-MLB119401207702_112026` (500x500, nunca usada em PUT, órfã). (2) `mlstatic` responde **405 a HEAD**: sondar com GET. (3) Mesmos bytes → id **novo** (sem deduplicação).

## (b)/(c) Legacy — PUT de `picture_ids` sem `available_quantity`

1. `PUT {variations:[{id, picture_ids}] ×2}` com id novo (não presente em `pictures` do item) → **400** `item.pictures.invalid.missing_ids` (cause_id 287): *"Variations pictures [897793-…] are not present in item pictures list."* Nada mudou (GET depois igual).
2. `PUT {pictures:[6 ids, o novo no lugar de 667978], variations:[{id, picture_ids}] ×2}` → **200**. Preço, estoque (item 1445; variações 838/607), status, `seller_custom_field` (02864002/02928469), `attribute_combinations` e contagem (6) iguais; só a foto trocou.
3. `PUT {variations:[{id, picture_ids}] ×2}` só **reordenando ids já existentes** → **200**, invariantes iguais.
4. **Re-medição com evidência (fix round 2, script corrigido):** `PUT {pictures:[6 ids, ordem atual], variations:[{id:197626117402, picture_ids:[651426, 667978, 667002]} (duas primeiras trocadas), {id:197626117404, picture_ids:[sem mudança]}]}`, sem upload novo:

| UTC | Passo | HTTP | Conferência |
|---|---|---|---|
| 11:18:26.0 | GET antes | — | guarda ok; restauro gravado antes da escrita |
| 11:18:26.4 | PUT (formato de (b)-2) | 200 | GET: `pictures` do item na ordem enviada (6, inalterada); variação 197626117402 = `[651426, 667978, 667002]`; 197626117404 inalterada; preço 28,35, estoque 1445 (838/607), status, SKUs e combinações iguais |
| 11:18:27.1 | PUT restauro | 200 | GET 11:18:27.4 igual ao retrato (ids e ordem por variação) |
| 11:19:15 e 11:19:21 (~54 s após o restauro) | GET de novo | — | igual ao retrato |

Evidência: `MLB7168683146-b-legacy-ordem-var-*`. Achado: a ordem por variação é independente da ordem de `pictures` do item.

**(c) não se aplica:** o ML **não** exige `available_quantity`; a recusa de (1) é só a foto fora da lista do item. Formato Legacy **não bloqueado**.
Todas as variações foram enviadas em todo PUT (variação omitida pode ser apagada no Legacy — não medido de propósito).

## (d) UP — PUT só `{pictures}`

`PUT MLB7245326808 {pictures:[{id:"823064-MLB119401209710_112026"}]}` (troca a única foto) → **200**; preço 39,9, estoque 90, status, `seller_custom_field` 02994780 iguais; contagem 1.
O user product `MLBU4409415001` passou a mostrar a foto nova (propaga ao UP, esperado). Irmão MLB7245326842 (outro UP) **inalterado** (recorte igual ao inicial).

## Corpo mínimo por formato

| Formato | Corpo mínimo | Bloqueado? |
|---|---|---|
| Legacy, foto nova | `{ pictures: [{id}…] (lista completa do item, na ordem), variations: [{id, picture_ids}] (TODAS as variações) }` | não |
| Legacy, só reordenar ids já no item | `{ variations: [{id, picture_ids}] (todas) }` | não |
| UP / item plano | `{ pictures: [{id}…] (lista completa) }` | não |

Nunca `available_quantity`, `price`, `attributes`.

## (f) Identidade da foto

| Passo | Legacy | UP 808 |
|---|---|---|
| id do upload | 897793-MLB121113625135_112026 | 823064-MLB119401209710_112026 |
| id enviado no PUT | o mesmo | o mesmo |
| id lido no GET | o mesmo, na posição enviada (`pictures[0]` e `variations[0].picture_ids[0]`) | o mesmo (`pictures[0]`) |

Casamento: **por id** (o ML não renomeia) e a ordem do GET é a ordem enviada. `max_size` do GET do item = do upload nesses dois casos (mas ver o achado de 1 px acima). Ids removidos podem ser reenviados depois (o restauro reusou os originais).

## (g) Restauro

| MLB | Restauro (UTC) | HTTP | Conferência por GET (09:56:57Z) |
|---|---|---|---|
| MLB7168683146 | 09:56:05 e 09:56:19 (após a reordenação) | 200 | recorte igual ao inicial (preço, estoque, status, SKU, combinações, `pictures` e `picture_ids` na ordem) |
| MLB7245326808 | 09:56:47 | 200 | recorte igual ao inicial |
| MLB7245326842 | não escrito | — | recorte igual ao inicial |

`tags` só mudaram de **ordem** após cada PUT (conjunto igual).

## (i) UP com N>1 fotos — reordenar a lista completa (fix round 1)

Dentro da autorização original (só fotos, 3 MLBs). MLB7245326842 (UP plano, 7 fotos, SKU 02994801, preço 39,9, estoque 363, vendidos 0, active, `catalog_listing=false`). Lista sempre **completa** (o script recusa lista parcial).

| UTC | Passo | Corpo / leitura | HTTP | Conferência |
|---|---|---|---|---|
| 11:03:15.2 | GET antes | ordem `805387, 659969, 661753, 701750, 641756, 999451, 831619` | — | guarda ok; restauro gravado antes da escrita |
| 11:03:15.5 | PUT | `{pictures:[659969, 805387, 661753, 701750, 641756, 999451, 831619]}` (2 primeiras trocadas) | 200 | GET 11:03:15.8: ordem = corpo, 7 fotos, nenhuma perdida; preço, estoque, status, SKU iguais |
| 11:03:16.3 | PUT restauro | `{pictures:[ordem original]}` | 200 | GET 11:03:16.5: igual ao retrato (ids e ordem) |
| 11:03:29 · 11:04:04 · 11:05:02 (~106 s após o restauro) | GET de novo | — | — | igual ao retrato |

Ids completos nos JSON `MLB7245326842-up-ordem-7-*`. **Resultado:** no UP, `{pictures}` com a lista completa aplica a ordem enviada (inclusive a capa) e preserva todas as fotos; restauro conferido.

## UP com 2 tamanhos da mesma cor — não aplicável na AVIL

O brief pedia uma família UP com ≥2 tamanhos da mesma cor. Na AVIL isso não existe: a família 02994771 (Lantejoula Búfalo) tem 1 MLB por cor (informado pelo coordenador; Diego ciente). Fica coberto pelos testes automáticos e pela validação real da Task 16.

## Escritas feitas em (a)–(g) (todas em MLB autorizado, só fotos; as de (h) estão na seção (h))

| UTC | MLB | Corpo | HTTP |
|---|---|---|---|
| 09:55:50 | 7168683146 | variations ×2, id novo | 400 (nada mudou) |
| 09:55:59 | 7168683146 | pictures + variations, id novo | 200 |
| 09:56:05 | 7168683146 | restauro | 200 |
| 09:56:14 | 7168683146 | variations ×2, reordena | 200 |
| 09:56:19 | 7168683146 | restauro | 200 |
| 09:56:34 | 7245326808 | pictures [novo] | 200 |
| 09:56:47 | 7245326808 | restauro | 200 |

Mais 3 uploads (`/pictures/items/upload`) que não tocam item.

## (h) O inverso — PUTs sem `pictures` preservam as fotos? — **medido: preservam**

Escritas autorizadas pelo Diego (2026-11-09): exatamente 3 PUTs, cada um com os valores **atuais** lidos no GET imediatamente antes (`deno run -A scripts/ensaio-galeria-put.ts inverso estoque|preco|plano`). Guarda antes de cada um: `sold_quantity=0`, `active`, `catalog_listing=false`, sem `variations_migration_pending` — ok nos três. Nos PUTs de preço o script também exigiu, antes de escrever, `original_price` nulo (item e variações), só preços `standard` em `/items/{id}/prices` (`show-all-prices`) e o `standard` igual ao `price` do GET — ok (nenhuma promoção ativa). Conferência por GET logo após e de novo ~60 s depois: recorte inteiro (preço, estoque, vendidos, status, SKU, `attribute_combinations`, `pictures` com id/ordem/`max_size`/URL e `variations[].picture_ids` com ids e ordem) e `/prices` (incluindo as faixas de atacado).

Corpos lidos no código e conferidos antes de enviar:

| Caminho | Corpo no código |
|---|---|
| push de estoque, `atualizarEstoque` (`_shared/canais/mercado-livre.ts:430`, variações: `montarVariacoesUpdate(..., somenteEstoque=true)` + `atualizarItemML`; `:422`, item plano: `atualizarItemPlanoML`) — chamado de `sincronizar-estoque/processar.ts:586` | Legacy `{variations:[{id, available_quantity}]}` (todas); plano `{available_quantity}` |
| reajuste em massa (`_shared/operacoes/reajuste/ml.ts`, `putPreco`) | Legacy `{variations:[{id, price}]}` (todas, mesmo preço); plano `{price}` |
| `atualizarItemPlanoML` (`_shared/ml/atualizar-item.ts`; reposição UP e push de estoque de item plano) | `{price?, available_quantity?, attributes?}` |
| `putQuantidade` do kit (injetado e chamado em `_shared/kit-variacao/saga.ts:596`; corpo em `kit-transferencia/index.ts:133`) | `{available_quantity}` |
| `sincronizar-marca-ml` (`index.ts:117`) | `{attributes}` |

### Escritas e resultado

| UTC | MLB | Corpo enviado | HTTP | Recorte logo após | Recorte ~60 s | `/prices` | Fotos preservadas |
|---|---|---|---|---|---|---|---|
| 10:54:07 | 7168683146 (Legacy) | `{variations:[{id:197626117402, available_quantity:838},{id:197626117404, available_quantity:607}]}` | 200 | igual | igual (10:55:09) | igual | **sim** |
| 10:56:42 | 7168683146 (Legacy) | `{variations:[{id:197626117402, price:28.35},{id:197626117404, price:28.35}]}` | 200 | igual | igual (10:57:44) | igual (atacado 26,93/≥5 e 25,52/≥10 intacto) | **sim** |
| 10:57:50 | 7245326808 (UP plano) | `{price:39.9, available_quantity:90}` | 200 | igual | igual (10:58:52) | igual (atacado 31,9/≥5 intacto) | **sim** |

GET antes = depois (~60 s), por item:

| MLB | Preço | Estoque | Vendidos | Status | Variações (id · SKU · cor · preço · estoque · nº `picture_ids`) | `pictures` (ids, na ordem) |
|---|---|---|---|---|---|---|
| 7168683146 | 28,35 | 1445 | 0 | active | 197626117402 · 02864002 · Branco · 28,35 · 838 · 3 — 197626117404 · 02928469 · Preto · 28,35 · 607 · 3 | 667978-MLB113299208758_072026, 651426-MLB114535152117_072026, 667002-MLB114543264129_072026, 657019-MLB114543264329_072026, 727809-MLB114535230381_072026, 933412-MLB114543440809_072026 (var. Branco = 3 primeiras; Preto = 3 últimas) |
| 7245326808 | 39,9 | 90 | 0 | active | — (plano; SKU 02994780) | 943890-MLB113772297516_072026 |

`tags`: só mudaram de **ordem** (conjunto igual) após os PUTs de estoque e do item plano — o mesmo de (g).
Evidência sanitizada: `evidencias/galeria-ensaio/MLB7168683146-h-estoque-*`, `MLB7168683146-h-preco-*`, `MLB7245326808-h-plano-*` (antes, logo após, ~60 s). `/prices` antes/depois em `*-h-*-prices.json`: transcritos da saída de console das execuções (os JSON de recorte não traziam esse corpo); o script agora grava esse arquivo direto. Não houve restauro em (h): nada mudou.

### Resultado por caminho (dispensados da trava)

| Caminho | Prova | Dispensado da trava |
|---|---|---|
| `atualizarEstoque`, Legacy | **medido** (PUT 1) | sim |
| reajuste em massa, Legacy | **medido** (PUT 2) | sim |
| `atualizarItemPlanoML` com `price`+`available_quantity` (reposição UP) | **medido** (PUT 3) | sim |
| push de estoque de item plano e `putQuantidade` do kit `{available_quantity}`; reajuste plano `{price}` | subconjunto do PUT 3 (mesmo item plano, corpo raiz sem `pictures`) — **inferido do PUT 3**, não medido isoladamente | sim |
| `sincronizar-marca-ml` `{attributes}` e `atualizarItemPlanoML` com `attributes` | **inferido, não medido**: PUT de BRAND/atributos em filho UP pode reagrupar a família (memória "BRAND reagrupa família UP"), por isso não foi escrito. A regra observada nos 3 PUTs (o ML trata o corpo parcial por campo e não toca `pictures`/`picture_ids` omitidos) é a mesma; risco residual documentado | sim, por inferência |

**Portão:** (a)–(i) passaram → **PASSOU nas formas medidas** (estoque Legacy, preço Legacy, preço+estoque no item plano UP): `pictures`/`picture_ids` omitidos são preservados, sem mudança assíncrona em ~60 s. O PUT `{attributes}` fica coberto por inferência, não por medição.

**Ruling do controller (fix round 2):** os PUTs inferidos de (h) — `{attributes}`/marca, `putQuantidade` isolado e `{price}` isolado no item plano — ficam aceitos por inferência; a conferência real é na validação da Task 16.
