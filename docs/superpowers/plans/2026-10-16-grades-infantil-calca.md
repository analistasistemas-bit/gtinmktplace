# Grades Infantil e Calça Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cadastrar e publicar no ML roupas nas grades Infantil (2–16) e Calça (34–48), além de
Letras (P–GG), incluindo short/calça (guia de quadril) e conjunto infantil (sem guia).

**Architecture:** A família passa a gravar sua grade (`familias.grade_tamanho`); a fonte única
`_shared/produto/tipos-produto-valores.ts` define grades, tamanhos e gêneros (adulto/infantil) e é
lida pelo front (Vite) e pelas edges (Deno). `_shared/ml/size-chart.ts` ganha a coluna de quadril
para `SHORTS`/`PANTS` e devolve `null` para `CLOTHING_LOTS` (domínio sem guia), caso em que o
payload leva `CLOTHING_LOT_SIZE` em vez de `SIZE`/`SIZE_GRID_*`.

**Tech Stack:** React + TS (Vite), Supabase Edge Functions (Deno), Postgres migrations, vitest.

**Spec:** `docs/superpowers/specs/2026-10-16-grades-infantil-calca-design.md` (contrato do ML em
`docs/spikes/056-guia-tamanhos-short-calca-conjunto.md`).

## Global Constraints

- Tamanhos: Letras `['P','M','G','GG']` · Infantil `['2','4','6','8','10','12','14','16']` · Calça `['34','36','38','40','42','44','46','48']`.
- Gêneros adulto `masculino|feminino|unissex`; infantil `meninos|meninas|sem_genero_infantil`.
- GENDER ML: masculino `339666` "Masculino" · feminino `339665` "Feminino" · unissex `110461` "Sem gênero" · meninos `339667` "Meninos" · meninas `339668` "Meninas" · sem_genero_infantil `19159491` "Sem gênero infantil".
- Quadril (cm, corpo, piso): Infantil 2→56, 4→62, 6→66, 8→71, 10→76, 12→81, 14→87, 16→92 (todos os gêneros infantis). Calça masculino/unissex 34→88, 36→92, 38→96, 40→100, 42→104, 44→108, 46→112, 48→116; feminino 34→90, 36→94, 38→98, 40→102, 42→106, 44→110, 46→114, 48→118. Letras masculino/unissex P→96, M→100, G→104, GG→108; feminino P→94, M→102, G→110, GG→118.
- Chart de quadril: colunas `SIZE` + `FILTRABLE_SIZE` + `HIP_CIRCUMFERENCE_FROM` (`"<n> cm"`); `FILTRABLE_SIZE` infantil = `"<n> anos"`, adulto = mesmo texto do tamanho.
- Domínios: peito `JACKETS_AND_COATS`, `SPORT_T_SHIRTS` (intactos) · quadril `SHORTS`, `PANTS` · sem guia `CLOTHING_LOTS` (tamanho em `CLOTHING_LOT_SIZE`).
- Migrations só `supabase migration new` + `supabase db push` (ADR-0043); validar SQL sem Docker com `scripts/teste-sql-desfeito.py`.
- Nenhuma família/anúncio existente é alterado; `grade_tamanho` null = inferência legada (só Letras/Calçado). Org sem tipo habilitado: nada muda (INV-1).
- Git em worktree: `/usr/bin/git` simples; commit com `-F <arquivo>`; mensagem termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Portão de pré-push: `pnpm preflight`.

## Review Focus

1. Calça 34–46 numa org com roupa **e** calçado: nunca inferida como calçado (front estender-grade, edge adicionar-variacoes) — teste em Task 2 e Task 6.
2. Família nova versão (`clonarFamilia` em adicionar-variacoes / UPDATE) perde `grade_tamanho` → calça vira ambígua — teste em Task 6.
3. Gênero incoerente com a grade vindo por payload forjado (ex.: grade Infantil + `masculino`, ou Calça + `meninos`) → 400, nunca grava — teste em Task 4.
4. Cache `ml_size_charts` de jaqueta/camiseta existente continua servindo sem recriar chart e sem trocar coluna (peito) — teste em Task 5.
5. Ordenação de calçado (33 antes de 34; pares depois dos isolados) não muda ao entrar a lista de calça — teste em Task 7.
6. (Codex r1) Calça classificada em domínio de calçado (`SNEAKERS`/`SANDALS_AND_CLOGS`) ou calçado em `PANTS`: recusa ANTES de chart/publicação — teste em Task 5/6.
7. (Codex r1) `CLOTHING_LOT_SIZE` herdado da ficha da família/irmão: cada SKU sai com exatamente um, o seu — teste em Task 6.

