# ADR-0182 — Grades Infantil e Calça, guia de quadril e kits sem guia

**Status:** Aceito
**Data:** 2026-10-16
**Decisor:** Diego
**Relacionado:** [ADR-0166](0166-tipo-de-produto-por-organizacao.md) (tipo de produto/grade),
[ADR-0167](0167-guia-de-tamanhos-gerenciado-via-api.md) (guia de tamanhos via API),
[ADR-0043](0043-fluxo-canonico-de-migrations.md) (migrations); base factual:
[Spike 056](../spikes/056-guia-tamanhos-short-calca-conjunto.md); design:
[spec](../superpowers/specs/2026-10-16-grades-infantil-calca-design.md); plano:
[plano](../superpowers/plans/2026-10-16-grades-infantil-calca.md).

## Contexto

A entrada da NF 1051 (J E Araujo) trouxe short masculino P/M/G/GG (já cadastrado), conjunto
infantil 2–16 (bloqueado no cadastro) e, nas próximas compras, calças 34–48. Hoje o cadastro só
oferece P/M/G/GG para roupa e a publicação só conhece `JACKETS_AND_COATS` e `SPORT_T_SHIRTS`
(chart por contorno do peito).

O Spike 056 (chamadas reais ao ML) confirmou:

- `SHORTS` e `PANTS` exigem `SIZE_GRID_ID`; não existe chart STANDARD do ML; colunas obrigatórias
  da linha: `SIZE` + `FILTRABLE_SIZE` + `HIP_CIRCUMFERENCE_FROM` (`"<n> cm"`).
- `FILTRABLE_SIZE` adulto é o mesmo texto do `SIZE`; infantil é `"<n> anos"`.
- `CLOTHING_LOTS` (Kits de Conjuntos de Roupa, `MLB271219`) não tem guia de tamanhos
  (`Domain MLB-CLOTHING_LOTS not active`); o tamanho vai em `CLOTHING_LOT_SIZE` (string livre) e o
  item plano valida sem grid.
- `tipoDaGrade` assume listas disjuntas, mas `34…46` da calça colide com a numeração de calçado.

## Decisão

**D1 — Três grades de roupa, escolhidas como grade pronta.** Letras `P, M, G, GG` · Infantil
`2, 4, 6, 8, 10, 12, 14, 16` · Calça `34, 36, 38, 40, 42, 44, 46, 48`. Calçado inalterado. A grade
nunca mistura tamanhos de duas listas na mesma família. Tipo de produto não muda: as três são
`roupa` (ADR-0166); nenhum valor novo em `tipos_produto_habilitados`.

**D2 — A família grava a grade.** Coluna nova `familias.grade_tamanho`
(`'letras'|'infantil'|'calca'|'calcado'`, nullable, CHECK), via `supabase migration new` +
`supabase db push` (ADR-0043). Quem precisa da grade (estender grade, `adicionar-variacoes-familia`,
ordenação, publicação) lê da família. `null` = família antiga, segue a inferência legada, que
reconhece **apenas Letras e Calçado** (hoje as únicas grades existentes, sem ambiguidade; sem
backfill, INV-1 do ADR-0166). O backend aceita payload legado sem `gradeTamanho` inferindo somente
Letras/Calçado; Infantil e Calça exigem a grade explícita. Calça 34–46 nunca é inferida como
calçado. Ao clonar família (nova versão em `adicionar-variacoes`/UPDATE), `grade_tamanho` é copiada.

**D3 — Gêneros infantis.** Valores novos de `genero`: `meninos`, `meninas`, `sem_genero_infantil`
(amplia os CHECKs de `familias.genero` e `ml_size_charts.genero` e o `GENDER_VALUE`). Adulto
continua `masculino|feminino|unissex`. Gênero e grade são coerentes: Infantil ⇔ gênero infantil;
`cadastrar-produto` recusa combinação incoerente (400, nunca grava), inclusive por payload forjado.

| Gênero | Atributo `GENDER` no ML | value_id |
|---|---|---|
| masculino | Masculino | `339666` |
| feminino | Feminino | `339665` |
| unissex | Sem gênero | `110461` |
| meninos | Meninos | `339667` |
| meninas | Meninas | `339668` |
| sem_genero_infantil | Sem gênero infantil | `19159491` |

Os ids de Meninas e Sem gênero infantil foram lidos de `GET /categories/MLB188064/attributes` e
`MLB271219` (registrados no Spike 056 §2).

**D4 — Coluna de medida por domínio.** `JACKETS_AND_COATS`/`SPORT_T_SHIRTS` → peito (atual,
intacto, mesma chave de cache). `SHORTS`/`PANTS` → quadril (`HIP_CIRCUMFERENCE_FROM`, tabela por
gênero). `CLOTHING_LOTS` → sem chart. Domínio fora da lista segue falhando alto com a mensagem
atual.

