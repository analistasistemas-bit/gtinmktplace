# Tirar família da Revisão — Implementation Plan (v2, pós-revisão Grok 4.7 xhigh)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o operador tire UMA família não publicada da tela Revisão (apagando-a do banco), sem excluir o lote inteiro e sem tocar no Mercado Livre.

**Architecture:** Nova edge `excluir-familia` (`index.ts` fino + `processar.ts` testável + `decidir.ts` puro). A decisão "pode apagar?" é uma função pura sobre três leituras (família alvo, irmãs do mesmo `codigo_pai`, `anuncios_externos` do `codigo_pai`). O DELETE é condicional ao status (`pronto`/`erro`) para fechar a corrida com o claim do worker. Depois do delete, a edge fecha o lote com leitura/escrita que conferem erro e reaproveitam `contarFamilias`/`decidirStatusLote`. O `excluir-lote` não muda. No front, o botão "Tirar da revisão" fica na linha da família e abre um `AlertDialog`; no sucesso, a Revisão tira o id dos sets locais na hora.

**Tech Stack:** Supabase Edge Functions (Deno/TS), React + TanStack Query, Radix (`src/components/ui/alert-dialog.tsx`), vitest.

**Spec:** desenho aprovado em chat (2026-11-07; respostas do Grok 4.7 xhigh no lugar do Diego) + revisão do plano v1 (Grok, REVISE, 9 achados — todos incorporados abaixo). Formaliza-se no ADR-0199 (Task 1).

## Global Constraints

- Só família com `publicado_em IS NULL` e `status` ∈ {`pronto`, `erro`} pode sair. Sem status novo, sem desfazer. Mercado Livre nunca é chamado.
- Todo 4xx devolve JSON `{ erro: string }` (o `chamarEdge` só lê `json.erro`). Textos:
  - 400 `"familia_id obrigatório"`
  - 404 `"Família não encontrada."` (inclui: outra org, ou `podeExcluirLote` falso)
  - 409 `publicada`: `"Família já publicada — use a tela Publicados."`
  - 409 `em_voo`: `"Há processamento ou publicação em andamento para este produto. Aguarde terminar."`
  - 409 `vinculada`: `"Família ligada a anúncio no Mercado Livre e é a única que o representa — não pode sair. Basta não selecioná-la."`
  - 409 `kit`: `"Produto tem kit vinculado: remova os kits antes."`
  - 409 `pxv`: o texto devolvido por `motivoMigracaoPxvEmCurso`
  - 409 `nao_conferido`: `"Não deu para conferir o vínculo com o Mercado Livre. Nada foi apagado — tente de novo."`
- Permissão = a do `excluir-lote`: `requireUserOrg(req, { access: 'write' })` + `podeExcluirLote(lote.user_id, userId, support?.scope === 'full')`.
- Toda leitura de guard que falhar → `nao_conferido` (trava fechada). Erro no DELETE/escrita do lote → lança (500).
- `config.toml`: `[functions.excluir-familia] verify_jwt = true`.
- Seleção de publicar e exclusão nunca se misturam: a ação fica só na linha, uma família por vez.
- Botão: texto "Tirar da revisão"; visível só se `familia.status` ∈ {`pronto`,`erro`} **e** `lote.user_id === user?.id` (`useAuth`). A edge é a trava real. Confirmação: título "Tirar da revisão?"; corpo `PAI {codigoPai} · {titulo}` + "A família será apagada deste lote. O Mercado Livre não é alterado. Para trazê-la de volta, suba a planilha de novo."; botão destrutivo "Tirar da revisão".

## Regra de decisão (`decidirExclusaoFamilia`, pura)

Entrada: `alvo` (status, publicado_em, ml_item_id, variacoes[].ml_variation_id), `irmas` (outras linhas de `familias` da org com o mesmo `codigo_pai` ou o mesmo `ml_item_id` não nulo: `ml_item_id`, `variacoes[].ml_variation_id`), `externos` (linhas de `anuncios_externos` da org com esse `codigo_pai`: `status` ∈ {pendente, publicando, publicado, erro}, `item_externo_id`, `anuncios_externos_itens[].{status, item_externo_id}` — status do filho ∈ {pendente, criacao_incerta, criado, pausado, ativo, compensacao_pendente, remocao_pendente, erro}) e `kitsDependentes` (quantidade de `familias` com `kit_base_codigo_pai = codigo_pai` e `kit_multiplicador not null`, em qualquer status). Qualquer leitura `undefined` (falhou) → `nao_conferido`.

