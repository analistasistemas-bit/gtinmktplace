# Grades de tamanho Infantil e Calça (+ short, calça e conjunto no ML) — design

**Data:** 2026-10-16
**Origem:** entrada da NF 1051 (J E Araujo): short masculino P/M/G/GG já cadastrado; conjunto
infantil 2–16 bloqueado no cadastro; calças 34–48 nas próximas compras.
**Base factual:** [Spike 056](../../spikes/056-guia-tamanhos-short-calca-conjunto.md) (contrato
real do ML), ADR-0166 (tipo de produto/grade), ADR-0167 (guia de tamanhos via API).

## 1. Intenção

O Diego precisa cadastrar **e publicar no Mercado Livre** roupas com numeração infantil e de
calça, do mesmo jeito que já faz com P/M/G/GG: escolhe uma grade pronta, marca os tamanhos, e
na publicação o app cria a guia de tamanhos sozinho — sem Seller Central, sem digitar medida.

Sucesso = o conjunto infantil (2–16) e as calças (34–48) cadastram pela tela de cadastro em grade
e publicam; o short já cadastrado (P/M/G/GG, masculino) passa a publicar sem recadastro.

## 2. Objetivos

1. **Três grades de roupa** no cadastro em grade, escolhidas como grade pronta (decisão do
   Diego): **Letras** P, M, G, GG (atual) · **Infantil** 2, 4, 6, 8, 10, 12, 14, 16 ·
   **Calça** 34, 36, 38, 40, 42, 44, 46, 48. Calçado continua igual.
2. **Gênero infantil**: com a grade Infantil, o gênero oferecido é Meninos / Meninas / Sem gênero
   infantil (valores do ML, Spike 056 §2). Grades adultas continuam Masculino / Feminino / Unissex.
3. **Publicação no ML** em três domínios novos:
   - `SHORTS` e `PANTS`: guia de tamanhos criada via API com coluna de **contorno do quadril**
     (`HIP_CIRCUMFERENCE_FROM`), para as três grades e todos os gêneros.
   - `CLOTHING_LOTS` (Kits de Conjuntos de Roupa): **publica sem guia de tamanhos** — o domínio
     não tem guia; o tamanho vai em `CLOTHING_LOT_SIZE`.
4. O short já cadastrado publica após o deploy, sem nenhuma ação de dados.

## 3. Não-objetivos

- Importação por planilha de tamanho/gênero (continua futura, ADR-0166 D4).
- Grades infantil/calça em jaqueta, camiseta ou outros domínios de chart por peito: se alguém
  tentar, falha alto com a mensagem atual de "fora do superset". Não é bug.
- Bebê (meses), tamanhos ímpares, 50+, PP/XG. Ampliar é editar uma lista depois.
- Medida real por produto/fornecedor. A tabela é padrão e fixa (decisão do Diego, como ADR-0167 D3).
- Apagar os 2 charts de teste do Spike 056 (`10159973`, `9699362`).

## 4. Anti-objetivos (falha mesmo que "funcione")

- Uma calça 34–46 tratada como calçado (ou vice-versa) em qualquer tela ou edge.
- Alterar, reprocessar ou reclassificar famílias/anúncios já existentes (jaquetas, camisetas,
  calçados publicados, o short cadastrado).
- Quadril defaultado/estimado em silêncio para tamanho fora da tabela: falha alto.
- Grade misturando tamanhos de duas grades na mesma família.
- Org sem tipo habilitado mudando de comportamento (ADR-0166 INV-1).

## 5. Decisões já tomadas

### 5.1 Pelo Diego

- Grade pronta (não tamanho a tamanho, não texto livre).
- Publicar no ML já, não só estoque.
- Tabelas de quadril padrão, **medida do corpo, piso da faixa** (mesma convenção do peito), aprovadas
  em 2026-10-16:

| Infantil (Meninos, Meninas, Sem gênero infantil) | 2 | 4 | 6 | 8 | 10 | 12 | 14 | 16 |
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

Essas tabelas são o **superset** do chart de quadril (ADR-0167 D2) — nunca só os tamanhos da
família. Ficam em módulo folha de `_shared` (padrão de `medidas-valores.ts`), lidas pelo backend.