**D5 — Tabelas de quadril padrão** (medida do corpo, piso da faixa, mesma convenção do peito;
decisão do Diego em 2026-10-16; sem padrão oficial brasileiro aberto — Spike 056 §7). Ficam em
módulo folha de `_shared` (padrão de `medidas-valores.ts`).

| Infantil (meninos, meninas, sem gênero infantil) | 2 | 4 | 6 | 8 | 10 | 12 | 14 | 16 |
|---|---|---|---|---|---|---|---|---|
| Quadril (cm) | 56 | 62 | 66 | 71 | 76 | 81 | 87 | 92 |

| Calça | 34 | 36 | 38 | 40 | 42 | 44 | 46 | 48 |
|---|---|---|---|---|---|---|---|---|
| Masculino e Unissex (cm) | 88 | 92 | 96 | 100 | 104 | 108 | 112 | 116 |
| Feminino (cm) | 90 | 94 | 98 | 102 | 106 | 110 | 114 | 118 |

| Letras | P | M | G | GG |
|---|---|---|---|---|
| Masculino e Unissex (cm) | 96 | 100 | 104 | 108 |
| Feminino (cm) | 94 | 102 | 110 | 118 |

Tamanho fora da tabela falha alto; nunca há quadril defaultado ou estimado.

**D6 — Superset do chart (ADR-0167 D2) e cache.** O chart de quadril é sempre o superset da
**grade** naquele gênero, nunca só os tamanhos da família: Letras = P/M/G/GG (4 linhas), Calça =
34–48 (8 linhas), Infantil = 2–16 (8 linhas), cada lista cruzada com o `SIZE` da categoria e com
`tabelaQuadril(genero)` para o cm. Chave de cache `(connection_id, domain_id, genero,
grade_tamanho)`. Colunas: `SIZE` + `FILTRABLE_SIZE` + `HIP_CIRCUMFERENCE_FROM` (`"<n> cm"`);
`FILTRABLE_SIZE` infantil = `"<n> anos"`, adulto = mesmo texto do tamanho. O nome do chart
normaliza o gênero (`_` → espaço, ex.: `sem genero infantil`). Peito (JACKETS_AND_COATS /
SPORT_T_SHIRTS) e calçado não mudam de comportamento; só passam a ser cacheados com a sua grade
(`letras` / `calcado`).

*Emenda 2026-10-16 (fallback previsto acionado).* A versão original juntava Letras + Calça num
chart adulto de 12 linhas com a chave `(connection_id, domain_id, genero)`. No ensaio real o ML
recusou esse chart em `POST /catalog/charts` com `value_is_not_the_same_type: "All FILTRABLE_SIZE
values must be the same type, only numbers or alphanumeric"` (Spike 056 §8). Os charts infantis
foram criados sem erro. Migration `20261017013349_adr182_ml_size_charts_por_grade`: coluna
`grade_tamanho` (backfill: SNEAKERS/SANDALS_AND_CLOGS → `calcado`, gênero infantil → `infantil`,
resto → `letras`), `not null` sem default, CHECK nas 4 grades e PK nas 4 colunas.

**D7 — CLOTHING_LOTS publica sem guia.** Não chama `garantirChart`; o item leva
`CLOTHING_LOT_SIZE = <tamanho>` e não leva `SIZE`/`SIZE_GRID_*`. `CLOTHING_LOT_SIZE` é atributo
**por SKU**: nunca herdado da ficha da família ou de irmão — cada SKU sai com exatamente um, o seu.
`montarPayloadItem` (hoje exige grid quando há tamanho) ganha esse ramo explícito por domínio.

**D8 — Validações adicionadas pela revisão do plano.**
1. Checagem grade × domínio **antes** do chart/publicação (`dominioAceitaGrade`): calça em domínio
   de calçado (`SNEAKERS`/`SANDALS_AND_CLOGS`) ou calçado em `PANTS` recusa antes de criar chart ou
   publicar; Infantil/Calça em domínio de chart por peito falha alto (fora do superset).
2. Retry/idempotência compara `grade_tamanho` e `genero` além do restante: divergência devolve 409.

*Emenda 2026-10-17 (moda praia sem guia).* O conjunto infantil de proteção UV (família `00000043`)
travou com `domínio BABY_SWIMWEAR não confirmado`. Medido na API real do ML:
`MLB39961` (Bebês › Moda Praia, `BABY_SWIMWEAR`) fixa `GENDER = Bebês` e recusa "Infantil" no título
(`invalid.title.gender`, inclusive com o título exato de um concorrente antigo). `MLB430391` (Moda
Praia, `SWIMWEAR`) não tem `SIZE_GRID_ID` no schema, tem `SWIMWEAR_TYPE = Conjunto infantil`
(obrigatório), aceita `GENDER = Meninas` e `SIZE` cru `2`/`4`/`8`: `/items/validate` passou (só o
aviso de envio `me1`). Decisão do Diego: opção A, `MLB430391`. `SWIMWEAR` entra em
`DOMINIOS_SEM_GUIA`, que vira o mapa `ATRIBUTO_TAMANHO_SEM_GUIA` (domínio → atributo do tamanho):
`CLOTHING_LOTS → CLOTHING_LOT_SIZE`, `SWIMWEAR → SIZE`. `garantirChart` devolve `{ semGuia }` em vez
de `null`; o SKU leva o tamanho cru no atributo indicado, sem `SIZE_GRID_*`. `BABY_SWIMWEAR` segue
fora (falha alto).

