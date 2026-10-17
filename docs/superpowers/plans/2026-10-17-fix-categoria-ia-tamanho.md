# Correção: desempate de categoria por IA trocando para categoria-irmã + "Tamanho" indevido no editor de faltantes

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** (1) o desempate por IA passa a ver o caminho completo de cada categoria candidata e o gênero cadastrado do produto, para não trocar "Bermudas e Shorts" (adulto) por "Bebês › Shorts" — e continuar podendo corrigir no sentido inverso; (2) o editor "Complete para publicar" não pede SIZE em família com grade nem GENDER em família com `genero` gravado.

**Causa raiz (investigação 2026-10-17, short 00000010 da org Zaven):** `domain_discovery` devolveu 1º `MLB188064` (Bermudas e Shorts, `MLB-SHORTS`), 2º `MLB278065` (Bebês › Shorts, mesmo `MLB-SHORTS`). O desempate LLM (`_shared/categoria/resolver.ts:158-170`) recebeu só "domínio > folha" (`_shared/ai/categoria-llm-core.ts:29-42`), sem o caminho, e escolheu o 2º. Categorias-irmãs do mesmo domínio diferem por público (bebê/gestante/adulto) e o prompt não mostra isso. Sistemático em vestuário (camiseta, calça, pijama, vestido, moletom). Separadamente, o gate de publicação ignora SIZE/GENDER (`_shared/categoria/atributos.ts:129`, ADR-0167) mas `faltantesEditaveis` (`_shared/categoria/faltantes-editaveis.ts:5`) não, então pede "Tamanho" texto livre numa família com grade.

**Spec:** este documento (correção pequena; decisões abaixo). ADRs: 0026 (categorização por IA), 0054, 0058, 0167.

## Global Constraints

- Regra nova do desempate (revisada após Codex r1 — o veto por "mesmo domínio" erraria no sentido inverso, ex. "Short bebê" com o adulto em 1º): o prompt do desempate passa a mostrar, por candidato, o **caminho completo** (`path_from_root` de `GET /categories/{id}`, público, ex.: `Bebês > Roupas de Bebê > Shorts`) e, quando houver, o **gênero cadastrado** do produto (`familias.genero`, rotulado: masculino/feminino/unissex = adulto; meninos/meninas/sem gênero infantil = infantil), com a instrução de respeitar o público (adulto/infantil/bebê/gestante). Sem veto determinístico. Falha ao ler o caminho de um candidato → aquele candidato sai como hoje (`domínio > folha`); a leitura tem timeout curto e é feita em paralelo, só quando o desempate roda.
- A pista forte de vertical (`avaliarPistaForte`, `resolver.ts:137-143`) não muda.
- Editor de faltantes: SIZE some só se a família tem ≥1 variação viva com `tamanho` preenchido; GENDER some só se `familias.genero` não é null. Sem grade/sem gênero, os dois continuam editáveis como hoje. O gate (`FALTANTES_IGNORAR`) não muda.
- Sem migration. Git em worktree: `/usr/bin/git` simples, `commit -F`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Portão: `pnpm preflight`.

## Review Focus

1. Produto cuja busca devolve top-1 errado (falso-amigo de outro domínio, ou público errado no mesmo domínio, ex. "Short bebê" com o adulto em 1º): a IA continua podendo corrigir — nenhum veto determinístico.
2. Família de roupa **sem** grade numa categoria que exige SIZE: o editor continua oferecendo "Tamanho".
3. Família com grade mas `genero` null (estado legado): GENDER continua editável como hoje. Lacuna anterior conhecida: salvar GENDER no editor grava só `atributos_ml` e a publicação exige `familias.genero` — fora do escopo; 0 famílias nesse estado em produção (consulta 2026-10-17).

---

### Task 1: Desempate por IA com caminho da categoria e gênero

**Files:** Modify `supabase/functions/_shared/categoria/resolver.ts` (`InputCategoria.genero?: string | null`), `supabase/functions/_shared/ai/categoria-llm-core.ts` (`montarPromptDesempate(input, candidatos, caminhos?: Record<string, string>)`), `supabase/functions/_shared/ai/categoria-llm.ts` (antes de chamar o LLM, busca o caminho de cada candidato com `GET /categories/{id}` → `path_from_root` unido por " > ", em paralelo, timeout ~3 s por chamada, falha = ausente), `supabase/functions/process-familia/index.ts:264` (passa `genero` da família ao `resolverCategoria`); Test: testes existentes de `categoria-llm-core` e `resolver`; Modify `docs/decisions/0026-generalizacao-categorizacao-atributos-por-ia.md` (emenda 2026-10-17: caso do short MLB188064→MLB278065, caminho + gênero no prompt).

- [ ] **Step 1: testes que falham:** `montarPromptDesempate` com `caminhos` mostra `MLB278065 — Bebês > Roupas de Bebê > Shorts` e `MLB188064 — Calçados, Roupas e Bolsas > Bermudas e Shorts`; sem caminho para um id → linha atual `domínio > folha`; com `input.genero = 'masculino'` o prompt contém `Gênero: Masculino (adulto)`; com `'meninos'` contém `Gênero: Meninos (infantil)`; sem gênero não contém a linha. `categoria-llm.ts`: com fetch fake que falha para 1 id, o prompt ainda sai com os demais caminhos (a função que monta os caminhos é pura/testável com fetch injetável).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS; `pnpm check:functions`; `pnpm lint:functions`.
- [ ] **Step 5:** commit `fix(adr-0026): desempate de categoria vê caminho completo e gênero do produto`.

### Task 2: Editor de faltantes respeita grade e gênero

**Files:** Modify `supabase/functions/_shared/categoria/faltantes-editaveis.ts` (`faltantesEditaveis(schema, atributos, contexto?: { temGrade?: boolean; temGenero?: boolean })`); Modify `supabase/functions/atributos-familia/index.ts` (select da família inclui `genero`; lê as variações vivas da família (`tamanho`, `excluida_da_publicacao`, mesmo filtro de "viva" das edges de grade) e define `temGrade = classificarFamilia(vivas) === 'grade'` — `mista`/`simples` = false; passa o contexto); Test: `supabase/functions/_shared/categoria/__tests__/faltantes-editaveis*.test.ts`.

- [ ] **Step 1: testes que falham:** schema com SIZE e GENDER required → `{temGrade:true, temGenero:true}` não lista nenhum dos dois; `{}`/sem contexto lista os dois (inalterado); `{temGrade:true}` lista só GENDER; `{temGenero:true}` lista só SIZE.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS; `pnpm check:functions`; `pnpm lint:functions`.
- [ ] **Step 5:** commit `fix(adr-0167): editor de faltantes não pede tamanho/gênero já resolvidos pela grade`.

### Task 3: Validação, deploy e merge

- [ ] `pnpm preflight` verde; revisão do diff pelo Codex gpt-6.1-sol high.
- [ ] Deploy das edges pelo grafo transitivo (`deno info`) de `resolver.ts`, `faltantes-editaveis.ts` (esperado: `process-familia`, `definir-categoria-familia`, `atributos-familia`, `criar-kit-vinculado`, e o que mais o grafo apontar); conferir versão e `verify_jwt`.
- [ ] Docs vivos (skill `docs-update-checklist`), merge ff com CI verde, Graphify, limpar worktree/branch.
- [ ] Não reprocessar famílias existentes: a categoria do short 00000010 o Diego troca na tela (MLB188064).