---

### Task 1: ADR-0182 e registro dos ids

**Files:**
- Create: `docs/decisions/0182-grades-infantil-calca-e-guia-de-quadril.md` (confirmar número livre com `/usr/bin/git fetch` + `ls docs/decisions`; se 0182 já existir na main, usar o próximo)
- Modify: `docs/decisions/0166-tipo-de-produto-por-organizacao.md`, `docs/decisions/0167-guia-de-tamanhos-gerenciado-via-api.md` (emenda curta "2026-10-16 → ver ADR-0182"), `docs/decisions/README.md` (índice), `docs/spikes/056-guia-tamanhos-short-calca-conjunto.md` §2 (ids Meninas `339668`, Sem gênero infantil `19159491`, lidos de `GET /categories/MLB188064/attributes` e `MLB271219`)

- [ ] **Step 1:** Escrever o ADR com as decisões da spec §5.1/§5.3 (grade gravada na família, gêneros infantis, quadril por domínio, CLOTHING_LOTS sem guia, tabelas de quadril, superset Letras+Calça por gênero adulto).
- [ ] **Step 2:** `pnpm docs:links` → sem link quebrado.
- [ ] **Step 3:** Commit `docs(adr-0182): grades Infantil/Calça e guia de quadril`.

### Task 2: Fonte única de grades, gêneros e quadril

**Files:**
- Modify: `supabase/functions/_shared/produto/tipos-produto-valores.ts`
- Modify: `supabase/functions/_shared/ml/medidas-valores.ts`
- Test: `supabase/functions/_shared/produto/__tests__/grades.test.ts` (novo), `supabase/functions/_shared/produto/__tests__/tipo-produto.test.ts`

**Interfaces — Produces:**
- `type GradeTamanho = 'letras' | 'infantil' | 'calca' | 'calcado'`; `GRADES_VALIDAS: readonly GradeTamanho[]`
- `TAMANHOS_INFANTIL`, `TAMANHOS_CALCA` (`as const`, valores das Global Constraints)
- `GRADES_DO_TIPO: Record<TipoProduto, readonly GradeTamanho[]>` = `{ roupa: ['letras','infantil','calca'], calcado: ['calcado'] }`
- `tamanhosDaGrade(g: GradeTamanho): readonly string[]`; `tipoDaGradeTamanho(g: GradeTamanho): TipoProduto`
- `type Genero = 'masculino'|'feminino'|'unissex'|'meninos'|'meninas'|'sem_genero_infantil'`; `GENEROS_ADULTO`, `GENEROS_INFANTIL`, `GENEROS_VALIDOS`
- `generosDaGrade(g: GradeTamanho): readonly Genero[]` (infantil → infantis; demais → adultos)
- `gradeDaFamilia(gravada: string | null, tamanhos: readonly string[]): GradeTamanho | null` — gravada válida vence; null → todos em `TAMANHOS_ROUPA` ⇒ `'letras'`, todos em `NUMERACOES_CALCADO` ⇒ `'calcado'`, senão `null`
- `tamanhosValidosParaTipos` passa a incluir as três grades de roupa
- `numeracaoPublicavel` aceita `Genero` (infantil nunca é calçado: retorna `true` para valor fora de `NUMERACOES_CALCADO`, inalterado)
- Em `medidas-valores.ts`: `CONTORNO_QUADRIL_CM: Readonly<Record<'adulto_masculino'|'adulto_feminino'|'infantil', Readonly<Record<string, number>>>>` (adulto = Letras + Calça juntas) e `tabelaQuadril(genero: Genero): Readonly<Record<string, number>>` (unissex → masculino; infantis → infantil). Importar `Genero` só como tipo NÃO é permitido no módulo folha (sem `import type`, ver cabeçalho) — declarar a união literal localmente ou receber `string`.