*Emenda 2026-10-18 (foto da grade de cor única).* A família `00000064` (Estampa Sereia, 4/6/8/10,
só capa) acusava "sem foto" nas 4 variações. Grade de 1 cor só difere no tamanho, e Legacy e UP já
montam a galeria de cada SKU a partir da capa (`ordenarFotosVariacao`, `capa ?? propria`).
`familiaExigeFotoPorVariacao` (`src/lib/publicavel.ts`) passa a dispensar a foto por variação em
CREATE + `tipoAviamento='outro'` + 1 cor entre as incluídas + capa. Com 2+ cores, sem capa, em
UPDATE ou em aviamento, a exigência continua (main `c3a02c13`).

*Emenda 2026-10-18 (categoria da grade).* Na mesma família, o `domain_discovery` real devolveu
`[MLB39961 BABY_SWIMWEAR, MLB271219 CLOTHING_LOTS, MLB430391 SWIMWEAR]` e o topo ficou, embora a
publicação da grade recuse `BABY_SWIMWEAR` (`garantirChart`). Família com `grade_tamanho` passa a
filtrar os candidatos em `escolherEntreCandidatos` (`_shared/categoria/resolver.ts`) pelos mesmos
critérios da publicação, `DOMINIOS_SUPORTADOS` e `dominioAceitaGrade`; o desempate por IA só vê os
publicáveis e, sem nenhum, a categoria fica manual. Não é o veto por "mesmo domínio" rejeitado em
17/10: a restrição é o que a publicação aceita. Grade inferida (sem `grade_tamanho`) não muda.

## Consequências

- Nenhuma família ou anúncio existente é alterado ou reprocessado (jaquetas, camisetas, calçados,
  o short cadastrado). O short da NF 1051 (`MLB278065`, categoria de bebê) exige que o Diego troque
  a categoria para `MLB188064` pela tela antes de publicar — ação operacional, não de código.
- Org sem tipo habilitado não muda de comportamento (INV-1 do ADR-0166).
- Os 2 charts de teste do Spike 056 (`10159973`, `9699362`) permanecem; não são apagados.
- Ampliar grades (bebê, ímpares, 50+, PP/XG) é editar uma lista. Medida real por fornecedor e
  importação de tamanho/gênero por planilha seguem fora de escopo (ADR-0166 D4).

## Como reverter

Remover `familias.grade_tamanho`, restringir os CHECKs de `genero` aos três valores adultos e
remover os ramos `SHORTS`/`PANTS`/`CLOTHING_LOTS` de `size-chart.ts`/`montarPayloadItem`. Não
destrutivo: nenhuma família existente usa os valores novos antes do deploy. Migration antiga nunca é
editada (ADR-0043): a reversão é uma migration nova.

## Emenda (2026-10-18): GGG na grade Letras

`TAMANHOS_ROUPA` ganha `GGG` no fim da lista (P, M, G, GG, GGG) — pedido do Diego para cadastrar
camisa com extra G. Vale para cadastro, estoque e whitelist da edge `cadastrar-produto`.

**Guia de tamanhos (peito: JACKETS_AND_COATS, SPORT_T_SHIRTS).** O ML não tem `GGG` em `SIZE` nem
em `FILTRABLE_SIZE` (consultado em `MLB31447`, `MLB424836`, `MLB108803`: só `XG`, `XGG`, `EGG`,
`G1`…). Decisão do Diego: GGG = equivalência `FILTRABLE_SIZE` **XG** com **120 cm** de peito
(passo de 8 cm da tabela). `POST /catalog/charts` real (chart `10367347`, SPORT_T_SHIRTS feminino,
2026-10-18) aceitou a linha com `SIZE` "GGG" **sem value_id** (SIZE é string livre).

**Rotação do cache (ADR-0167 D4).** Chart em `ml_size_charts` que não cobre um tamanho pedido não
lança mais: `garantirChart` cria um chart novo com o superset atual e faz upsert na chave
(conexão, domínio, gênero, grade). O chart antigo segue válido nos itens já publicados. Os caches
Letras existentes (P–GG) rotacionam na primeira publicação que pedir GGG.

