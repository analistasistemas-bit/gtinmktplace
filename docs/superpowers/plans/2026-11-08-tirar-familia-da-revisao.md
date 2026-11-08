# Tirar família da Revisão — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o operador tire UMA família não publicada da tela Revisão (apagando-a do banco), sem excluir o lote inteiro e sem tocar no Mercado Livre.

**Architecture:** Nova edge `excluir-familia` (`index.ts` fino + `processar.ts` testável) que aplica os mesmos guards da `excluir-lote` (ADR-0019 + anti-órfão + item remoto UP) a uma família só, apaga, limpa movimentos órfãos (ADR-0097), reconta o lote e reavalia o status via `talvezFinalizarLote`. As duas leituras de guard hoje privadas da `excluir-lote/index.ts` sobem para `_shared/lote/` e passam a ser usadas pelas duas edges. Front: botão "Tirar da revisão" na linha da família + `AlertDialog` de confirmação.

**Tech Stack:** Supabase Edge Functions (Deno/TS), React + TanStack Query, Radix (`src/components/ui/alert-dialog.tsx`), vitest.

**Spec:** desenho aprovado em chat (2026-11-07), respostas do Grok 4.7 xhigh no lugar do Diego — resumo nas Global Constraints. Formaliza-se no ADR-0199 (Task 1).

## Global Constraints

- Só família com `publicado_em IS NULL` pode sair. Publicada → 409 `"Família já publicada — use a tela Publicados."`.
- Apaga de verdade (DELETE em `familias`, cascade nas variações). Sem status novo `descartada`, sem desfazer.
- Mercado Livre nunca é chamado.
- Bloqueio (409 `"Aguarde o processamento/publicação terminar."`): lote em `processando`/`publicando`, ou família em `pendente`/`processando`/`publicando`.
- Guard anti-órfão idêntico ao do `excluir-lote`: reusa `particionarExclusao` (`_shared/lote/exclusao.ts`). Se a família cair em `preservadas` → 409 `"Família ligada a anúncio vivo no ML — não pode sair. Basta não selecioná-la."`. Leitura de guard que falhar → trava fechado (preserva).
- Permissão = a do `excluir-lote`: `requireUserOrg(req, { access: 'write' })` + `podeExcluirLote(lote.user_id, user.userId, user.support?.scope === 'full')`; falha → 404 (não vaza existência).
- Storage: NÃO apaga foto da família (os paths vêm de `lotes.imagens_paths`, compartilhado pelo lote; o `excluir-lote` limpa depois). Exceção: se o lote ficar vazio e for removido, apaga `planilha_path` + `imagens_paths` filtrados por `filtrarPathsDeDonos(..., new Set([lote.user_id]))` — senão esses arquivos vazam para sempre.
- Lote: `recontarOuRemoverLote(admin, loteId, false)`; se não removido, `talvezFinalizarLote(admin, loteId)` (`_shared/lote/finalizar.ts`) decide `revisao`/`concluido`.
- `config.toml`: `[functions.excluir-familia] verify_jwt = true`.
- Seleção de publicar e exclusão nunca se misturam: ação só na linha, uma família por vez.
- Botão: texto "Tirar da revisão"; aparece só quando `familia.status` ∈ {`pronto`, `erro`} (a edge é a trava real). Confirmação: título "Tirar da revisão?", corpo com `PAI {codigoPai} · {titulo}` e "A família será apagada deste lote. O Mercado Livre não é alterado. Para trazê-la de volta, suba a planilha de novo." Botão destrutivo "Tirar da revisão".
- Dropdown/select novo: proibido `<select>` nativo (não se aplica — não há select nesta feature).

## Review Focus

1. Família UPDATE de reposição (`ml_item_id` herdado, `publicado_em` null) cujo `codigo_pai` tem item vivo em `anuncios_externos_itens` → deve ser RECUSADA (409), não apagada. Teste em Task 2.
2. Família selecionada no checkbox e depois tirada → o id não pode ir no `publicarFamilias`. Teste em Task 3.
3. Última família não publicada de um lote que tem publicadas → lote vira `concluido` (via `talvezFinalizarLote`), não fica preso em `revisao`. Teste em Task 2.
4. Última família do lote (lote sem publicadas) → lote removido + planilha/imagens apagadas só sob o prefixo do dono. Teste em Task 2.
5. Falha de leitura no guard (`vinculosVivosFora`/`codigosComItemRemoto` = `undefined`) → recusa, não apaga. Teste em Task 2.

---

### Task 1: ADR-0199 + leituras de guard compartilhadas

**Files:**
- Create: `docs/decisions/0199-tirar-familia-da-revisao.md` (antes: `git fetch` e confirmar que 0199 está livre em `origin/main`; se não, próximo livre)
- Modify: `docs/decisions/README.md` (linha do índice)
- Create: `supabase/functions/_shared/lote/leituras-exclusao.ts`
- Modify: `supabase/functions/excluir-lote/index.ts` (remove as 2 funções locais, importa as compartilhadas)
- Test: `supabase/functions/_shared/lote/__tests__/leituras-exclusao.test.ts`

