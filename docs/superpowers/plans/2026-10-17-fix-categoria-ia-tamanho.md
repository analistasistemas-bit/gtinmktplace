# Correção: desempate de categoria por IA trocando para categoria-irmã + "Tamanho" indevido no editor de faltantes

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** (1) a IA não pode trocar o 1º candidato específico do ML por outro **do mesmo domínio** (ex.: "Bermudas e Shorts" adulto → "Bebês › Shorts"); (2) o editor "Complete para publicar" não pede SIZE em família com grade nem GENDER em família com `genero` gravado.

**Causa raiz (investigação 2026-10-17, short 00000010 da org Zaven):** `domain_discovery` devolveu 1º `MLB188064` (Bermudas e Shorts, `MLB-SHORTS`), 2º `MLB278065` (Bebês › Shorts, mesmo `MLB-SHORTS`). O desempate LLM (`_shared/categoria/resolver.ts:158-170`) recebeu só "domínio > folha" (`_shared/ai/categoria-llm-core.ts:29-42`), sem o caminho, e escolheu o 2º. Categorias-irmãs do mesmo domínio diferem por público (bebê/gestante/adulto) e o prompt não mostra isso. Sistemático em vestuário (camiseta, calça, pijama, vestido, moletom). Separadamente, o gate de publicação ignora SIZE/GENDER (`_shared/categoria/atributos.ts:129`, ADR-0167) mas `faltantesEditaveis` (`_shared/categoria/faltantes-editaveis.ts:5`) não, então pede "Tamanho" texto livre numa família com grade.

**Spec:** este documento (correção pequena; decisões abaixo). ADRs: 0026 (categorização por IA), 0054, 0058, 0167.

## Global Constraints

- Regra nova do desempate: se o candidato escolhido pela IA tem o **mesmo `domainId` não vazio** do `topoEspecifico`, o resolver devolve o `topoEspecifico` com `origem: 'preditor'` (a IA não troca dentro do domínio). Troca para domínio diferente continua como hoje (`origem: 'ia'`). Abstenção (null) e falha técnica: inalteradas. `domainId` vazio em qualquer dos dois → comportamento atual.
- A pista forte de vertical (`avaliarPistaForte`, `resolver.ts:137-143`) não muda.
- Editor de faltantes: SIZE some só se a família tem ≥1 variação viva com `tamanho` preenchido; GENDER some só se `familias.genero` não é null. Sem grade/sem gênero, os dois continuam editáveis como hoje. O gate (`FALTANTES_IGNORAR`) não muda.
- Sem migration. Git em worktree: `/usr/bin/git` simples, `commit -F`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Portão: `pnpm preflight`.

## Review Focus

1. Produto cuja busca devolve top-1 errado em **outro** domínio (falso-amigo, motivo original do desempate — ADR-0054/0058): a IA continua podendo corrigir.
2. Família de roupa **sem** grade numa categoria que exige SIZE: o editor continua oferecendo "Tamanho".
3. Família com grade mas `genero` null (estado legado): GENDER continua editável.

---

### Task 1: Resolver não troca dentro do mesmo domínio

**Files:** Modify `supabase/functions/_shared/categoria/resolver.ts` (bloco do desempate, ~:158-170); Test: o teste existente do resolver (`supabase/functions/_shared/categoria/__tests__/resolver*.test.ts`); Modify `docs/decisions/0026-generalizacao-categorizacao-atributos-por-ia.md` (emenda 2026-10-17 com a regra e o caso do short).

- [ ] **Step 1: testes que falham:** candidatos `[A(domainId 'MLB-SHORTS'), B(domainId 'MLB-SHORTS')]`, LLM devolve B → resultado A, `origem 'preditor'`; candidatos `[A('MLB-X'), B('MLB-Y')]`, LLM devolve B → B, `origem 'ia'` (inalterado); LLM devolve B com `domainId ''` em A ou B → B (inalterado); abstenção e falha técnica inalteradas.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar. **Step 4:** rodar → PASS; `pnpm check:functions`; `pnpm lint:functions`.
- [ ] **Step 5:** commit `fix(adr-0026): desempate por IA não troca categoria dentro do mesmo domínio`.

### Task 2: Editor de faltantes respeita grade e gênero

**Files:** Modify `supabase/functions/_shared/categoria/faltantes-editaveis.ts` (`faltantesEditaveis(schema, atributos, contexto?: { temGrade?: boolean; temGenero?: boolean })`); Modify `supabase/functions/atributos-familia/index.ts` (select da família inclui `genero`; consulta se há variação viva com tamanho — mesmo critério de "viva" usado por `classificarFamilia`/edges de grade; passa o contexto); Test: `supabase/functions/_shared/categoria/__tests__/faltantes-editaveis*.test.ts`.

- [ ] **Step 1: testes que falham:** schema com SIZE e GENDER required → `{temGrade:true, temGenero:true}` não lista nenhum dos dois; `{}`/sem contexto lista os dois (inalterado); `{temGrade:true}` lista só GENDER; `{temGenero:true}` lista só SIZE.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS; `pnpm check:functions`; `pnpm lint:functions`.
- [ ] **Step 5:** commit `fix(adr-0167): editor de faltantes não pede tamanho/gênero já resolvidos pela grade`.

### Task 3: Validação, deploy e merge

- [ ] `pnpm preflight` verde; revisão do diff pelo Codex gpt-6.1-sol high.
- [ ] Deploy das edges pelo grafo transitivo (`deno info`) de `resolver.ts`, `faltantes-editaveis.ts` (esperado: `process-familia`, `definir-categoria-familia`, `atributos-familia`, `criar-kit-vinculado`, e o que mais o grafo apontar); conferir versão e `verify_jwt`.
- [ ] Docs vivos (skill `docs-update-checklist`), merge ff com CI verde, Graphify, limpar worktree/branch.
- [ ] Não reprocessar famílias existentes: a categoria do short 00000010 o Diego troca na tela (MLB188064).
