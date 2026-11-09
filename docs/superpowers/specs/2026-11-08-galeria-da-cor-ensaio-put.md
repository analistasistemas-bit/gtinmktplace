# Galeria da cor — ensaio do contrato do ML (Task 1)

**Data:** 2026-11-09 (UTC). **Script:** `scripts/ensaio-galeria-put.ts` (fora da suíte; guarda de item, corpo só-fotos, restauro automático).
**Status:** (a)–(g) medidos; (h) **PENDENTE** (ensaio interrompido por pausa pedida pelo Diego). Galeria **não liberada** até (h).

Anúncios autorizados pelo Diego (org Avil), só escrita de fotos, originais restauradas no fim:

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

Resposta do upload já vem com `status: ACTIVE` e `variations[].secure_url` (`D_NQ_NP_<id>-F.jpg`); `GET /pictures/{id}` → 200/ACTIVE logo depois. A foto fica utilizável em ~1–1,5 s.
Achados: (1) `secure_url` do item (`D_<id>-O.jpg`) é a versão de **500 px**; a original está em `D_NQ_NP_<id>-F.<ext>` — uma 1ª re-subida pela `-O` gerou `858776-MLB119401207702_112026` (500x500, nunca usada em PUT, órfã). (2) `mlstatic` responde **405 a HEAD**: sondar com GET. (3) Mesmos bytes → id **novo** (sem deduplicação).

## (b)/(c) Legacy — PUT de `picture_ids` sem `available_quantity`

1. `PUT {variations:[{id, picture_ids}] ×2}` com id novo (não presente em `pictures` do item) → **400** `item.pictures.invalid.missing_ids` (cause_id 287): *"Variations pictures [897793-…] are not present in item pictures list."* Nada mudou (GET depois igual).
2. `PUT {pictures:[6 ids, o novo no lugar de 667978], variations:[{id, picture_ids}] ×2}` → **200**. Preço, estoque (item 1445; variações 838/607), status, `seller_custom_field` (02864002/02928469), `attribute_combinations` e contagem (6) iguais; só a foto trocou.
3. `PUT {variations:[{id, picture_ids}] ×2}` só **reordenando ids já existentes** → **200**, invariantes iguais.

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

Casamento: **por id** (o ML não renomeia) e a ordem do GET é a ordem enviada. `max_size` do GET do item = do upload. Ids removidos podem ser reenviados depois (o restauro reusou os originais).

## (g) Restauro

| MLB | Restauro (UTC) | HTTP | Conferência por GET (09:56:57Z) |
|---|---|---|---|
| MLB7168683146 | 09:56:05 e 09:56:19 (após a reordenação) | 200 | recorte igual ao inicial (preço, estoque, status, SKU, combinações, `pictures` e `picture_ids` na ordem) |
| MLB7245326808 | 09:56:47 | 200 | recorte igual ao inicial |
| MLB7245326842 | não escrito | — | recorte igual ao inicial |

`tags` só mudaram de **ordem** após cada PUT (conjunto igual).

## Escritas feitas (todas em MLB autorizado, só fotos)

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

## (h) O inverso — PUTs sem `pictures` preservam as fotos? — **PENDENTE**

Sem autorização para escrever estoque, preço, atributos ou kit nestes itens; nada no repo prova a preservação com GET antes/depois. Corpos lidos no código:

| Caminho | Corpo enviado | Prova |
|---|---|---|
| `atualizarEstoque` (`sincronizar-estoque/processar.ts`) | Legacy: `variations:[{id, available_quantity}]` | PENDENTE (código não reconferido antes da pausa) |
| `putQuantidade` (kit-variacao) | `{available_quantity}` | PENDENTE (arquivo não localizado antes da pausa) |
| `atualizarItemPlanoML` (`_shared/ml/atualizar-item.ts`) | `{price?, available_quantity?, attributes?}` | PENDENTE |
| reajuste em massa (`_shared/operacoes/reajuste/ml.ts`) | Legacy `{variations:[{id, price}]}`; plano `{price}` | PENDENTE |
| `sincronizar-marca-ml` (`index.ts:117`) | `{attributes}` | PENDENTE |

Escrita mínima que provaria cada um (exige autorização do Diego): GET → o mesmo PUT com o **valor atual** (quantidade/preço/atributos idênticos ao GET) → GET, comparando `pictures` e `variations[].picture_ids`. Pelo resultado de (b)-3, a hipótese é preservar (o ML trata `variations` parcial por campo), mas hipótese não libera o portão.

**Portão:** (a)–(g) passaram; (h) pendente → galeria **não liberada**.