### 5.2 Fatos do ML que o design segue (Spike 056)

- `SHORTS`/`PANTS` exigem `SIZE_GRID_ID`; não há chart STANDARD; colunas obrigatórias da linha:
  `SIZE` + `FILTRABLE_SIZE` + `HIP_CIRCUMFERENCE_FROM` (`"<n> cm"`).
- `FILTRABLE_SIZE`: adulto = mesmo texto do `SIZE` (`"40"`, `"P"`); infantil = `"<n> anos"`.
  Ids de `SIZE`/`FILTRABLE_SIZE` vêm do schema da categoria (como já faz `criarChartVestuario`).
- `CLOTHING_LOTS`: sem chart (`Domain … not active`), item plano User Products (variations[]
  recusado), tamanho em `CLOTHING_LOT_SIZE` (string livre). Validado sem grid.
- GENDER `Meninos` = `339667` (lido na resposta do chart). Ids de `Meninas` e
  `Sem gênero infantil` **ainda não confirmados** — ler da categoria antes de codificar
  (nunca adivinhar).

### 5.3 Calls de arquitetura (minhas — o Diego pode contestar)

- **A família grava a grade.** Coluna nova `familias.grade_tamanho` (`'letras'|'infantil'|'calca'|'calcado'`,
  nullable, CHECK). Motivo: `tipoDaGrade` infere o tipo pelos tamanhos e depende de listas
  disjuntas; `34–46` de calça colide com `NUMERACOES_CALCADO`. Com a coluna, quem precisa saber a
  grade (estender grade, edge `adicionar-variacoes-familia`, ordenação) lê da família.
  Família antiga (`null`) segue a inferência atual — hoje só existem Letras e Calçado, sem
  ambiguidade, então não há backfill (INV-1). Migration via `supabase migration new` (ADR-0043).
- **Gênero infantil como valores novos de `genero`**: `meninos`, `meninas`, `sem_genero_infantil`.
  Amplia os CHECKs de `familias.genero` e `ml_size_charts.genero` e o `GENDER_VALUE`. Gênero e
  grade são coerentes: Infantil ⇔ gênero infantil; a edge `cadastrar-produto` recusa combinação
  incoerente.
- **Tipo de produto não muda**: as três grades são de `roupa`. Org com `roupa` habilitado ganha
  as três; nenhum tipo novo em `tipos_produto_habilitados`.
- **Coluna de medida por domínio**: `JACKETS_AND_COATS`/`SPORT_T_SHIRTS` → peito (atual, intacto);
  `SHORTS`/`PANTS` → quadril (tabela por gênero). `CLOTHING_LOTS` → sem chart.
- **Cache de chart**: chave `(connection_id, domain_id, genero, grade_tamanho)` — atualizado em
  2026-10-16 após o ensaio real: o ML recusa chart com Letras + Calça misturadas
  (`All FILTRABLE_SIZE values must be the same type, only numbers or alphanumeric`). Superset do
  chart de quadril = tamanhos da própria grade (Letras 4, Calça 8, Infantil 8).
- **ADR**: decisão nova e estrutural → **ADR-0182** (ou o próximo livre após `git fetch`) escrito
  antes do código, referenciando 0166/0167 e o Spike 056; emenda curta em 0166/0167 apontando para ele.

## 6. Comportamento esperado

**Cadastro em grade** (`dialog-cadastro-grade.tsx`): com tipo Roupa, o operador escolhe a grade
(Letras / Infantil / Calça) antes de marcar tamanhos; os tamanhos da grade aparecem como hoje
aparecem P/M/G/GG. Trocar de grade com linhas já geradas pede confirmação e limpa a grade (mesmo
padrão de trocar roupa↔calçado, `:304`). O select de gênero mostra as opções da grade escolhida;
trocar de grade adulta↔infantil limpa o gênero.

**Estender grade** (`dialog-estender-grade.tsx` + edge `adicionar-variacoes-familia`): oferece só
os tamanhos da grade da família; não permite mudar de grade.