- [ ] **Step 1: testes que falham** em `grades.test.ts`:
  - `tamanhosDaGrade('calca')` igual a `['34',…,'48']`; `('infantil')` igual a `['2',…,'16']`.
  - `gradeDaFamilia('calca', ['34','36'])` → `'calca'`; `gradeDaFamilia(null, ['34','36'])` → `'calcado'` (legado); `gradeDaFamilia(null, ['P','M'])` → `'letras'`; `gradeDaFamilia('xpto', ['P'])` → `'letras'` (gravada inválida cai na inferência); `gradeDaFamilia(null, ['P','34'])` → `null`.
  - `generosDaGrade('infantil')` igual a `['meninos','meninas','sem_genero_infantil']`; `generosDaGrade('calca')` igual aos adultos.
  - `tabelaQuadril('unissex')['48']` → 116; `tabelaQuadril('feminino')['P']` → 94; `tabelaQuadril('meninas')['16']` → 92; `tabelaQuadril('meninos')['P']` → `undefined`.
  - em `tipo-produto.test.ts`: `tamanhosValidosParaTipos(['roupa'])` contém `'2'`, `'48'`, `'GG'`.
- [ ] **Step 2:** `pnpm test supabase/functions/_shared/produto` → FAIL (exports inexistentes).
- [ ] **Step 3:** Implementar as exports acima.
- [ ] **Step 4:** `pnpm test supabase/functions/_shared/produto` → PASS; `pnpm check:functions` → OK.
- [ ] **Step 5:** Commit `feat(adr-0182): fonte única de grades, gêneros infantis e quadril`.

### Task 3: Migration — `grade_tamanho` e gêneros infantis

**Files:**
- Create: `supabase/migrations/<timestamp>_adr182_grade_tamanho_genero_infantil.sql` (via `supabase migration new adr182_grade_tamanho_genero_infantil`)

- [ ] **Step 1:** SQL:
  - `alter table familias add column grade_tamanho text` + `constraint familias_grade_tamanho_valida check (grade_tamanho is null or grade_tamanho in ('letras','infantil','calca','calcado'))`. Sem default, sem backfill.
  - Recriar `familias_genero_valido` e `ml_size_charts_genero_check` (nomes reais conferidos em prod 2026-10-16) com os 6 gêneros; `familias` continua aceitando null.
  - `comment on column familias.grade_tamanho` citando ADR-0182.
- [ ] **Step 2:** Rodar com `scripts/teste-sql-desfeito.py` (transação desfeita): inserir família com `grade_tamanho='calca'`, `genero='meninos'` passa; `grade_tamanho='xg'` falha; `genero='menino'` falha → `TESTE_OK`.
- [ ] **Step 3:** `npm run db:check` → a ÚNICA divergência é esta migration (pendente local). Alinhamento completo só depois do `db push` (Task 9). **Não** rodar `db push` aqui.
- [ ] **Step 4:** Commit `feat(adr-0182): coluna grade_tamanho e gêneros infantis`.

### Task 4: Cadastro (edge `cadastrar-produto`) grava e valida a grade

**Files:**
- Modify: `supabase/functions/_shared/produto/validar.ts` (`ProdutoEntrada`, `validarProdutoNovo`, `montarLinhasProduto`)
- Modify: `supabase/functions/cadastrar-produto/processar.ts` (`entradaTamanhoEfetiva`: zera `gradeTamanho` junto com `genero`/`tamanho` em org sem tipo; **`validarTamanhosDaEntrada` mora aqui, `:71`** — é a função que o handler usa)
- Modify: `supabase/functions/cadastrar-produto/index.ts` (ramo de retry `:109-153`: selecionar `grade_tamanho, genero` da família existente e comparar com a entrada; divergência → 409, antes de qualquer efeito)
- Test: `supabase/functions/_shared/produto/__tests__/validar.test.ts`, `supabase/functions/cadastrar-produto/__tests__/processar.test.ts` (e o teste do retry do index, se existir; senão extrair a comparação para função pura em `processar.ts` e testá-la)