**Interfaces:**
- Produces:
  - `lerVinculosVivosFora(admin: SupabaseClient, orgId: string, familias: Array<{ ml_item_id: string | null }>, fora: { loteId: string } | { familiaId: string }): Promise<ReadonlySet<string> | undefined>` — mesma query de hoje; `fora.loteId` → `.neq('lote_id', …)`, `fora.familiaId` → `.neq('id', …)`. Erro → `undefined`.
  - `lerCodigosComItemRemoto(admin: SupabaseClient, orgId: string, familias: Array<{ codigo_pai?: string | null }>): Promise<ReadonlySet<string> | undefined>` — cópia literal da atual.

- [ ] **Step 1: ADR-0199** — contexto (print do Diego, lacuna entre excluir variação e excluir lote), decisão (= Global Constraints), consequências (UPDATE com item vivo não sai; fotos ficam até excluir o lote; `excluir-lote` passa a importar as leituras → redeploy). Linha no `README.md`.
- [ ] **Step 2: Testes falhando** em `leituras-exclusao.test.ts` (fake admin no estilo de `excluir-produto/__tests__/processar.test.ts`, registrando a coluna do `neq`):
  - `lerVinculosVivosFora com { loteId } filtra neq lote_id e monta chaves item|variation`
  - `lerVinculosVivosFora com { familiaId } filtra neq id`
  - `lerVinculosVivosFora sem ml_item_id → Set vazio sem consultar`
  - `lerVinculosVivosFora erro → undefined`
  - `lerCodigosComItemRemoto só inclui codigo com filho item_externo_id não nulo; erro → undefined`
- [ ] **Step 3:** `pnpm vitest run supabase/functions/_shared/lote/__tests__/leituras-exclusao.test.ts` → FAIL (módulo inexistente).
- [ ] **Step 4:** Mover as duas funções para `leituras-exclusao.ts` com a assinatura acima; `excluir-lote/index.ts` chama com `{ loteId: lote_id }`. Sem outra mudança de comportamento.
- [ ] **Step 5:** Teste acima PASS + `pnpm vitest run supabase/functions/_shared/lote` PASS.
- [ ] **Step 6: Commit** `refactor(lote): leituras do guard de exclusão em _shared + ADR-0199`

### Task 2: Edge `excluir-familia`

**Files:**
- Create: `supabase/functions/excluir-familia/processar.ts`, `supabase/functions/excluir-familia/index.ts`
- Modify: `supabase/config.toml` (bloco `[functions.excluir-familia]`)
- Test: `supabase/functions/excluir-familia/__tests__/processar.test.ts`

**Interfaces:**
- Consumes: Task 1 (`lerVinculosVivosFora` com `{ familiaId }`, `lerCodigosComItemRemoto`); `particionarExclusao`, `filtrarPathsDeDonos` (`_shared/lote/exclusao.ts`); `recontarOuRemoverLote` (`_shared/lote/recontar.ts`); `talvezFinalizarLote` (`_shared/lote/finalizar.ts`); `limparMovimentosOrfaos` (`_shared/estoque/limpeza.ts`); `podeExcluirLote` (`_shared/support-state.ts`).
- Produces:
  - `excluirFamilia(admin: SupabaseClient, input: { familiaId: string; orgId: string; userId: string; suporteFull: boolean }): Promise<ResultadoExcluirFamilia>`
  - `type ResultadoExcluirFamilia = { tipo: 'nao_encontrada' } | { tipo: 'em_voo' } | { tipo: 'publicada' } | { tipo: 'vinculada' } | { tipo: 'ok'; loteRemovido: boolean; movimentosRemovidos: number }`
  - HTTP: body `{ familia_id }`; 200 `{ ok: true, lote_removido, movimentos_removidos }`; 400 sem `familia_id`; 404 `nao_encontrada`; 409 `em_voo`/`publicada`/`vinculada` com `{ erro }` (textos das Global Constraints).

Ordem no `processar.ts`: ler família (`id, lote_id, codigo_pai, status, ml_item_id, publicado_em, capa_storage_path, capa2_storage_path, capa3_storage_path, variacoes(imagem_path, ml_variation_id)`, `.eq('org_id')`) → ler lote (`user_id, status, planilha_path, imagens_paths`) → `podeExcluirLote` (falso → `nao_encontrada`) → em voo → publicada → `particionarExclusao({ familias: [f], planilhaPath: null, imagensPaths: null, donoUserId: lote.user_id, vinculosVivosFora, codigosComItemRemoto })`; `paraExcluir` vazio → `vinculada` → DELETE (erro lança) → `limparMovimentosOrfaos` → `recontarOuRemoverLote(…, false)` → removido ? remove planilha+imagens filtradas : `talvezFinalizarLote`. Erros de leitura de família/lote lançam (index devolve 500). `index.ts` audita com `auditarOperacaoSuporte(admin, user, { type: 'familia', id }, 'succeeded'|'denied'|'failed')`, no padrão do `excluir-produto/index.ts`.

