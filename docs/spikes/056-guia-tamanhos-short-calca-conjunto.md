# Spike 056 — Guia de tamanhos para short, calça e conjunto infantil (ML)

**Status:** spike (pesquisa, não implementação)
**Data:** 2026-10-16
**Relacionado:** [Spike 051](051-guia-tamanhos-ml-api.md), ADR-0166, ADR-0167

Gatilho: nota de compra da J E Araujo (NF 1051) com short masculino e conjunto infantil
(tamanhos 2–16); próximas compras trazem calça (34–48). O cadastro só oferece P/M/G/GG e a
publicação só conhece `JACKETS_AND_COATS`/`SPORT_T_SHIRTS`.

Chamadas feitas com o token da conexão Daludi Shop
(`marketplace_connections.id = 57e11ff5-6098-4a25-b959-f43c92535b85`, conta `3675523966`).
Leitura: `GET` e `POST /catalog/charts/search` e `POST /items/validate` (não criam item).
Escrita autorizada pelo Diego em 2026-10-16: 2 charts de teste de 1 linha (seção 4).
Nenhum anúncio foi criado ou alterado.

## 1. Domínio por produto — CONFIRMADO

`GET /sites/MLB/domain_discovery/search`:

| Produto | Domínio | Categoria |
|---|---|---|
| short / bermuda masculina | `MLB-SHORTS` | MLB188064 Bermudas e Shorts |
| short infantil | `MLB-SHORTS` | MLB278065 / MLB188064 |
| calça (jeans, sarja) | `MLB-PANTS` | MLB188065 Calças |
| conjunto infantil (menino, menina, short+camiseta) | `MLB-CLOTHING_LOTS` | MLB271219 Kits de Conjuntos de Roupa |

## 2. Atributos — CONFIRMADO (`GET /categories/{id}/attributes`)

- **SHORTS e PANTS:** `SIZE` (required, allow_variations) já contém `2,4,6,8,10,12,14,16`,
  `34…48` e `P,M,G,GG`. `FILTRABLE_SIZE` (namespace de id próprio) tem `34…48` como número e o
  infantil como `"N anos"` (`2 anos` … `16 anos`). `SIZE_GRID_ID`/`SIZE_GRID_ROW_ID` presentes.
- **GENDER** (as três categorias): `Feminino 339665`, `Masculino 339666`, `Meninas`,
  `Meninos 339667` (id lido na resposta do chart, seção 4), `Bebês`, `Sem gênero infantil`,
  `Sem gênero 110461`. Ids lidos de `GET /categories/MLB188064/attributes` e `MLB271219`
  (2026-10-16): `Meninas 339668`, `Sem gênero infantil 19159491`.
- **CLOTHING_LOTS:** não tem `SIZE` nem `SIZE_GRID_ID`. O tamanho vai em `CLOTHING_LOT_SIZE`
  (string livre, allow_variations). `COLOR` required.

## 3. Tabela STANDARD do ML — CONFIRMADO que não existe

`POST /catalog/charts/search` `type=STANDARD` para PANTS e SHORTS × {Masculino, Feminino,
Meninos, Meninas} → `charts: []` em todas. CLOTHING_LOTS → `400 chart_not_available_for_invalid_domain:
"Domain MLB-CLOTHING_LOTS not active."` (o domínio não tem guia de tamanhos).

## 4. Colunas obrigatórias do chart — CONFIRMADO

`POST /catalog/charts` com linha só com `SIZE` → `required_row_attribute_not_found` para
**`FILTRABLE_SIZE`** e **`HIP_CIRCUMFERENCE_FROM`**, idêntico em PANTS e SHORTS, adulto
(Masculino, 40) e infantil (Meninos, 4).

Com as três colunas, criado (HTTP 201, `measure_type: BODY_MEASURE`):

- `10159973` — SHORTS, Meninos, `SIZE 4 (4119847)` + `FILTRABLE_SIZE "4 anos" (12189465)` +
  `HIP_CIRCUMFERENCE_FROM "56 cm"`.
- `9699362` — PANTS, Masculino, `SIZE 40 (3189142)` + `FILTRABLE_SIZE "40" (12189537)` +
  `HIP_CIRCUMFERENCE_FROM "98 cm"`.

São charts de teste (nome `TESTE PubliAI colunas …`), não ligados a item. Mapeamento infantil
confirmado: `SIZE "N"` ↔ `FILTRABLE_SIZE "N anos"`. Formato da medida igual ao do Spike 051
(`"<n> cm"`).

## 5. Item referenciando o chart — CONFIRMADO

`POST /items/validate`, item plano (User Products, `family_name`), com `SIZE` + `SIZE_GRID_ID` +
`SIZE_GRID_ROW_ID`: os erros `fashion_grid` somem nas duas categorias. Restam só
`picture_not_found` (foto falsa do teste) e atributos comuns da categoria
(`SHORT_TYPE`/`PANT_TYPE`, `MAIN_MATERIAL`). Sem grid: `missing.fashion_grid.grid_id.values`
(PANTS e SHORTS exigem o grid).

**CLOTHING_LOTS:** `variations[]` é recusado (`The field variations is invalid with family
name`), igual ao Spike 051 §2 — também é item plano. Item plano com `CLOTHING_LOT_SIZE "4"` e
sem grid: único erro é a foto falsa. **Publica sem guia de tamanhos.**

## 6. Consequências para o código

- O short já cadastrado não publica hoje: `SHORTS` está fora de `DOMINIOS_SUPORTADOS`
  (`_shared/ml/size-chart.ts`) e o ML exige grid.
- `tipoDaGrade` assume listas disjuntas; `34…46` da calça colide com `NUMERACOES_CALCADO`.

## 7. Tabelas de quadril — decisão do Diego (2026-10-16)

Medida do **corpo**, piso da faixa (mesma convenção de `CONTORNO_PEITO_CM`). Não é medida da
peça e não existe padrão oficial brasileiro aberto (NBR 15800 é paga e exige altura/tórax/cintura,
não quadril).

- Infantil (Meninos/Meninas/Sem gênero infantil): 2→56, 4→62, 6→66, 8→71, 10→76, 12→81, 14→87,
  16→92 (base MacPac Kids; 16 extrapolado +5).
- Adulto 34–48: masculino `2n+20` (34→88 … 48→116; confere com Maxturbos ±1 cm), feminino `2n+22`
  (34→90 … 48→118; igual à tabela EU da Halti). Sem gênero usa a masculina.
- P/M/G/GG: masculino 96/100/104/108 (≈38/40/42/44), feminino 94/102/110/118 (≈36/40/44/48).
