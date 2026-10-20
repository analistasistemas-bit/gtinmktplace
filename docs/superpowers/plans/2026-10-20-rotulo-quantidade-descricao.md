# Rótulo de quantidade na descrição (Metragem × Volume/Peso) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nenhuma descrição gerada pela IA, nem a de kit, pode sair com `• Metragem: 120ml` (ou `500g`). Volume vira `Volume`, massa vira `Peso`.

**Architecture:** Uma função pura e determinística, `corrigirRotuloQuantidade(descricao)`, em `_shared/ai/unidade.ts`. Fica ao lado de `rotuloQuantidade`, que já mapeia unidade → rótulo, e não importa nada. Ela é chamada em dois pontos:
- (1) No início de `posProcessarDescricao`, o pós-processamento único usado por `process-familia`, `regenerar-copy-familia` e `preview-kit-virtual`.
- (2) Dentro de `descricaoDoKit` (`src/lib/kit.ts`). O kit vinculado não passa pela IA: ele copia a descrição da família-base, então uma base com o erro já gravado também é corrigida no diálogo.

**Tech Stack:** TypeScript (Deno edge + Vite/React), vitest.

**Spec:** este documento.
- Incidente de 20/10/2026: kit vinculado da "Água Micelar Gottin 120ml" (família `00000003`, versão de 01/10) com `• Metragem: 120ml` herdado da base.
- `UNIDADE = UN`, então `rotuloQuantidade` devolve `null`, o prompt não manda "Rótulo sugerido" e a IA (gpt-4o-mini) desobedece a "REGRA CRÍTICA" do prompt (`copywriter-prompt.ts:833`).
- Medido em produção, via SQL read-only: 2 famílias publicadas com `Metragem:` seguido de ml/l/g/kg.

## Global Constraints

- O rótulo só muda quando a linha é bullet (`•`, `-` ou `–` no início, espaços opcionais), o rótulo é exatamente `Metragem` (sem diferenciar maiúsculas) seguido de `:` e o valor começa com número + unidade de volume ou massa.
- O valor nunca é alterado (`120ml` continua `120ml`). Só o rótulo muda.
- Unidades de volume → `Volume`: `ml`, `l`, `lt`, `litro`, `litros` (sem diferenciar maiúsculas, espaço opcional entre número e unidade, decimal com `,` ou `.`).
- Unidades de massa → `Peso`: `g`, `gr`, `grs`, `grama`, `gramas`, `kg`, `kgs`.
- Fronteira Unicode depois da unidade é obrigatória: `(?![\p{L}\p{N}_/])` com flag `u`, nunca `\b`. O Codex reproduziu `\b` transformando `500 grãos` em `Peso`, porque o JS acha fronteira entre `r` e `ã`. A `/` fica no lookahead para recusar unidades compostas (`g/m²`). `• Metragem: 50m`, `• Metragem: 10 metros` e `• Metragem: 1,5 m` ficam intactos. Alternância da unidade mais longa para a mais curta.
- Espaço entre rótulo, `:`, número e unidade só horizontal (`[ \t]*`), nunca `\s*`, para a regex não atravessar linhas.
- Função pura, idempotente, sem import. Mesmo arquivo importável pelo front, no padrão `../../supabase/functions/_shared/...` já usado em `src/`.
- Sem ADR: guard determinístico do mesmo tipo de `garantirLarguraDescricao`/`garantirMetragemDescricao` (ADR-0052/0115), sem estrutura nova. Registrar em `docs/TASKS.md`.
- Fora do escopo, confirmado pelo Codex: edição manual (`queries.ts`), reingest e sincronizações tradicional/UP gravam descrição direto. É conteúdo do operador ou legado e não passa pelo guard.
- Fora do escopo: reescrever as 2 descrições já publicadas no banco ou no ML. Elas se corrigem quando o operador usar "Regenerar copy" + Atualizar; o kit vinculado já sai corrigido pelo item (2).

## Review Focus

