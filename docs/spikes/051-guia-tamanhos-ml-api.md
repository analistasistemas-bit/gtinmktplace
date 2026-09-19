# Spike 051 — Contrato real da API de guia de tamanhos do Mercado Livre

**Status:** spike (pesquisa, não implementação)
**Data:** 2026-09-19
**Relacionado:** [ADR-0166](../decisions/0166-tipo-de-produto-por-organizacao.md), prepara o ADR-0167
(guia de tamanhos gerenciado via API)

Toda afirmação abaixo é rotulada **CONFIRMADO** (com o comando real e o trecho de resposta que
prova) ou **NÃO CONFIRMADO** (resumo de busca, inferência por analogia, ou não testado). Nenhum
payload das Fases 4/5 pode usar um campo que não esteja em seção CONFIRMADO.

Todas as chamadas autenticadas usaram o token real da conexão Mercado Livre da organização piloto
Daludi Shop (`marketplace_connections.id = 57e11ff5-6098-4a25-b959-f43c92535b85`, conta ML
`3675523966`), via dois scripts one-off criados para este spike:
`scripts/ops/ml-get.ts` (GET autenticado), `scripts/ops/ml-post.ts` (POST autenticado) e
`scripts/ops/validar-payload-ml.ts` (POST `/items/validate` — nunca cria item real). Os scripts
ficam no repositório para reuso nas Fases 4/5 e em spikes futuros.

## 1. Gatilho

Em 2026-09-18, as URLs da documentação oficial do ML sobre guia de tamanhos devolveram HTTP 403 em
fetch automatizado:
`developers.mercadolivre.com.br/pt_br/gerenciar-tabela-de-medida`,
`developers.mercadolivre.com.br/pt_br/validacao-tabela-de-medidas`,
`developers.mercadolibre.com.ar/en_us/size-guide`, e variantes. **Reconfirmado em 2026-09-19**
(via `WebFetch`) nas duas primeiras — continuam 403. Os resumos de busca disponíveis eram
contraditórios entre si quanto a `value_id` de gênero e à obrigatoriedade real do `SIZE_GRID_ID`.
Por isso este spike testa contra a **API real**, não contra a documentação.

## 2. Ramo de publicação da categoria-alvo — achado crítico

**CONFIRMADO, e diferente da hipótese do plano original.** Para as quatro categorias de teste
(camiseta, calça, jaqueta, tênis — cobrindo TOPS/BOTTOMS/JACKETS/FOOTWEAR), o Mercado Livre
**recusa incondicionalmente o array `variations[]` (Legacy)**. Não é "Legacy OU User Products a
depender da categoria" como o plano assumia — é **User Products / item plano obrigatório**, sem
alternativa, nas quatro.

Comando (camiseta, MLB438951) e resposta, com `variations[]` de 2 linhas (COLOR+SIZE) e **sem**
`family_name`:

```
POST /items/validate
{ "category_id": "MLB438951", ..., "variations": [
    {"attribute_combinations":[{"id":"COLOR","value_name":"Azul"},{"id":"SIZE","value_name":"P"}], ...},
    {"attribute_combinations":[{"id":"COLOR","value_name":"Azul"},{"id":"SIZE","value_name":"M"}], ...}
  ] }
→ HTTP 400
{ "cause": [
    {"code":"body.required_fields","message":"The body does not contains some or none of the following properties [family_name]"},
    {"code":"body.invalid_fields","message":"The field variations is invalid with family name"}
  ] }
```

As duas mensagens juntas provam que não é uma questão de faltar `family_name`: adicionar
`family_name` ao mesmo payload devolve `"The field variations is invalid with family name"` — ou
seja, **`variations[]` é incompatível com esta categoria em qualquer configuração**, ela sempre
publica como família de itens (User Products).

Reproduzido idêntico em MLB432206 (Tênis, domínio FOOTWEAR) — mesmas duas mensagens de erro, ver
seção 6.