Fora de escopo: GGG em SHORTS/PANTS (quadril) — `tabelaQuadril` não tem GGG, segue falhando alto.

## Emenda (2026-10-18): camiseta e camisa (T_SHIRTS, SHIRTS) na grade Letras

A família `00000069` (camisa masculina, Letras) ficou com "Categoria indefinida". O
`domain_discovery` real devolveu só `MLB31447` (`T_SHIRTS`, Camisetas e Regatas) e categorias
`SHIRTS` (`MLB107292` Camisas e afins), e nenhum dos dois estava em `DOMINIOS_SUPORTADOS`: o filtro
da emenda "categoria da grade" descartou tudo. Escolher a categoria à mão também não resolvia, porque
`garantirChart` recusaria o domínio na publicação.

Medido na API real (conta Daludi Shop, 2026-10-18): `POST /catalog/charts` com linha só de `SIZE`
devolve `required_row_attribute_not_found` para **`FILTRABLE_SIZE`** e **`CHEST_CIRCUMFERENCE_FROM`**,
idêntico em `T_SHIRTS` e `SHIRTS`. São as mesmas colunas de `SPORT_T_SHIRTS` (Spike 051 §7).
`MLB31447` e `MLB107292` têm `P`/`M`/`G`/`GG` em `SIZE` e `XG` em `FILTRABLE_SIZE`.

Decisão: `T_SHIRTS` e `SHIRTS` entram em `DOMINIOS_VESTUARIO` (chart SPECIFIC por peito,
`CONTORNO_PEITO_CM`, mesmo caminho de `SPORT_T_SHIRTS`). Só na grade Letras; Infantil e Calça
seguem recusando esses domínios (`dominioAceitaGrade`). `FOOTBALL_SHIRTS` e demais camisas
esportivas não foram medidos e continuam fora.

## Emenda (2026-10-18): roupas e calçados A–D

Pedido do Diego: o PubliAI tem que publicar qualquer roupa. Auditoria da árvore `MLB1430`
(145 folhas): só 10 domínios publicavam. Colunas medidas por `POST /catalog/charts` real com linha
só de `SIZE` (conta Daludi Shop, 2026-10-18; 400 sem criar nada):

- **A, peito** (`FILTRABLE_SIZE` + `CHEST_CIRCUMFERENCE_FROM`) → `DOMINIOS_VESTUARIO`.
- **B, quadril** (`FILTRABLE_SIZE` + `HIP_CIRCUMFERENCE_FROM`) → `DOMINIOS_QUADRIL`.
- **C, calçado** (`BR_SIZE` + `FOOT_LENGTH`) → `DOMINIOS_CALCADO_SPECIFIC`, todos SPECIFIC com
  `COMPRIMENTO_PE_CM` (a mesma tabela da sandália); não dependem de STANDARD por gênero.
- **D, sem `SIZE_GRID_ID`** no schema → `ATRIBUTO_TAMANHO_SEM_GUIA` = `SIZE` cru, como `SWIMWEAR`.

Listas exatas: `_shared/ml/size-chart.ts`. Cada domínio passou por `scripts/ops/ensaio-grade-ml.ts`
(chart real + `/items/validate` por tamanho, nas pontas de cada grade aceita); domínio reprovado
ficou fora.

**Gênero × categoria (revisão Codex).** A grade valida gênero × grade, não gênero × domínio (cueca
não aceita Feminino). `garantirChart` lê o `GENDER` do schema da categoria e recusa, com mensagem,
o gênero que ela não lista. Schema indisponível ou sem `GENDER` não bloqueia: o ML segue como juiz.

**Fora, de propósito:** domínios de bebê (`BABY_*`, `BABIES_FOOTWEAR`; tamanhos de bebê não existem
nas grades), `BABY_SWIMWEAR` (emenda 17/10), "Outros" (`CLOTHING`, `SPORTSWEAR`, genéricos), e
`BRAS`/`PAJAMAS` (exigem `BUST_CIRCUMFERENCE_FROM`, sem tabela de busto). Peito infantil também não
tem tabela: grade Infantil segue só em quadril e sem guia.

**Ensaio (2026-10-18):** 93 casos + amostra masculina; 87 OK (A com P–GGG; C com 35/40/44 nos
gêneros aceitos; D em Letras P/GGG, Calça 38/48 e Infantil 4/16). As 6 recusas são tamanhos que a
categoria do ML não tem e falham antes de publicar, com mensagem: saia, calcinha e cueca sem a
grade Calça; calcinha e cueca sem Infantil; legging sem 34.

**Limites herdados:** GGG não existe na tabela de quadril (B em Letras vai até GG); calçado recusa
pares (`33/34`) e feminino 45/46. Risco preexistente, não alterado aqui: no UPDATE/reposição UP o
`GENDER` da família vai aos filhos sem passar por `garantirChart`.