1. `• Metragem: 50m` / `• Metragem: 100 metros` (fita, legítimo) → intacto. Teste em Task 1.
2. `• Metragem: 1,5 L` / `• Metragem: 2 litros` → `Volume`; `• Metragem: 500 g` / `• Metragem: 1kg` → `Peso`. Teste em Task 1.
3. Ocorrência em prosa ("Metragem: 120ml" fora de bullet, ou "metragem de 120ml" num parágrafo) → intacto, para não reescrever texto livre. Teste em Task 1.
4. `garantirMetragemDescricao` não reinjeta `• Metragem:` depois da correção quando o nome não tem metragem (`Água Micelar Gottin 120ml`). Teste de integração em Task 1 via `posProcessarDescricao`.
5. Descrição de grade (caminho `posProcessarGrade`) também passa pela correção, porque a chamada fica antes do desvio da grade. Teste próprio em `copywriter-grade.test.ts` (Task 1, Step 6), com variações de tamanho reais. O teste da Task 1 sem variações nunca entra nesse caminho.
6. "Refazer kit virtual" reaproveita `refazerDe.descricao` gravada em `kits_virtuais`, sem passar por `posProcessarDescricao`, e a publica de novo no ML. Teste em Task 2.
7. Palavras que começam como unidade (`500 grãos`) e unidades compostas (`80 g/m²`) → intactos. Teste em Task 1.

---

### Task 1: `corrigirRotuloQuantidade` + uso no pós-processamento da IA

**Files:**
- Modify: `supabase/functions/_shared/ai/unidade.ts` (adicionar função exportada)
- Modify: `supabase/functions/_shared/ai/copywriter-prompt.ts:578-594` (`posProcessarDescricao`: aplicar no topo, antes de `tamanhosDaGradeCopy`)
- Test: `supabase/functions/_shared/ai/__tests__/unidade.test.ts`
- Test: `supabase/functions/_shared/ai/__tests__/copywriter-largura.test.ts` (1 caso de integração)

**Interfaces:**
- Produces: `export function corrigirRotuloQuantidade(descricao: string): string` em `_shared/ai/unidade.ts`

- [ ] **Step 1: Testes que falham** em `unidade.test.ts`, `describe('corrigirRotuloQuantidade')`:
  - `'• Metragem: 120ml'` → `'• Volume: 120ml'` (caso real, água micelar 00000003)
  - `'• Metragem: 1,5 L'` → `'• Volume: 1,5 L'`; `'- Metragem: 2 litros'` → `'- Volume: 2 litros'`
  - `'• Metragem: 500 g'` → `'• Peso: 500 g'`; `'• metragem: 1kg'` → `'• Peso: 1kg'`
  - `'• Metragem: 50m'`, `'• Metragem: 100 metros'`, `'• Metragem: 1,5 m'` → inalterados
  - `'A metragem: 120ml no frasco'` (sem bullet) → inalterado
  - `'• Metragem: 500 grãos'` e `'• Metragem: 80 g/m²'` → inalterados (fronteira Unicode + `/`)
  - `it.each` cobrindo todos os aliases prometidos nas Global Constraints (`ml`, `l`, `lt`, `litro`, `litros` → Volume; `g`, `gr`, `grs`, `grama`, `gramas`, `kg`, `kgs` → Peso)
  - `'• Metragem:\n120ml'` (valor na linha seguinte) → inalterado (espaço só horizontal)
  - Descrição multilinha com `• Marca: Göttin Laboratory\n• Metragem: 120ml\n• Aplicação: limpeza facial` → só a linha do meio muda
  - Idempotência: `f(f(x)) === f(x)` no caso multilinha
- [ ] **Step 2:** `pnpm test -- supabase/functions/_shared/ai/__tests__/unidade.test.ts` → FAIL (`corrigirRotuloQuantidade is not a function`).
- [ ] **Step 3:** Implementar em `unidade.ts`. Um `replace` com regex multilinha ancorada em `^([ \t]*[•\-–][ \t]*)Metragem([ \t]*:[ \t]*)(?=\d+(?:[.,]\d+)?[ \t]*(?:<unidades>)(?![\p{L}\p{N}_/]))` com flags `gimu`, uma regex para volume e outra para massa. Comentário de 2 linhas citando o incidente de 20/10 e a REGRA CRÍTICA do prompt.
- [ ] **Step 4:** Mesmo comando → PASS.
- [ ] **Step 5: Teste de integração que falha** em `copywriter-largura.test.ts`: `posProcessarDescricao` com descrição contendo `📌 ESPECIFICAÇÕES\n\n• Marca: Göttin Laboratory\n• Metragem: 120ml\n\n🎯 INDICAÇÕES DE USO`, nomePai `'Água Micelar Gottin 120ml'`, descricaoPai `''`.
  - expect contém `'• Volume: 120ml'`
  - expect não casa `/Metragem/i`