**Interfaces:**
- Consumes: Task 2 (`GradeTamanho`, `GRADES_VALIDAS`, `GRADES_DO_TIPO`, `tamanhosDaGrade`, `generosDaGrade`, `GENEROS_VALIDOS`, `Genero`)
- Produces: `ProdutoEntrada.gradeTamanho?: GradeTamanho | null`; `ProdutoEntrada.genero?: Genero | null`; `validarTamanhosDaEntrada(p, tipos)` (mesma assinatura); linha de `familias` com `grade_tamanho: p.gradeTamanho ?? null`

- [ ] **Step 1: testes que falham:**
  - gênero `'meninos'` com grade `'infantil'` → sem erro; `'meninos'` com `'calca'` → erro campo `genero`; `'masculino'` com `'infantil'` → erro campo `genero`.
  - **compatibilidade com o front atual** (edges vão ao ar antes dele, Task 9): variação com tamanho e `gradeTamanho` ausente → grade efetiva = `gradeDaFamilia(null, tamanhos)` (só Letras/Calçado); `['P','M']` → grava `'letras'`; `['34','35']` em org calçado → grava `'calcado'`; inferência `null` (ex.: `['P','34']`) → erro campo `gradeTamanho`. A grade efetiva (não o campo cru) é a que vai para `grade_tamanho` e para a comparação do retry.
  - `validarTamanhosDaEntrada` com grade `'calca'` e tamanho `'GG'` → erro; com `'calca'` e `'48'` → ok; grade `'infantil'` em org só `['calcado']` → erro campo `gradeTamanho`.
  - `montarLinhasProduto` grava `grade_tamanho: 'infantil'`; sem grade grava `null`.
  - `entradaTamanhoEfetiva` em org sem tipo zera `gradeTamanho`.
  - retry com mesma chave e grade `'calcado'` sobre família gravada `'calca'` (mesma cor/tamanho `34`) → 409; idem gênero diferente; grade e gênero iguais → comportamento atual de retry; payload legado sem `gradeTamanho` (`['P']`) sobre família gravada `'letras'` → retry normal (compara a grade efetiva); família antiga com `grade_tamanho` null tratada como `gradeDaFamilia(null, tamanhos gravados)`.
- [ ] **Step 2:** `pnpm test supabase/functions/_shared/produto supabase/functions/cadastrar-produto` → FAIL.
- [ ] **Step 3:** Implementar. Mensagem de gênero inválido lista as opções da grade. Remover o `GENEROS_VALIDOS` local de `validar.ts:83` em favor do da fonte única.
- [ ] **Step 4:** mesmos testes → PASS; `pnpm check:functions`.
- [ ] **Step 5:** Commit `feat(adr-0182): cadastrar-produto grava e valida grade_tamanho`.

### Task 5: Guia de tamanhos — quadril e domínio sem guia

**Files:**
- Modify: `supabase/functions/_shared/ml/size-chart.ts`
- Test: `supabase/functions/_shared/ml/__tests__/size-chart.test.ts`

**Interfaces:**
- Consumes: Task 2 (`Genero`, `tabelaQuadril`, `GENEROS_INFANTIL`)
- Produces:
  - `Genero` reexportado da fonte única; `GENDER_VALUE: Record<Genero, {id, nome}>` com os 6 valores das Global Constraints
  - `DOMINIOS_QUADRIL = new Set(['SHORTS','PANTS'])`, `DOMINIOS_SEM_GUIA = new Set(['CLOTHING_LOTS'])`; ambos em `DOMINIOS_SUPORTADOS`
  - `montarLinhasChart(tamanhos, sizeValores, filtravelValores, medidasCm = CONTORNO_PEITO_CM, coluna: 'CHEST_CIRCUMFERENCE_FROM' | 'HIP_CIRCUMFERENCE_FROM' = 'CHEST_CIRCUMFERENCE_FROM', nomeFiltravel: (t: string) => string = (t) => t)`
  - `garantirChart(admin, token, connectionId, categoriaId, genero, tamanhos, grade: GradeTamanho)`: retorno `Promise<ChartResolvido | null>`; `null` **só** quando o domínio está em `DOMINIOS_SEM_GUIA` (sem ler/gravar cache, sem chamar o ML)
  - `dominioAceitaGrade(domainId: string, grade: GradeTamanho): boolean` — `'calcado'` só em domínios de calçado; `'letras'` em peito/quadril/sem guia; `'infantil'`/`'calca'` só em quadril/sem guia. `garantirChart` chama ANTES do cache e lança `Guia de tamanhos: grade ${grade} incompatível com o domínio ${domainId} — confira a categoria do produto.`
  - `nomeChart`: normaliza também o gênero (`_` → espaço) — nomes adultos existentes não mudam
  - `criarChartVestuario`: domínio de quadril → superset = chaves de `tabelaQuadril(genero)` presentes no `SIZE` da categoria, coluna `HIP_CIRCUMFERENCE_FROM`, `nomeFiltravel` = `` `${t} anos` `` para gênero infantil; demais domínios inalterados (peito)