Ordem:
1. `alvo.publicado_em != null` → `publicada`.
2. `alvo.status ∉ {pronto, erro}` → `em_voo`.
3. Raiz com `status ∈ {pendente, publicando}` ou filho com `status ∈ {pendente, criacao_incerta, compensacao_pendente, remocao_pendente}` → `em_voo`. Caminhos: fan-out em voo, saga UP interrompida e janela de idempotência do ADR-0088.
4. `representada = irmas.length > 0`.
5. Existe evidência remota (`item_externo_id` na raiz ou em filho, ou `status = 'publicado'`) e `!representada` → `vinculada`. A reposição UPDATE com irmã publicada sai; a única linha que representa o produto fica.
6. Anti-órfão de variação: algum `chaveVinculo(alvo.ml_item_id, v.ml_variation_id)` que nenhuma irmã cobre → `vinculada` (incidente Xik 2026-08-13).
7. `!representada && kitsDependentes > 0` → `kit`.
8. Senão → `ok`.

Guard PxV fica fora da função pura: `motivoMigracaoPxvEmCurso(admin, orgId, codigo_pai)` roda antes; se der motivo → `pxv`.

## Review Focus

1. Corrida com o worker: entre a leitura e o DELETE, a família vira `publicando` → o DELETE condicional apaga 0 linhas → `em_voo`, nada apagado.
2. Reposição UPDATE de produto User Products (filho com `item_externo_id`, irmã publicada noutro lote) → sai. Sem irmã → `vinculada`.
3. Família em `erro` com split parcial no ar (raiz `item_externo_id` preenchido) e sem irmã → `vinculada`.
4. Última não publicada de lote com publicadas → lote `concluido`; última família do lote → lote apagado de fato, e o front só navega nesse caso.
5. Foto da família usada por outra família da org (capa de kit = foto da base) → não é apagada.

---

### Task 1: ADR-0199 + edge `excluir-familia`

**Files:**
- Create: `docs/decisions/0199-tirar-familia-da-revisao.md`. Antes, `git fetch` e confirmar que 0199 está livre em `origin/main`; se não estiver, usar o próximo número livre.
- Modify: `docs/decisions/README.md`
- Create: `supabase/functions/excluir-familia/decidir.ts`, `processar.ts`, `index.ts`
- Modify: `supabase/config.toml`
- Test: `supabase/functions/excluir-familia/__tests__/decidir.test.ts`, `__tests__/processar.test.ts`

**Interfaces:**
- Consumes: `chaveVinculo`, `pathsDaFamilia`, `filtrarPathsDeDonos` (`_shared/lote/exclusao.ts`); `contarFamilias`, `decidirStatusLote` (`_shared/lote/finalizar.ts`); `limparMovimentosOrfaos` (`_shared/estoque/limpeza.ts`); `podeExcluirLote` (`_shared/support-state.ts`); `motivoMigracaoPxvEmCurso` (`_shared/user-products/guard-migracao-pxv.ts`); `auditarOperacaoSuporte` (`_shared/support-audit.ts`).
- Produces:
  - `type MotivoRecusa = 'publicada' | 'em_voo' | 'vinculada' | 'kit' | 'nao_conferido'`
  - `decidirExclusaoFamilia(e: EntradaDecisao): { ok: true } | { ok: false; motivo: MotivoRecusa }`. `EntradaDecisao` traz os campos da seção "Regra de decisão", e `irmas`/`externos`/`kitsDependentes` aceitam `undefined`.
  - `excluirFamilia(admin: SupabaseClient, input: { familiaId: string; orgId: string; userId: string; suporteFull: boolean }): Promise<ResultadoExcluirFamilia>`
  - `type ResultadoExcluirFamilia = { tipo: 'nao_encontrada' } | { tipo: 'recusada'; motivo: MotivoRecusa | 'pxv'; mensagem?: string } | { tipo: 'ok'; loteRemovido: boolean }`
  - HTTP: body `{ familia_id }` → 200 `{ ok: true, lote_removido: boolean }` | 4xx `{ erro }` (textos das Global Constraints).