- [ ] **Step 1: Testes falhando** (fake admin FIFO copiado de `excluir-produto/__tests__/processar.test.ts`):
  - `família CREATE pronta → apaga, limpa movimentos depois do delete, reconta e finaliza o lote`
  - `publicado_em preenchido → publicada, nenhum delete`
  - `status publicando|processando|pendente → em_voo` (it.each) e `lote em processando → em_voo`
  - `UPDATE com codigo_pai em anuncios_externos_itens → vinculada, nenhum delete`
  - `leitura de vínculos falha (erro) → vinculada, nenhum delete`
  - `lote de outro dono sem suporte → nao_encontrada`
  - `última família do lote → lote removido, storage.remove com planilha+imagens só do prefixo do dono (path de outro dono fora)`
  - `restam publicadas → talvezFinalizarLote grava status concluido`
  - `lote não removido → storage.remove NÃO chamado`
- [ ] **Step 2:** `pnpm vitest run supabase/functions/excluir-familia` → FAIL.
- [ ] **Step 3:** Implementar `processar.ts` e `index.ts`; bloco no `config.toml`.
- [ ] **Step 4:** Testes PASS; `deno check supabase/functions/excluir-familia/index.ts supabase/functions/excluir-lote/index.ts` sem erro.
- [ ] **Step 5: Commit** `feat(revisao): edge excluir-familia tira família não publicada do lote`

### Task 3: Front — botão "Tirar da revisão"

**Files:**
- Modify: `src/lib/excluir.ts` — `excluirFamilia(familiaId: string) => chamarEdge<{ ok: true; lote_removido: boolean; movimentos_removidos: number }>('excluir-familia', { familia_id: familiaId })`
- Create: `src/hooks/useExcluirFamilia.ts` — `useExcluirFamilia(loteId: string)`; `onSuccess` invalida `QK.familias(loteId)`, `QK.lote(loteId)`, `['lotes']`.
- Create: `src/components/tirar-da-revisao.tsx` — `TirarDaRevisao({ familia }: { familia: Familia })`: botão `variant="ghost" size="sm" className="h-6 px-2 text-xs"` + `AlertDialog` (textos das Global Constraints). Sucesso: `toast.success('Família tirada da revisão')`; se `lote_removido`, `navigate('/')` (lote sumiu). Erro: `toast.error('Não foi possível tirar', { description: e.message })`.
- Modify: `src/components/familia-row.tsx` — renderiza `<TirarDaRevisao familia={familia} />` na linha de metadados (após o span `PAI …`) quando `familia.status === 'pronto' || familia.status === 'erro'`. O `onClick` da linha já ignora `button`.
- Modify: `src/pages/Revisao.tsx` — `useEffect` que poda `selecionadas` para ids presentes em `familias` (cobre família apagada que estava marcada).
- Test: `src/components/__tests__/tirar-da-revisao.test.tsx`, `src/pages/__tests__/Revisao.poda-selecao.test.tsx` (se o setup de página for caro demais, extrair `podarSelecao(sel: Set<string>, familias: {id: string}[]): Set<string>` para `src/lib/revisao-selecao.ts` e testar a função pura — preferível).

**Interfaces:**
- Consumes: edge da Task 2 (contrato HTTP acima).

- [ ] **Step 1: Testes falhando:**
  - `mostra o botão para status pronto e erro; esconde para publicado, publicando, pendente`
  - `confirmar chama excluirFamilia com o id e mostra toast de sucesso`
  - `cancelar não chama excluirFamilia`
  - `erro 409 da edge vira toast.error com a mensagem`
  - `podarSelecao remove id que não está mais em familias e devolve o mesmo Set se nada mudou` (mesma referência → sem re-render)
- [ ] **Step 2:** `pnpm vitest run src/components/__tests__/tirar-da-revisao.test.tsx src/lib/__tests__/revisao-selecao.test.ts` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Testes PASS + `pnpm preflight` verde.
- [ ] **Step 5: Commit** `feat(revisao): botão Tirar da revisão por família`

### Task 4: Docs, merge e deploy

**Files:**
- Modify: `docs/reference/edge-functions.md` (entrada `excluir-familia`; nota em `excluir-lote` sobre as leituras compartilhadas), `docs/project-status.md`, changelog conforme skill `docs-update-checklist`.

- [ ] **Step 1:** Docs pela skill `docs-update-checklist`. Commit `docs: tirar família da revisão (ADR-0199)`.
- [ ] **Step 2:** Revisão pré-merge do diff da branch (Grok 4.7 xhigh, rodada única). Corrigir achados → teste.
- [ ] **Step 3:** Push → CI verde (`frontend`, `backend-lint`) → merge fast-forward na `main`.
- [ ] **Step 4:** Deploy: `supabase functions deploy excluir-familia excluir-lote` (excluir-lote importa o `_shared` novo). Conferir versão ativa via `supabase functions list`.
- [ ] **Step 5:** Validação em sessão isolada (Playwright/browser-use, conta de validação): lote de teste com 2 famílias CREATE → tirar 1 → some da lista, contador cai, a outra continua publicável. Família publicada não mostra o botão.
- [ ] **Step 6:** Remover worktree e branch; `git pull --ff-only` no checkout principal.