- [ ] **Step 1: testes que falham:**
  - `montarLinhasChart(['4'], size, filt, tabelaQuadril('meninos'), 'HIP_CIRCUMFERENCE_FROM', (t)=>`${t} anos`)` → linha com `FILTRABLE_SIZE` name `'4 anos'` e `HIP_CIRCUMFERENCE_FROM` `'62 cm'`.
  - `garantirChart` com categoria cujo domínio é `CLOTHING_LOTS` → `null` e zero chamadas a `ml_size_charts`/fetch de chart (fakes já usados no arquivo).
  - domínio `PANTS`, gênero `feminino`, sem cache → POST com 12 linhas (P,M,G,GG + 34..48) e coluna `HIP_CIRCUMFERENCE_FROM`; `40` → `'102 cm'`.
  - domínio `JACKETS_AND_COATS` com cache existente → devolve o cache, sem POST (regressão; Review Focus 4).
  - `GENDER_VALUE.sem_genero_infantil.id === '19159491'`.
  - `garantirChart` grade `'calca'` em domínio `SNEAKERS` → lança "incompatível"; grade `'calcado'` em `PANTS` → lança; nenhum dos dois toca cache/fetch.
  - `nomeChart('SHORTS','sem_genero_infantil',…)` não contém `_`; `nomeChart('JACKETS_AND_COATS','masculino',['P'])` igual ao valor atual.
- [ ] **Step 2:** `pnpm test supabase/functions/_shared/ml/__tests__/size-chart.test.ts` → FAIL.
- [ ] **Step 3:** Implementar. Atualizar comentário de `DOMINIOS_*` citando Spike 056.
- [ ] **Step 4:** teste → PASS; `pnpm check:functions` (os chamadores de `garantirChart` vão quebrar no tipo `| null` — corrigidos na Task 6; se o check falhar só por isso, seguir).
- [ ] **Step 5:** Commit `feat(adr-0182): guia de quadril (SHORTS/PANTS) e CLOTHING_LOTS sem guia`.

### Task 6: Publicação e extensão de grade

**Files:**
- Modify: `supabase/functions/_shared/ml/publicar.ts` (tipo da variação ~`:46-55`; ramo de tamanho `:187-202`)
- Modify: `supabase/functions/_shared/user-products/publicar-familia-up.ts` (`:72-92`, `:150-160`)
- Modify: `supabase/functions/_shared/user-products/atualizar-familia-up.ts` (`:223-280`)
- Modify: `supabase/functions/_shared/user-products/atributos-divergentes.ts:19` (lista de atributos por SKU)
- Modify: todo `select` que alimenta `publicarFamiliaUP`/`atualizarFamiliaUP` e já lista `genero` (ex.: `reconciliar-convergencia-up/processar.ts:60`, `publish-familia-ml`, `update-familia-ml` — `grep -rn "genero" supabase/functions/*/` nos selects) passa a trazer `grade_tamanho`
- Modify: `supabase/functions/adicionar-variacoes-familia/processar.ts` (`:160-215`), `supabase/functions/adicionar-variacoes-familia/index.ts:209` (passar `gradeTamanho: anterior.grade_tamanho`)
- Test: `supabase/functions/_shared/ml/__tests__/publicar.test.ts`, `supabase/functions/_shared/user-products/__tests__/publicar-familia-up.test.ts`, `atualizar-familia-up.test.ts`, `supabase/functions/adicionar-variacoes-familia/__tests__/processar.test.ts`