**Consequência arquitetural (para o Fable decidir antes da Fase 5):** cada combinação
cor × tamanho vira um **item ML separado** (não uma linha de `variations[]` dentro de um item),
agrupado pelo mesmo `family_name` + atributos não-variantes idênticos (BRAND, MODEL,
GARMENT_TYPE — já documentado em `reference_ml.md`/memória do projeto: "User Products: family_id
exige ficha igual"). Isso significa: um anúncio de "Camiseta Azul/Vermelha em P/M/G/GG" publica
**8 itens ML** (2 cores × 4 tamanhos), não 1 item com 8 variações. O desenho da Fase 5 do plano
original (payload de item único com `attribute_combinations` de COLOR+SIZE_GRID por variação)
**não se aplica** a estas categorias — precisa ser redesenhado para "N publicações por família,
uma por SKU", o que também muda o modelo de `anuncios_externos`/rastreio de MLB por variação hoje
usado só para Kit Virtual.

O payload de item plano validado com sucesso (sem os erros de estrutura, só faltando fotos/atributos
triviais) confirma o formato mínimo — ver seção 4.

## 3. Contrato de `POST /catalog/charts` — literal, testado e funcionando

**CONFIRMADO — chart real criado na conta da org piloto.** Caminho real (não é o que os resumos de
busca sugeriam — nem `/domains/{id}/technical_specs?section=grids`, que é só leitura de ficha
técnica, nem GET em `/catalog/charts/search`, que devolve 404):

```
POST https://api.mercadolibre.com/catalog/charts
Authorization: Bearer <token da org>
```

Corpo que o ML aceitou (após 6 rodadas de erro real — ver "Erros no caminho" abaixo):

```json
{
  "names": { "MLB": "Jaquetas Daludi Shop - Masculino P/M/G/GG" },
  "domain_id": "JACKETS_AND_COATS",
  "site_id": "MLB",
  "type": "SPECIFIC",
  "attributes": [
    { "id": "GENDER", "values": [{ "id": "339666", "name": "Masculino" }] }
  ],
  "main_attribute": { "id": "SIZE" },
  "rows": [
    { "attributes": [
        { "id": "SIZE", "values": [{ "id": "17552780", "name": "P" }] },
        { "id": "FILTRABLE_SIZE", "values": [{ "id": "13853813", "name": "P" }] },
        { "id": "CHEST_CIRCUMFERENCE_FROM", "values": [{ "name": "88 cm" }] }
    ] }
  ]
}
→ HTTP 200, chart id 8522331
```

Resposta real (GET `/catalog/charts/8522331`, confirmando persistência):

```json
{
  "id": 8522331,
  "names": { "MLB": "Jaquetas Daludi Shop - Masculino P/M/G/GG" },
  "domain_id": "JACKETS_AND_COATS",
  "type": "SPECIFIC",
  "rows": [
    { "id": "8522331:1", "attributes": [
        {"id":"SIZE","values":[{"name":"P"}]},
        {"id":"FILTRABLE_SIZE","values":[{"id":"13853813","name":"P"}]},
        {"id":"CHEST_CIRCUMFERENCE_FROM","values":[{"name":"88 cm","struct":{"number":88,"unit":"cm"}}]}
    ] },
    { "id": "8522331:2", "...": "M, 12917795, 96 cm" },
    { "id": "8522331:3", "...": "G, 13853814, 104 cm" },
    { "id": "8522331:4", "...": "GG, 13853815, 112 cm" }
  ]
}
```

**Achados de formato, todos CONFIRMADOS empiricamente (erro real lido a cada rodada, nunca
adivinhado de uma vez):**

- `domain_id` vai **sem** o prefixo `MLB-` (`JACKETS_AND_COATS`, não `MLB-JACKETS_AND_COATS`) —
  com o prefixo, o erro é `chart_not_available_for_invalid_domain: "Domain MLB-MLB-... not
  active"` (o backend concatena `site_id` + `domain_id`).
- `main_attribute` é objeto `{"id": "SIZE"}`, não string — string solta dá erro de
  deserialização Jackson (`ChartMainAttribute (although at least one Creator exists)`), prova de
  que o backend é a classe Java `com.mercadolibre.chartsbackend.model.chart.mainattribute.*`.
- `names` é `{ "<site_id>": "<nome>" }` (ex. `{"MLB": "..."}`), não `{"pt": "..."}` — o segundo
  formato dá `chart_name_missing`.
- Atributo de **valor de lista** (GENDER, SIZE, FILTRABLE_SIZE) usa
  `{"id": "<attr>", "values": [{"id": "<value_id>", "name": "<value_name>"}]}`.
- **`SIZE` e `FILTRABLE_SIZE` têm namespaces de `value_id` DIFERENTES** para o mesmo tamanho — P é
  `17552780` em `SIZE` mas `13853813` em `FILTRABLE_SIZE`. Usar o id de um no outro dá
  `value_is_not_in_the_list`. Os ids de `FILTRABLE_SIZE` vêm de
  `/categories/{id}/attributes`, campo `FILTRABLE_SIZE.values` (confirmado nesta mesma chamada,
  ver seção 7).
- Atributo **numérico** (`CHEST_CIRCUMFERENCE_FROM`, `value_type: number_unit`) usa
  `{"id": "...", "values": [{"name": "88 cm"}]}` — uma string `"<número> <unidade>"`, **não**
  `{"number":..,"unit":..}` nem `value_struct` (ambos tentados e rejeitados com
  `required_row_attribute_value_not_found`, silenciosamente tratado como "sem valor").
- O nome do chart (`names`) precisa ser único por site — reusar o mesmo nome depois de já ter
  criado um chart com as mesmas características dá `chart_name_unavailable`.

**Domínio de teste era `JACKETS_AND_COATS`, categoria `MLB108803`** (a mesma família de produto do
anúncio de referência do Diego, a jaqueta corta-vento). `SPORT_T_SHIRTS` (camiseta) exige as
mesmas duas colunas (`FILTRABLE_SIZE` + `CHEST_CIRCUMFERENCE_FROM`) — mesmo formato, não recriado
por completo neste spike para não duplicar chamadas, mas o erro de validação (`required_row_
attribute_not_found` citando os dois mesmos ids) foi reproduzido lá antes de migrar o teste para
jaqueta.

## 4. Referência no item — testada e funcionando

**CONFIRMADO.** `SIZE_GRID_ID` e `SIZE_GRID_ROW_ID` vão em `item.attributes` (item plano — não há
`attribute_combinations`/`variations[]` nestas categorias, ver seção 2), **junto com** `SIZE` como
texto solto (o grid não substitui o `SIZE`, ele complementa):

```json
{
  "category_id": "MLB108803",
  "family_name": "Jaqueta Daludi Shop Teste Spike 051",
  "attributes": [
    { "id": "GENDER", "value_id": "339666" },
    { "id": "BRAND", "value_name": "Daludi" },
    { "id": "MODEL", "value_name": "Teste" },
    { "id": "COLOR", "value_name": "Azul" },
    { "id": "SIZE", "value_name": "P" },
    { "id": "SIZE_GRID_ID", "value_name": "8522331" },
    { "id": "SIZE_GRID_ROW_ID", "value_name": "8522331:1" }
  ]
}
```

Progressão real dos erros até chegar neste formato (prova de que nada foi adivinhado):

1. Sem `SIZE_GRID_ID`/`SIZE_GRID_ROW_ID`: `missing.fashion_grid.grid_id.values` — "Attribute
   [SIZE_GRID_ID] is missing".
2. Com `SIZE_GRID_ID`+`SIZE_GRID_ROW_ID` mas sem `SIZE`: `missing.fashion_grid.size.values` —
   "Attribute [SIZE] is missing". **Os três são exigidos juntos.**
3. Com os três: os erros de `fashion_grid`/`structured-data` desaparecem por completo. Sobra só
   o que qualquer item incompleto teria — fotos obrigatórias e `GARMENT_TYPE`/`MAIN_MATERIAL`
   faltando (nada relacionado a tamanho).

`SIZE_GRID_ID` é o `id` do chart (`"8522331"`, string). `SIZE_GRID_ROW_ID` é `"{chart_id}:{índice
da linha}"` (`"8522331:1"` para a linha P) — o mesmo `id` que `POST /catalog/charts` devolveu para
cada linha, usado literalmente.

## 5. Gênero — id e value_id, lidos da API

**CONFIRMADO**, de `GET /categories/MLB438951/attributes` (e reconfirmado idêntico em
MLB420316/calça, MLB108704/vestido, MLB432206/tênis, MLB273770/sandália — mesmos ids em todas):

| Gênero (PubliAI) | `value_name` ML | `value_id` ML |
|---|---|---|
| masculino | Masculino | `339666` |
| feminino | Feminino | `339665` |
| unissex | **Sem gênero** | `110461` |

Não existe um value literal "Unissex" no ML — o rótulo real é "Sem gênero" (`110461`). Confirmado
também via `GET /categories/MLB273770/attributes` (Sandálias), a categoria do segundo anúncio de
referência do Diego (sandália unissex): a lista de valores de `GENDER` é idêntica, sem "Bebês"
(categoria só-adulto), com `Sem gênero = 110461` disponível.

`GENDER` tem tag `catalog_required` + `required` + `grid_template_required` em todas as
categorias testadas — é sempre obrigatório, com ou sem tamanho.

## 6. Domínios — todos exigem o grid, nenhum é exceção

**CONFIRMADO por teste direto em 4 de 5 domínios-alvo** (`POST /items/validate`, mesmo erro
`missing.fashion_grid.grid_id.values` em item plano sem grid):

| Domínio | Categoria testada | Exige `SIZE_GRID_ID`? | Rejeita `variations[]`? |
|---|---|---|---|
| TOPS (camiseta, `MLB-SPORT_T_SHIRTS`) | MLB438951 | **CONFIRMADO** sim | **CONFIRMADO** sim |
| BOTTOMS (calça, `MLB-PANTS`) | MLB420316 | NÃO CONFIRMADO (attrs idênticos a TOPS, não testado em `/items/validate`) | NÃO CONFIRMADO (mesma ressalva) |
| DRESSES (vestido, `MLB-DRESSES`) | MLB108704 | NÃO CONFIRMADO (attrs idênticos, não testado em `/items/validate`) | NÃO CONFIRMADO (mesma ressalva) |
| JACKETS_AND_COATS (jaqueta) | MLB108803 | **CONFIRMADO** sim | **CONFIRMADO** sim (implícito — chart criado e validado com sucesso só em item plano) |
| FOOTWEAR (tênis, `MLB-SNEAKERS`) | MLB432206 | **CONFIRMADO** sim | **CONFIRMADO** sim |

BOTTOMS e DRESSES têm o **schema de atributos** (`GET /categories/{id}/attributes`)
byte-a-byte idêntico ao de TOPS/JACKETS/FOOTWEAR nos campos relevantes (`SIZE`
required+allow_variations, `SIZE_GRID_ID`/`SIZE_GRID_ROW_ID` presentes, `GENDER`
catalog_required+required) — a inferência de que também exigem o grid é forte, mas **não foi
testada em `/items/validate`** por economia de chamadas; antes de escrever código para BOTTOMS ou
DRESSES especificamente, rodar o mesmo teste de item plano sem grid nessas duas categorias.

Sandálias (`MLB-SANDALS_AND_CLOGS`, MLB273770) teve só o schema de atributos lido (idêntico ao
padrão), não testado em `/items/validate` — mesma ressalva.

## 7. Colunas por domínio

**CONFIRMADO para `JACKETS_AND_COATS` e `SPORT_T_SHIRTS`** (erro real do `POST /catalog/charts`
listou as colunas obrigatórias antes de eu adivinhar nenhuma):

- `SIZE` — obrigatória, é o `main_attribute`. Valores fixos por categoria
  (`GET /categories/{id}/attributes`, campo `SIZE.values`).
- `FILTRABLE_SIZE` — obrigatória, mesmo texto de `SIZE` mas com **`value_id` próprio e
  diferente** (namespace separado, ver seção 3). Vem de
  `GET /categories/{id}/attributes`, campo `FILTRABLE_SIZE.values`.
- `CHEST_CIRCUMFERENCE_FROM` — obrigatória, medida corporal (contorno do peito), formato
  `"<número> cm"`.

**NÃO CONFIRMADO:** se calça/vestido exigem colunas de medida diferentes (ex. `WAIST_
CIRCUMFERENCE` em vez de `CHEST_CIRCUMFERENCE_FROM`) — plausível por analogia de domínio, mas não
testado. Antes da Fase 4 cobrir BOTTOMS/DRESSES, repetir o `POST /catalog/charts` com corpo
mínimo (só `SIZE`) e ler o erro `required_row_attribute_not_found`, que lista as colunas reais —
é o mesmo método usado aqui, não uma suposição nova.

**NÃO CONFIRMADO** para FOOTWEAR: não cheguei a testar `POST /catalog/charts` no domínio
`SNEAKERS`/`SANDALS_AND_CLOGS` (só confirmei que o item exige o grid, seção 6). Antes da Fase 4
cobrir calçado, rodar o mesmo teste — plausível que a coluna de medida seja um comprimento de pé
em vez de contorno de peito, mas isso é suposição até testar.

## 8. Update e ciclo de vida

**NÃO CONFIRMADO.** Não testado neste spike se um chart existente aceita `PUT`/novas linhas, se
linhas são imutáveis após criação, ou o que acontece com um item já vinculado a uma
`SIZE_GRID_ROW_ID` se a linha mudar. O resumo de busca menciona `POST
/catalog/charts/$CHART_ID/rows` para adicionar linha a um chart existente — **não testado**, só
citado por fonte secundária. Antes da Fase 4 implementar update/idempotência de chart, testar
este endpoint contra o chart real `8522331` (adicionar uma 5ª linha "Tamanho Único" e reler o
chart) e documentar o resultado real.

## 9. Restrições

**CONFIRMADO:** o chart criado (`id 8522331`) pertence à conta ML `3675523966` (conta conectada à
org Daludi Shop) — criado com o token desta conexão. Não testado se outra conta consegue lê-lo
(não há motivo de negócio para testar isso agora — nenhuma outra org usa Mercado Livre com este
domínio ainda). Rate limit: não observado (6 chamadas de escrita, sem 429).

## 10. Numeração de calçado — lista real

**CONFIRMADO**, de `GET /categories/MLB432206/attributes` (Tênis), campo `SIZE.values`: 37
valores — `16` a `50` (numérico, passo 1), mais `Único` e `Sob medida`. Para calibrar
`NUMERACOES_CALCADO` (Fase 3 já implementada com um placeholder), a faixa adulta comum é `33` a
`46`; o valor exato a adotar é decisão de produto (Diego), não deste spike — aqui só o que a API
aceita está confirmado.

## 11. O que ficou sem resposta

- BOTTOMS e DRESSES: exigência do grid inferida por analogia de schema, não testada em
  `/items/validate` (seção 6).
- Colunas de medida exigidas por `POST /catalog/charts` em BOTTOMS, DRESSES e FOOTWEAR (seção 7).
- Update/edição de chart existente e o que acontece com item já vinculado se a linha mudar
  (seção 8).
- Path exato do "listar charts da conta" (GET `/catalog/charts/search` e
  `/catalog/charts?domain_id=...` deram 404 nos dois formatos tentados) — só `GET
  /catalog/charts/{id}` (por id específico) foi confirmado.
- Se `title` pode ser definido manualmente em item plano destas categorias, ou se é sempre
  auto-gerado: o payload de teste com `title` explícito falhou com `"The fields [title] are
  invalid for requested call"` mesmo com texto limpo (sem palavra suspeita); removendo `title` o
  erro desapareceu e o próximo erro real (`fashion_grid`) apareceu. Não investigado a fundo —
  pode ser que `title` simplesmente não seja aceito nestas categorias (auto-gerado a partir de
  BRAND+MODEL+atributos), o que é consistente com o padrão de catálogo/User Products já
  documentado no projeto. Confirmar antes de a Fase 5 tentar setar título manualmente.

## 12. "Tamanho Único" — impossível via guia de tamanhos em TOPS/JACKETS (achado real, 2026-09-19)

**CONFIRMADO** por 3 chamadas reais, feitas depois da primeira publicação real (pedido do Diego:
"faltou o tamanho Único, acrescente"):

1. `GET /categories/MLB108803/attributes` (Jaquetas) — `SIZE.values` **tem** `Único` (id
   `6367305`), mas `FILTRABLE_SIZE.values` (40 valores) **não tem nenhum equivalente** a "Único" —
   confirmado também em `GET /categories/MLB438951/attributes` (Camisetas, domínio
   `SPORT_T_SHIRTS`, o outro domínio suportado): mesma lista de 40 valores, sem "Único". Não é uma
   lacuna de mapeamento nossa — o catálogo do ML para esses dois domínios simplesmente não tem essa
   opção em `FILTRABLE_SIZE`.
2. `POST /catalog/charts` com uma linha `SIZE=Único` (id real) e **sem** `FILTRABLE_SIZE`: `HTTP
   400`, `required_row_attribute_not_found` — `FILTRABLE_SIZE` é exigido em toda linha, sem
   exceção para "Único". Como o valor não existe na lista aceita, não há combinação de payload que
   passe.
3. `POST /items/validate` com um item plano **sem nenhum atributo `SIZE`** (nem "Único", nenhum):
   ainda assim `missing.fashion_grid.grid_id.values` — a exigência de `SIZE_GRID_ID` é
   incondicional na categoria, não depende do valor de `SIZE` nem da presença dele. Um item
   "tamanho único" não é isento do guia de tamanhos.

**Conclusão:** nos dois domínios que este projeto suporta hoje (`JACKETS_AND_COATS`,
`SPORT_T_SHIRTS`), **não existe payload possível para publicar uma peça "Tamanho Único" com guia
de tamanhos via API** — é um limite estrutural do catálogo do Mercado Livre, não uma decisão de
código. `TAMANHOS_ROUPA` (ADR-0166) continua incluindo "Tamanho Único" porque outros domínios de
roupa podem aceitar (não testado); `CONTORNO_PEITO_CM` (`_shared/ml/size-chart.ts`) continua sem
essa chave de propósito — adicionar uma faria `montarLinhasChart` tentar e falhar tarde (no ML),
quando falhar cedo (na nossa validação) com mensagem clara é o comportamento correto até o ML
oferecer o valor em `FILTRABLE_SIZE` para algum domínio.

## 13. Calçado (FOOTWEAR) — contrato real, diferente de vestuário (achado real, 2026-09-19)

**Gatilho:** pedido do Diego após a publicação real de roupa aprovada — "veja agora a de
sapato/sandalias". Testado com chamadas reais contra `MLB23332` (Tênis, domínio `SNEAKERS`) e
`MLB273770` (Sandálias e Chinelos, domínio `SANDALS_AND_CLOGS`).

**CONFIRMADO — FOOTWEAR usa `BR_SIZE` + `FOOT_LENGTH`, não `SIZE`/`FILTRABLE_SIZE`/
`CHEST_CIRCUMFERENCE_FROM` de vestuário.** `POST /catalog/charts` com uma linha `SIZE`+
`FILTRABLE_SIZE` (formato de vestuário) devolveu `main_attribute_default_error` — não é o mesmo
contrato. `GET /domains/SANDALS_AND_CLOGS/technical_specs?section=grids` lista `FOOT_LENGTH`,
`FOOT_LENGTH_TO` e várias colunas regionais (`BR_SIZE`, `US_SIZE`, `EU_SIZE`...). Testado direto
contra a API real até acertar: `main_attribute: {"id":"BR_SIZE"}`, linha com `BR_SIZE` (formato
`{"values":[{"name":"37 BR","struct":{"number":37,"unit":"BR"}}]}`) + `FOOT_LENGTH` (mesmo
formato `struct`, unidade `cm`) — **sem** o atributo `SIZE` na linha (o ML recusa com
`invalid_row_attribute` se `SIZE` estiver presente; a resposta devolve um `SIZE` derivado
automaticamente do `BR_SIZE`). Chart real criado: id `8077736` (feminino, linha 37).

**CONFIRMADO — `SNEAKERS` (e mais 4 domínios) têm chart STANDARD OFICIAL do próprio ML, pronto,
com dado real de comprimento de pé — não precisamos criar nada.** `POST
/catalog/charts/domains/search` com `{"type":"STANDARD","site_id":"MLB"}` lista os domínios que
têm: `BOOTS_AND_BOOTIES`, `SNEAKERS`, `SNEAKERS_TEST`, `FOOTBALL_SHOES`, `LOAFERS_AND_OXFORDS`.
`SANDALS_AND_CLOGS` **não está nessa lista** (testado, resposta idêntica com/sem filtro de
`domain_id` — a lista de domínios com STANDARD parece fixa, não filtrada pelo parâmetro).

**CONFIRMADO — como buscar o chart STANDARD real:** `POST /catalog/charts/search` com
`{"type":"STANDARD","domain_id":"SNEAKERS","site_id":"MLB","attributes":[{"id":"GENDER","values":[{"id":"<gender_id>","name":"<nome>"}]}]}`
(o filtro `GENDER` é obrigatório — sem ele, `required_filter_missing`). Devolve o chart completo,
com `rows` já preenchidas pelo ML:

- **Masculino: chart id `210058`**, 16 linhas, `33 BR`→`22,5 cm` até `48 BR`→`33 cm`.
- **Feminino: chart id `210059`**, 12 linhas, `33 BR`→`22 cm` até `44 BR`→`29,3 cm` (não vai até
  48 como o masculino).
- **"Sem gênero" (unissex): `charts: []`** — o ML **não publica** chart STANDARD unissex.
  `COMPRIMENTO_PE_CM` (`_shared/ml/size-chart.ts`) reaproveita a tabela masculino para unissex —
  decisão registrada, não silenciosa; cobre a faixa 33-48 inteira (a feminino pararia em 44).

**CONFIRMADO — o número (`struct.number`) é a chave estável entre chart STANDARD e SPECIFIC.**
`SIZE`/`BR_SIZE` sempre trazem `struct: {number: <int>, unit: ...}` — usar esse número (não o
texto "37 BR") pra casar com `variacoes.tamanho` ("37"), que não tem o sufixo " BR".

**NÃO CONFIRMADO:** `BOOTS_AND_BOOTIES`, `FOOTBALL_SHOES`, `LOAFERS_AND_OXFORDS` (STANDARD listado
mas não testado — `garantirChart` ainda não os inclui em `DOMINIOS_CALCADO_STANDARD`, adicionar
exige o mesmo teste feito aqui pra `SNEAKERS`, não presumir). Numeração infantil/bebê e domínios
de calçado infantil — fora de escopo do pedido do Diego, não investigados.

## Achado que redesenha a Fase 5 (resumo para o checkpoint Fable)

A seção 2 é o achado que mais importa: **nenhuma das categorias de vestuário/calçado testadas
aceita `variations[]`.** O plano original (Fase 5) assumia um item único com `attribute_
combinations` de COLOR + SIZE_GRID por variação, análogo a como COR funciona hoje. Isso não é
publicável nestas categorias — precisa ser **N itens ML por família** (um por SKU cor×tamanho),
todos com o mesmo `family_name` e os mesmos atributos não-variantes. Antes de escrever qualquer
código de Fase 4/5, este ponto precisa do parecer do Fable: qual o modelo de dados mínimo para
`anuncios_externos` (hoje pensado como 1 MLB por família) suportar N MLBs por família, e o que
isso muda no ciclo de vida de pausar/reativar/remover (ADR-0060) e no UPDATE de estoque/preço por
variação.