Ordem no `processar.ts`:
1. Ler a família (`id, lote_id, user_id, codigo_pai, status, ml_item_id, publicado_em, capa_storage_path, capa2_storage_path, capa3_storage_path, variacoes(imagem_path, ml_variation_id)`, `.eq('org_id')`). Se não houver linha → `nao_encontrada`; erro de leitura lança.
2. Ler o lote (`user_id, status, planilha_path, imagens_paths`). Se `!podeExcluirLote` → `nao_encontrada`; se `lote.status ∈ {processando, publicando}` → `em_voo`.
3. PxV.
4. Três leituras de guard em paralelo, com erro → `undefined`.
5. `decidirExclusaoFamilia`.
6. DELETE condicional: `.delete().eq('id', id).eq('org_id', orgId).in('status', ['pronto','erro']).is('publicado_em', null).select('id')`.
   - Erro `23514` (trigger de kit) → `recusada kit` com a mensagem do banco.
   - Outro erro → lança.
   - 0 linhas → `em_voo`.
7. `limparMovimentosOrfaos`.
8. Fechar o lote: ler `familias.status` do lote (erro lança).
   - Lista vazia → `lotes.delete()` com erro conferido; `loteRemovido = true`.
   - Senão, `lotes.update({ total_familias, total_publicadas, total_erros, status })`. O status vem de `decidirStatusLote(contarFamilias(...))`; quando for `null`, não grava status. Erro na escrita lança.
9. Storage, best-effort (falha só faz `console.warn`).
   - Candidatos: `filtrarPathsDeDonos(pathsDaFamilia(alvo), new Set([alvo.user_id]))`. Se o lote foi removido, somam-se `filtrarPathsDeDonos([planilha_path, ...imagens_paths], new Set([lote.user_id]))`.
   - Lote sobreviveu: tirar dos candidatos os paths de `lote.imagens_paths`. O `excluir-lote` cuida deles depois.
   - Tirar dos candidatos todo path ainda referenciado na org: `familias` por `capa_storage_path`/`capa2`/`capa3` `.in(paths)` (3 queries) e `variacoes.imagem_path` `.in(paths)`, filtrando pela org através da família.
   - Se qualquer uma dessas leituras falhar, não apaga nada.

`index.ts` segue o padrão do `excluir-produto/index.ts`. Audita com `{ type: 'familia', id }`, usando `succeeded`, `denied` (recusada) ou `failed` (`nao_encontrada`).

- [ ] **Step 1: ADR-0199.** Contexto: lacuna entre excluir variação e excluir lote. Decisão: Global Constraints mais a Regra de decisão. Consequências: reposição UPDATE sai se houver irmã; foto fica se alguém a usa; `excluir-lote` intocado. Adicionar a linha no `README.md`.
- [ ] **Step 2: Testes falhando em `decidir.test.ts`:**
  - `CREATE pronto sem externos → ok`
  - `publicado_em → publicada`
  - `status pendente|processando|publicando → em_voo` (it.each)
  - `externo pendente|publicando → em_voo` (it.each)
  - `filho em criacao_incerta|pendente|compensacao_pendente|remocao_pendente → em_voo` (it.each)
  - `UPDATE UP: filho com item_externo_id e irmã presente → ok`
  - `filho com item_externo_id e sem irmã → vinculada`
  - `raiz com item_externo_id (split parcial) e sem irmã → vinculada`
  - `ml_variation_id não coberto por irmã → vinculada`
  - `sem irmã e kitsDependentes > 0 → kit`
  - `irmas undefined | externos undefined | kitsDependentes undefined → nao_conferido` (it.each)
- [ ] **Step 3: Testes falhando em `processar.test.ts`** (fake admin FIFO no molde de `excluir-produto/__tests__/processar.test.ts`):
  - `família inexistente → nao_encontrada`
  - `lote de outro dono sem suporte → nao_encontrada`
  - `lote processando → recusada em_voo`
  - `PxV em curso → recusada pxv com a mensagem`
  - `DELETE devolve 0 linhas → recusada em_voo, sem limpar movimentos`
  - `DELETE com erro 23514 → recusada kit`
  - `ok com publicadas restantes → limpa movimentos depois do delete e grava status concluido e contadores`
  - `ok última família → lotes.delete, loteRemovido true, storage remove planilha+imagens só do prefixo do dono`
  - `lote sobrevive → paths de imagens_paths não são removidos`
  - `path referenciado por outra família → não é removido`
  - `erro ao ler famílias para fechar o lote → lança`
