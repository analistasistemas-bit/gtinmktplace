# Identidade do produto no título — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** título preserva o nome comercial e nada inventado entra como cor em produto sem eixo de cor.

**Architecture:** mantém IA extraindo slots e sistema montando. Corrige extração de cor, respaldo do Vision, prompt de `modelo`, ordem de corte e Revisão.

**Tech Stack:** Deno edge functions, React, vitest.

**Spec:** `docs/decisions/0197-identidade-do-produto-no-titulo.md`

## Global Constraints

- Sem migration, sem slot novo, sem coluna nova.
- Títulos de aceitação (aprovados por Diego em 07/11):
  - `Creme para Pentear 2 em 1 Tanox Pop Cabelos Exuberantes 1kg`
  - `Creme para Pentear 2 em 1 Brilho Uva 1kg`
  - `Creme para Pentear 2 em 1 Nutrição Morango 1kg`
  - `Máscara Capilar Hair Fly Hidrata Muito Mais`
  - `Reparador de Pontas Umidibrilho Óleo de Argan 30ml`
- Âncoras de `SYSTEM_GRADE` (`TÍTULO EM GRADE (só quando`, `EXEMPLOS\n\nFonte: Barbante`) não mudam.
- Título de grade não muda.

## Review Focus

- `4/6 21 ROSA PINK 570`: código + cor seguido de número continua `Rosa Pink 21`.
- Família mono de aviamento sem `COLOR` continua `Outra`, sem travar na Revisão.
- Agulha sem cor com calibre em `variacao` mantém o calibre (CRITICAL-2).
- Cor escrita no nome ("Alfinete Dourado") sobrevive ao descarte de Vision.
- UPDATE (reposição) não acusa título repetido.

---

### Task 1: extração e respaldo de cor

**Files:** `supabase/functions/_shared/cor/extrair.ts`, `sem-atributo.ts`, testes em `cor/__tests__/`; `process-familia/index.ts:565-567`

- [ ] Teste: `extrairCorECodigo('... hidratar 2 em 1')` → `null`; `'BARBANTE ALGODAO CONES 4/6 21 ROSA PINK 570'` → `{cor:'Rosa Pink', codigo:'21'}`; `'FITA 1354 VERMELHO TOMATE 10MT'` mantém.
- [ ] Rodar: falha.
- [ ] `extrair.ts`: `CONECTORES = new Set(['em','de','da','do','com','sem','para','por','e','a','o','x'])`; no laço, par só conta se `tokens[i+1]` não for conector.
- [ ] `process-familia`: `removerCorDosSlots` recebe `[claimed.nome_pai, ...nomes das variações].join(' ')`. `removerCorDaDescricao` mantém a fonte atual.
- [ ] Teste do Vermelho: `removerCorDosSlots({variacao:'Vermelho'}, ['Vermelho'], 'Creme NUTRIÇÃO MORANGO 1kg')` limpa.
- [ ] Rodar: passa.

### Task 2: produto simples sem cor e pipeline do título

**Files:** `supabase/functions/_shared/cor/sem-atributo.ts`, `process-familia/index.ts:211-212,558-564`, `_shared/ai/titulo-guards.ts:440-450`, testes. `publicar.ts` NÃO muda.

**Interfaces:** produz `corSemAtributo(nVariacoes: number, tipoAviamento: string | null, operacao: string | null): string | null`: `null` se `n === 1 && tipo === 'outro' && operacao === 'CREATE'`, senão `COR_VISION_INDEFINIDA`.

- [ ] Teste de `corSemAtributo` (3 casos). Teste de `posProcessarTitulo` com `variacao:'Vermelho'`, `cores:[]`, nome sem cor: sai do título. Com `variacao:'3,5mm'`: fica. Com nome "Alfinete Dourado": fica.
- [ ] Rodar: falha.
- [ ] Implementar. `aplicarGuardsTitulo`, ramo `cores.length === 0`: limpa `variacao` se `extrairCorDoTexto([variacao])` achar cor e o nome não a contiver. Em `process-familia`, trocar as 3 ocorrências; quando `null`, gravar também `cor_origem: null`.
- [ ] Rodar: passa.

### Task 3: prompt e corte

**Files:** `_shared/ai/copywriter-prompt.ts:703-710,804`, `_shared/ai/titulo-slots.ts:55`, testes em `_shared/ai/__tests__/`.

- [ ] Teste de aceitação: `posProcessarTitulo` com os slots esperados de cada produto gera os 5 títulos; overflow derruba `marca` antes de `modelo`; CRITICAL-2 segue passando.
- [ ] Teste do prompt: contém `Hidrata Muito Mais`, `2 em 1`, e `SYSTEM_GRADE` não contém os exemplos de cosmético.
- [ ] Rodar: falha.
- [ ] `ORDEM_CORTE`: reverso de `ORDEM_LEITURA` com `marca` antes de `modelo`.
- [ ] Prompt: `modelo` ganha nome comercial literal; `produto` preserva "2 em 1"; 2 exemplos de cosmético depois do 2º exemplo atual, antes de "O segundo exemplo termina", dentro do bloco comum.
- [ ] Rodar: passa, inclusive `titulo-grade.test.ts`.

### Task 4: Revisão

**Files:** create `src/lib/conferencia-titulo.ts` + teste; modify `src/lib/tipos-dominio.ts`, `src/lib/queries.ts:647`, `src/lib/publicavel.ts`, `src/components/variacao-card.tsx`, `familia-row.tsx:207`, `familia-expanded.tsx:865`, `src/pages/Revisao.tsx`.

**Interfaces:**
- `palavrasForaDoTitulo(nomePai: string, titulo: string): string[]`: sem acento e caixa, palavras de 3+ letras, ignora conectores e unidades.
- `titulosRepetidos(familias: Familia[]): Set<string>`: ids de famílias CREATE não publicadas com título normalizado igual.
- `familiaProdutoSimples` passa a ser exportada. `corExibida(cor, exigeCor)`: `Outra` vira `''` quando `!exigeCor`.

- [ ] Testes: `palavrasForaDoTitulo('Creme 2 em 1 BRILHO UVA 1kg','Creme 2 em 1 1kg')` → `['brilho','uva']`; `titulosRepetidos` pega par CREATE e ignora UPDATE; variacao-card com `Outra` e `exigeCor=false` mostra input vazio com placeholder `Sem cor`; familia-row de produto simples diz `Produto único`.
- [ ] Rodar: falha.
- [ ] Implementar. Aviso `text-xs` abaixo do título, só para produto simples ou título repetido. `Familia.nomePai` vem de `r.nome_pai`.
- [ ] Rodar: passa.

### Task 5: docs e validação

- [ ] `docs/TASKS.md`, `docs/decisions/README.md`, índice do vault, `obsidian-vault/02-Fluxos/Processamento IA.md`.
- [ ] `pnpm preflight:static`: exit 0.
- [ ] Commit, push, revisão do Codex no diff, CI.