**Interfaces:**
- Consumes: Task 5 (`garantirChart` → `ChartResolvido | null`), Task 2 (`gradeDaFamilia`, `tamanhosDaGrade`, `tipoDaGradeTamanho`)
- Produces: variação do payload ganha `tamanhoSemGuia?: boolean`; contexto da validação de adicionar-variações ganha `gradeTamanho: string | null`

- [ ] **Step 1: testes que falham:**
  - `montarPayloadItem` plano com `tamanho:'4', tamanhoSemGuia:true` e sem grid → atributos contêm `{id:'CLOTHING_LOT_SIZE', value_name:'4'}` e **não** contêm `SIZE`/`SIZE_GRID_ID`/`SIZE_GRID_ROW_ID`; com `tamanhoSemGuia` falso e sem grid → continua lançando "sem guia de tamanhos resolvida".
  - `publicarFamiliaUP` com `garantirChartFn` devolvendo `null` e gênero `meninos` → itens com `GENDER value_id '339667'` + `CLOTHING_LOT_SIZE`.
  - `atualizarFamiliaUP` SKU novo com chart `null` → mesmo par de atributos.
  - adicionar-variações: família `grade_tamanho:'calca'` com vivas `34,36` em org `['roupa','calcado']` → aceita `'38'`, recusa `'39'`; família `grade_tamanho:null` com vivas `P,M` → comportamento atual. Mensagem de tipo desativado continua.
  - `clonarFamilia(anterior)` preserva `grade_tamanho` (Review Focus 2).
  - herança: irmão publicado com `CLOTHING_LOT_SIZE '4'` na ficha + SKU novo `'6'` → o novo sai com exatamente um `CLOTHING_LOT_SIZE`, `'6'`; `atributosDivergentes` nunca propaga `CLOTHING_LOT_SIZE` para todos os filhos na reposição (Review Focus 7).
  - `publicarFamiliaUP` passa a `grade` (`gradeDaFamilia(familia.grade_tamanho, tamanhos)`) ao `garantirChart`; grade `null` com tamanho → lança antes do chart.
- [ ] **Step 2:** rodar os 4 arquivos → FAIL.
- [ ] **Step 3:** Implementar: `CLOTHING_LOT_SIZE` entra nos `IDS_SUBSTITUIDOS` (publicar `:88`), nas exclusões de herança/UPDATE (atualizar `:227` em diante) e na lista por SKU de `atributos-divergentes.ts`; chamadores marcam `tamanhoSemGuia: !!v.tamanho && chart === null`; adicionar-variações troca `tipoDaGrade` por `gradeDaFamilia(ctx.gradeTamanho, …)` e valida contra `tamanhosDaGrade(grade)` e `tipoDaGradeTamanho(grade)`; a checagem `numeracaoPublicavel` continua só para `'calcado'`.
- [ ] **Step 4:** testes → PASS; `pnpm check:functions` → OK; `pnpm lint:functions`.
- [ ] **Step 5:** Commit `feat(adr-0182): publicação com quadril/CLOTHING_LOT_SIZE e extensão por grade gravada`.

### Task 7: Front — listas, ordem e payload

**Files:**
- Modify: `src/lib/tamanhos.ts` (`opcoesDeTamanho(grade: GradeTamanho | null): GrupoTamanho[]`, reexports da Task 2, `numeracaoPublicavel` com `Genero | ''`)
- Modify: `src/lib/rotulo-variacao.ts:23`
- Modify: `src/lib/produto-entrada.ts:48`, `src/components/estoque/use-cadastro-produto.ts:38-75` (`montarPayload` recebe e envia `gradeTamanho`; `genero: Genero | null`)
- Modify: `src/lib/tipos-produto.ts:29` (descrição: "Tamanho em grade: Letras (P–GG), Infantil (2–16) ou Calça (34–48)")
- Test: `src/lib/__tests__/tamanhos.test.ts`, `rotulo-variacao.test.ts`, teste de `montarPayload` existente