**Publicação** (`publish-familia-ml` → `publicarFamiliaUP`; `update-familia-ml`/reconciliação →
`atualizarFamiliaUP`):
- SHORTS/PANTS: `garantirChart` cria (ou reusa do cache) o chart de quadril e o item leva
  `SIZE` + `SIZE_GRID_ID` + `SIZE_GRID_ROW_ID` como nos domínios atuais.
- CLOTHING_LOTS: não chama `garantirChart`; o item leva `CLOTHING_LOT_SIZE = <tamanho>` e não leva
  `SIZE`/`SIZE_GRID_*`. `montarPayloadItem` hoje exige grid quando há tamanho
  (`_shared/ml/publicar.ts:191-196`) — ganha esse ramo explícito por domínio.
- Domínio fora da lista continua falhando alto com a mensagem atual.

**Ordenação** (`rotulo-variacao.ts`, `ordenarEixos`): ordem canônica da grade da família
(2<4<…<16; 34<…<48; P<M<G<GG).

**Categoria**: vem do resolver atual (`_shared/categoria/resolver.ts`: override → domain_discovery
→ desempate LLM → manual). `domain_discovery` devolve só `MLB271219`/`CLOTHING_LOTS` para
"conjunto infantil …" (Spike 056 §1), então o conjunto deve chegar lá sem trabalho novo — o builder
confere com o nome real do produto; se não chegar, o operador corrige pela troca manual de
categoria que já existe. Nenhum mapeamento novo de categoria entra no escopo.

**Atributos no CLOTHING_LOTS**: o ramo novo reaproveita o caminho UP atual — `GENDER` de
`familias.genero` (via `GENDER_VALUE`), `COLOR` da variação, demais obrigatórios da categoria pelo
preenchimento de atributos já existente. Só muda: sem `SIZE`/`SIZE_GRID_*`, com `CLOTHING_LOT_SIZE`.

**Famílias existentes** (levantamento 2026-10-16): as famílias com tamanho publicadas estão em
MLB270221, MLB108803 e MLB424836 (Letras, domínios de peito); nenhuma em SHORTS/PANTS — esses
domínios hoje falham antes de publicar. O update delas não muda (chart de peito intacto, chave de
cache igual). Não há anúncio real afetado.

**Short da NF 1051** (`pronto`, Letras, masculino): foi classificado em `MLB278065`
(Bebês › Roupas de Bebê › Shorts — domínio SHORTS, mas categoria de bebê). Antes de publicar, o
Diego troca a categoria para `MLB188064` (Bermudas e Shorts) pela tela. Não é ação de código.

## 7. Validação exigida

- Testes unitários: listas e tabelas; coerência grade×gênero (recusa); chart de quadril monta as 3
  colunas com `"N anos"` no infantil; CLOTHING_LOTS sem grid; inferência legada intacta para
  famílias `null`; calça 34–46 nunca vira calçado.
- `/items/validate` real (não cria item) para SHORTS infantil, PANTS adulto e CLOTHING_LOTS com o
  payload que o código gera — o Spike 056 já provou o formato manual.
- Fim de branch: validação em runtime real (ultraqa + browser) do cadastro do conjunto infantil.
- Antes de publicar qualquer anúncio real: revisão humana do Diego (regra do projeto).

## 8. Fica a cargo do builder

- Nome exato da coluna/tipos TS e onde centralizar a lista de grades (fonte única em
  `tipos-produto-valores.ts`, regra R7).
- Ler e registrar os `value_id` de `Meninas` e `Sem gênero infantil` (GET de categoria) antes de
  codificar.
- ~~Confirmar se o ML aceita chart misto~~ — confirmado em 2026-10-16 que recusa; cache separado
  por grade (ver §5.3).
- Mapear a categoria do short já cadastrado para `SHORTS` (deve vir do classificador atual; só
  conferir).
- Unificar ou não os tipos `Genero` duplicados (7 lugares, mapeados no levantamento) — mínimo é
  todos aceitarem os 3 valores novos.
- Docs vivos (checklist `docs-update-checklist`) e Graphify ao fim.