- [ ] **Step 6:** Rodar → FAIL; aplicar `descricao = corrigirRotuloQuantidade(descricao)` na primeira linha de `posProcessarDescricao` (import de `./unidade.ts`, que já é importado no arquivo); rodar → PASS.
- [ ] **Step 6b: Teste de grade** em `copywriter-grade.test.ts`: `posProcessarDescricao` com variações de tamanho reais, no formato dos casos que já existem no arquivo, e um `• Metragem: 500ml` em ESPECIFICAÇÕES.
  - expect `• Volume: 500ml`
  - os asserts de remoção de bullets de medida que o arquivo já faz para grade continuam valendo
  - deve passar sem mudança extra, porque a chamada fica antes do desvio da grade
- [ ] **Step 7:** `pnpm test -- supabase/functions/_shared/ai` → toda a suíte verde (os casos de fita/metragem existentes não podem mudar).
- [ ] **Step 8: Commit** `fix(copy): rótulo Volume/Peso no lugar de Metragem para ml/g na descrição`.

### Task 2: Kits (vinculado e "Refazer" virtual) corrigem a descrição herdada

**Files:**
- Modify: `src/lib/kit.ts` (`descricaoDoKit`, ~linha 111)
- Modify: `src/components/kit-virtual/DialogCriarKitVirtual.tsx:84`
- Test: `src/lib/__tests__/kit.test.ts`
- Test: `src/components/kit-virtual/__tests__/DialogCriarKitVirtual.test.tsx`

**Interfaces:**
- Consumes: `corrigirRotuloQuantidade(descricao: string): string` de `../../supabase/functions/_shared/ai/unidade.ts` (Task 1)

- [ ] **Step 1: Teste que falha** em `kit.test.ts`: `descricaoDoKit('📌 ESPECIFICAÇÕES\n\n• Metragem: 120ml\n\n🎯 INDICAÇÕES DE USO', 3, 'Água Micelar Gottin 120ml')`.
  - expect contém `'• Volume: 120ml'`
  - expect não casa `/Metragem/i`
- [ ] **Step 2:** `pnpm test -- src/lib/__tests__/kit.test.ts` → FAIL.
- [ ] **Step 3:** Em `descricaoDoKit`, aplicar `corrigirRotuloQuantidade` sobre `descricaoBase.trimEnd()` na inicialização de `desc`.
- [ ] **Step 4:** Mesmo comando → PASS, e os testes existentes de `kit.test.ts` continuam verdes.
- [ ] **Step 4b: Refazer kit virtual.** Em `src/components/kit-virtual/DialogCriarKitVirtual.tsx:84`, trocar `setDescricao(refazerDe.descricao ?? '')` por `setDescricao(corrigirRotuloQuantidade(refazerDe.descricao ?? ''))`. A correção vale só no preenchimento inicial; o que o operador editar depois é respeitado.
  - Teste em `src/components/kit-virtual/__tests__/DialogCriarKitVirtual.test.tsx`, no padrão dos casos de `refazerDe` que já existem: `refazerDe.descricao = '• Metragem: 120ml'` → o campo Descrição mostra `• Volume: 120ml`.
  - FAIL → implementar → PASS.
- [ ] **Step 5:** `pnpm preflight:static` → verde (inclui `tsc -b`; confirma que o import cruzado front→`_shared` compila).
- [ ] **Step 6:** Atualizar `docs/TASKS.md` com uma entrada (`[x]`, 20/10/2026): causa (UNIDADE=UN sem rótulo sugerido + IA desobedece à regra), guard em `unidade.ts`, dois pontos de uso, as 2 famílias legadas fora do escopo.
- [ ] **Step 7: Commit** `fix(kit): descrição do kit vinculado troca Metragem por Volume/Peso herdado da base`.

### Task 3: Entrega

- [ ] **Step 1:** Revisão do diff da branch pelo Codex `gpt-6.1-sol` high (read-only).
- [ ] **Step 2:** Push → CI verde (`frontend`, `backend-lint`) → fast-forward na `main`.
- [ ] **Step 3:** Deploy de todas as edges que consomem `copywriter-prompt.ts`, direta ou transitivamente: `supabase functions deploy process-familia regenerar-copy-familia preview-kit-virtual publicar-split-ml update-familia-ml reconciliar-convergencia-up`, conferindo a versão nova de cada uma em `supabase functions list`. Antes do deploy, rodar `grep -rl "copywriter-prompt\|ai/copywriter\|ai/unidade" supabase/functions --include=index.ts` mais o fechamento do grafo de imports, para confirmar que a lista ainda é essa. Front sai no deploy do Render.
- [ ] **Step 4:** Validação real: abrir "Criar kit" da água micelar `00000003` em Publicados e conferir `• Volume: 120ml` na descrição do diálogo (sem criar o kit).