**Interfaces:**
- Consumes: Task 2
- Produces: `opcoesDeTamanho(grade)` → `[{ grupo: 'Tamanho' | 'Numeração', valores }]` (`'calcado'` → "Numeração"; `null` → `[]`); `ROTULO_GRADE: Record<GradeTamanho, string>` = `{ letras: 'Letras (P–GG)', infantil: 'Infantil (2–16)', calca: 'Calça (34–48)', calcado: 'Numeração' }`; `ROTULO_GENERO: Record<Genero, string>` (Masculino, Feminino, Unissex, Meninos, Meninas, Sem gênero infantil) em `src/lib/tamanhos.ts`

- [ ] **Step 1: testes que falham:**
  - `opcoesDeTamanho('infantil')[0].valores` igual a `['2',…,'16']`; `opcoesDeTamanho(null)` → `[]`.
  - `ordenarVariacoesGrade` em calçado `['34','33','33/34']` → `33, 34, 33/34`; calça `['48','34','40']` → `34, 40, 48`; infantil `['10','2']` → `2, 10`.
  - `montarPayload` com `gradeTamanho:'calca'` → payload `gradeTamanho:'calca'`.
- [ ] **Step 2:** `pnpm test src/lib` → FAIL.
- [ ] **Step 3:** `ORDEM_TAMANHO = [...TAMANHOS_ROUPA, ...TAMANHOS_INFANTIL, ...isolados adultos 33..48 sem repetição, em ordem numérica, ...pares]` — derivado das listas, não redigitado.
- [ ] **Step 4:** Ajuste mecânico dos 2 chamadores de `opcoesDeTamanho` para o build ficar verde neste commit: cadastro passa `tipoEscolhido === 'calcado' ? 'calcado' : tipoEscolhido === 'roupa' ? 'letras' : null` (provisório, substituído na Task 8); estender passa `gradeDaFamilia(null, tamanhosIncluidos)`.
- [ ] **Step 5:** `pnpm test src/lib` → PASS; `tsc -b --force` → OK (typecheck vermelho não conclui a task).
- [ ] **Step 6:** Commit `feat(adr-0182): listas, ordem e payload de grade no front`.

### Task 8: Telas de cadastro e extensão de grade

**Files:**
- Modify: `src/components/estoque/dialog-cadastro-grade.tsx` (`:54-60`, `:92`, `:103-106`, `:191-216`, `:294-308`, `:376`, `:398-412`, `:607-619`)
- Modify: `src/components/estoque/dialog-estender-grade.tsx` (`:67-69`, `:91`, `:212-214`, `:581`)
- Test: `src/components/estoque/__tests__/dialog-cadastro-grade.test.tsx`, `dialog-estender-grade.test.tsx`

**Interfaces:**
- Consumes: Task 7 (`opcoesDeTamanho(grade)`, `ROTULO_GRADE`, `ROTULO_GENERO`, `generosDaGrade`, `GRADES_DO_TIPO`), Task 4 (payload `gradeTamanho`)

Comportamento (spec §6): com tipo Roupa, um `<select id="grade-tamanho">` "Grade" (obrigatório, sem default) acima do bloco "Cores e tamanhos" com Letras/Infantil/Calça; calçado fixa `'calcado'` sem select. Trocar de grade com linhas geradas usa o mesmo `setConfirmar` de `trocarTipo` (texto: "As N linha(s) da grade serão apagadas — os tamanhos das grades não são os mesmos.") e limpa tamanhos/linhas; se o gênero escolhido não estiver em `generosDaGrade(nova)`, zera o gênero. Select de gênero lista só `generosDaGrade(grade)`. `podeSalvar` exige grade. Estender grade: grade = `gradeDaFamilia(familia.grade_tamanho, tamanhos incluídos)`, tamanhos = `opcoesDeTamanho(grade)`, rótulo do gênero via `ROTULO_GENERO`.

- [ ] **Step 1: testes que falham:**
  - cadastro: escolher Roupa + grade Infantil mostra checkboxes `2`…`16` e gênero com Meninos/Meninas/Sem gênero infantil (sem Masculino); submeter envia `gradeTamanho:'infantil'`.
  - cadastro: com linhas geradas, trocar Infantil→Calça abre confirmação; confirmar limpa as linhas e zera gênero `meninos`.
  - estender: família `grade_tamanho:'calca'` mostra `34`…`48`, não `P`.