- [ ] **Step 4:** `pnpm vitest run supabase/functions/excluir-familia` → FAIL.
- [ ] **Step 5:** Implementar `decidir.ts`, `processar.ts` e `index.ts`, e o bloco no `config.toml`.
- [ ] **Step 6:** Testes PASS. `deno check supabase/functions/excluir-familia/index.ts` sem erro.
- [ ] **Step 7: Commit** `feat(revisao): edge excluir-familia + ADR-0199`

### Task 2: Front — botão "Tirar da revisão"

**Files:**
- Modify: `src/lib/excluir.ts`. Adicionar `excluirFamilia(familiaId: string) => chamarEdge<{ ok: true; lote_removido: boolean }>('excluir-familia', { familia_id: familiaId })`.
- Create: `src/hooks/useExcluirFamilia.ts`. Exporta `useExcluirFamilia(loteId: string)`; o `onSuccess` invalida `QK.familias(loteId)`, `QK.lote(loteId)`, `['lotes']`, `QK.publicados` e `QK.familiasNaoPublicadas`.
- Create: `src/components/tirar-da-revisao.tsx`. Exporta `TirarDaRevisao({ familia, onTirada }: { familia: Familia; onTirada: (familiaId: string) => void })`:
  - Botão `variant="ghost" size="sm" className="h-6 px-2 text-xs"` mais `AlertDialog`.
  - Sucesso: `onTirada(familia.id)` (antes da invalidação terminar) e `toast.success('Família tirada da revisão')`. Se `lote_removido`, também `navigate('/')`.
  - Erro: `toast.error('Não foi possível tirar', { description: e.message })`.
- Modify: `src/components/familia-row.tsx`. Nova prop opcional `onTirada?: (id: string) => void`. Renderiza `<TirarDaRevisao>` na linha de metadados, logo depois do span `PAI …`, quando `onTirada` existe e `familia.status` ∈ {`pronto`,`erro`}.
- Modify: `src/pages/Revisao.tsx`.
  - Passa `onTirada` só quando `lote?.user_id === user?.id` (`useAuth`).
  - `onTirada(id)` remove o id de `selecionadas` e de `somenteEstoqueOverrides`, e de `expandidas` se estiver lá.
- Test: `src/components/__tests__/tirar-da-revisao.test.tsx`

**Interfaces:**
- Consumes: o contrato HTTP da Task 1.

- [ ] **Step 1: Testes falhando:**
  - `confirmar chama excluirFamilia com o id, chama onTirada e mostra toast de sucesso`
  - `cancelar não chama excluirFamilia`
  - `409 da edge vira toast.error com a mensagem e não chama onTirada`
  - `lote_removido true navega para /`
  - `FamiliaRow mostra o botão para pronto/erro com onTirada; esconde sem onTirada ou com status publicado|publicando|pendente`
- [ ] **Step 2:** `pnpm vitest run src/components/__tests__/tirar-da-revisao.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Testes PASS, `pnpm preflight` e **`pnpm build`** verdes.
- [ ] **Step 5: Commit** `feat(revisao): botão Tirar da revisão por família`

### Task 3: Docs, merge e deploy

- [ ] **Step 1:** Atualizar os docs pela skill `docs-update-checklist`: `docs/reference/edge-functions.md`, `docs/project-status.md` e changelog. Commit `docs: tirar família da revisão (ADR-0199)`.
- [ ] **Step 2:** Revisão pré-merge do diff da branch pelo Grok 4.7 xhigh, em rodada única. Corrigir os achados e rodar `pnpm build` mais os testes.
- [ ] **Step 3:** Push → CI verde (`frontend`, `backend-lint`) → merge fast-forward na `main`.
- [ ] **Step 4:** Deploy com `supabase functions deploy excluir-familia`. Conferir que a versão ativa aparece em `supabase functions list`.
- [ ] **Step 5:** Validação em sessão isolada (Playwright, conta de validação). Usar um lote de teste com 2 famílias CREATE:
  - Tirar 1: ela some da lista, o contador cai e a outra continua publicável.
  - Família publicada não mostra o botão.
- [ ] **Step 6:** Remover o worktree e a branch. Rodar `git pull --ff-only` no checkout principal.
