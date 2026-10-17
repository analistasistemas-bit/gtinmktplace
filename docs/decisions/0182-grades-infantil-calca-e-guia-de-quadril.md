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