- [ ] **Step 2:** `pnpm test src/components/estoque` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `pnpm test src/components/estoque` → PASS; `pnpm preflight:static` → OK.
- [ ] **Step 5:** Commit `feat(adr-0182): seletor de grade e gênero infantil no cadastro em grade`.

### Task 9: Validação real, docs e deploy

**Files:**
- Modify: docs vivos conforme skill `docs-update-checklist` (`docs/reference/edge-functions.md`, `docs/project-status.md`, glossário de grade/gênero no obsidian-vault se existir)

- [ ] **Step 1:** `pnpm preflight` → verde.
- [ ] **Step 2:** Revisão do diff da branch pelo Grok 4.7 xhigh (`cursor-agent -p --mode ask --model grok-4.7-xhigh … < /dev/null`); corrigir achados (rodada única) e repetir `pnpm preflight`.
- [ ] **Step 3:** `supabase db push` (migration é aditiva: coluna nullable + CHECKs ampliados — compatível com as edges e o front atuais); `npm run db:check` → alinhado.
- [ ] **Step 4:** `supabase functions deploy` de **todas** as funções que importam (direta ou transitivamente) `size-chart.ts`, `publicar.ts`, `validar.ts`, `tipos-produto-valores.ts`, `publicar-familia-up.ts`, `atualizar-familia-up.ts`, `atributos-divergentes.ts` (lista gerada pelo grafo transitivo: para cada `supabase/functions/*/index.ts`, `deno info --json --config supabase/functions/deno.json <index>` e filtrar os `modules[].specifier` que terminam nesses caminhos; registrar a lista resultante no commit de docs como manifesto — deve conter ao menos `cadastrar-produto`, `publish-familia-ml`, `update-familia-ml`, `reconciliar-convergencia-up`, `adicionar-variacoes-familia`); conferir versão nova e `verify_jwt` contra `supabase/config.toml` pós-deploy. Edges antes do front: o front atual não manda `gradeTamanho` e continua funcionando (Letras/Calçado, `grade_tamanho` null).
- [ ] **Step 5:** `/items/validate` real (não cria item) com o payload gerado pelo código implantado, via runner novo `scripts/ops/ensaio-grade-ml.ts` (Deno; `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` por env, chave obtida com `supabase projects api-keys`, nunca gravada; token ML lido por `rpc get_connection_tokens(connection_id)` **sem renovar** — vencido ou a <5 min de vencer → aborta com mensagem antes de qualquer chamada, padrão de `scripts/spike-ads-ml.py`; não usa `getValidAccessTokenConexao`). Uso: `ensaio-grade-ml.ts <connection_id> <categoria> <genero> <grade> <tamanho,…>`; executa os helpers do código da branch — `garantirChart` real (grava cache), `montarPayloadItem` de 1 SKU plano com foto de teste, `POST /items/validate` (nunca `/items`), e lê a linha de `ml_size_charts`; imprime causas do ML e a linha do cache. Rodar na conexão Daludi (`57e11ff5-6098-4a25-b959-f43c92535b85`): SHORTS infantil e PANTS adulto (o `garantirChart` cria o chart de quadril definitivo na conta — o mesmo que a 1ª publicação criaria; **pedir OK do Diego antes**), CLOTHING_LOTS (sem chart), e um `sem_genero_infantil` (nome do chart sem `_`). Esperado: nenhum erro `fashion_grid`/`SIZE`/`GENDER`; só foto/atributos de categoria; **linha correspondente gravada em `ml_size_charts`** (consulta read-only) — falha de cache reprova o ensaio. Registrar ids dos charts no Spike 056 §8. Se o ML recusar o chart misto (12 linhas), separar o cache por grade (spec §8), redeployar e repetir.
- [ ] **Step 6:** ultraqa + browser real (sessão isolada, front local da branch contra o backend de produção): cadastrar conjunto infantil 2–16 Meninos e uma calça 34–48 até a Revisão; screenshot.
- [ ] **Step 7:** Merge fast-forward na main com CI verde (libera o front pelo auto-deploy do Render); docs vivos commitados antes.
- [ ] **Step 8:** Atualizar Graphify; remover worktree e branch.
