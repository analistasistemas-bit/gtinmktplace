# CREATE foto cache + lote da Revisão

> **For agentic workers:** TDD. Worktree: `.worktrees/feat-create-foto-revisao` branch `feat/create-foto-revisao`. Do **not** commit unless the orchestrator asks.

**Goal:** Reenviar after “Picture id does not exist” uploads fresh photos; sidebar Revisão opens the lote that still needs the operator, not the newest successful lote.

**Architecture:** Mirror UPDATE’s ephemeral picture-id cleanup on CREATE definitive photo failure; on “Corrigir e republicar” reset `operacao` to CREATE and zero picture ids before the next publish. Keep a lote in `revisao` when every family failed (0 published, ≥1 erro). `/revisao` picks that lote instead of `lotes[0]` by `criado_em`.

**Tech Stack:** Vitest, React, Supabase Edge (Deno), existing fakeAdmin/fakeConnector.

**Spec:** ADR-0016 adendo limpeza de cache de foto; ADR-0033 (do not clear on `item.pictures.unavailable` retry); spec `docs/superpowers/specs/2026-07-28-republicar-tamanhos-up-design.md` (republicar returns family as CREATE).

## Global Constraints

- Do not re-upload on retry of `item.pictures.unavailable` (ADR-0033).
- Clear picture caches only on **definitive** CREATE failure whose operator message matches `/does not exist/i` or `/Problema nas fotos/i` (the humanized ML picture error). Not on DESCONTO_INCOMPATIVEL / attribute errors.
- `decidirStatusLote`: `erro > 0 && publicado === 0` → `'revisao'`; `publicado > 0` with leftover erros still `'concluido'`.
- No commit. No push. No unrelated refactors.
- Validation before done: `pnpm test -- <scoped files>`, `pnpm lint` on touched files, **`pnpm build`**.

---

### Task 1: CREATE clears dead picture ids

**Files:**
- Modify: `supabase/functions/publish-familia-ml/processar.ts` (definitive error branches ~164–190 and catch ~267–280)
- Test: `supabase/functions/publish-familia-ml/__tests__/processar.test.ts`
- Optional helper in the same `processar.ts` (do not new-file unless needed)

**Behavior:** After marking `familias.status = 'erro'` on a **definitive** photo error (`decidirErroCriarAnuncio === 'definitivo'` and message matches the constraint), also:

```
variacoes: { ml_picture_id: null } where familia_id = job.familia_id
familias: { capa_ml_picture_id: null, capa2_ml_picture_id: null, capa3_ml_picture_id: null } where id = job.familia_id
```

Do **not** clear when `decidirErroCriarAnuncio === 'retentar'`.

`fakeConnector.falharProximo('FOTO', false)` yields `fake:FOTO` — that does **not** match. Arm a connector/`criarAnuncio` result whose `mensagemOperador` is `'Problema nas fotos do anúncio (Picture id 939880-MLB111925046462_062026 does not exist.). Verifique as imagens das variações.'` with `retentavel: false`, `codigo: 'DESCONHECIDO'` or `'FOTO'`. Assert writes contain the two null-payloads. Second test: same error with `tentativas` still in retry window and `retentavel: true` → no picture-id null writes.

Use existing `fakeAdmin` `writes` array. TDD: failing test first.

---

### Task 2: Republicar prepares CREATE with fresh photos

**Files:**
- Modify: `supabase/functions/remover-publicado/processar.ts` (~167–178)
- Test: `supabase/functions/remover-publicado/__tests__/processar.test.ts` (the `preservarFamilia: true` case already expects `ml_item_id: null, status: 'pronto'`)

**Behavior:** In `preservarFamilia` family update add `operacao: 'CREATE'`, `capa_ml_picture_id: null`, `capa2_ml_picture_id: null`, `capa3_ml_picture_id: null`. Variation update add `ml_picture_id: null` (keep existing `ml_variation_id` / `preco_publicado_ml` nulls).

Extend the existing expectation `objectContaining` — do not weaken it.

---

### Task 3: Failed-only lote stays in revisão

**Files:**
- Modify: `supabase/functions/_shared/lote/finalizar.ts`
- Test: `supabase/functions/_shared/lote/__tests__/finalizar.test.ts`

**Behavior:** Extend `ContagemLote` with `publicado` and `erro`. `contarFamilias` increments them. `decidirStatusLote`: after the existing pronto/emPreparo checks, `if (c.erro > 0 && c.publicado === 0) return 'revisao'`. Mixed `publicado + erro` still `'concluido'`.

Update every `decidirStatusLote({...})` call site in that test file to include `publicado: 0, erro: 0` (or the values under test). Add: só `{ erro: 1, publicado: 0, ...zeros }` → `'revisao'`. Keep `talvezFinalizarLote` case `publicado + erro` → `concluido`. Add `talvezFinalizarLote` only-erro → `revisao`.

---

### Task 4: `/revisao` opens the lote that needs the operator

**Files:**
- Create: `src/lib/escolher-lote-revisao.ts` (pure function)
- Create: `src/lib/__tests__/escolher-lote-revisao.test.ts`
- Modify: `src/pages/RevisaoIndex.tsx`

**Behavior:**

```ts
export function escolherLoteRevisao<T extends { id: string; status: string; totalErros: number; criadoEm: string }>(lotes: T[]): T | undefined
```

Order: (1) `status === 'revisao'`, newest `criadoEm`; (2) else `totalErros > 0`, newest `criadoEm`; (3) else `lotes[0]` (already newest-first from `fetchLotes`). Empty → `undefined`.

`RevisaoIndex`: `const alvo = escolherLoteRevisao(lotes);` then `Navigate to={`/revisao/${alvo.id}`}`.

Tests: newer concluido+0 errors vs older revisao → revisao; newer concluido+0 vs older concluido+erros → error lote; only successful → first.

---

### Task 5: Docs

**Files:**
- `docs/TASKS.md` (short dated entry)
- `docs/reference/edge-functions.md` (republicar paragraph: operacao CREATE + picture ids zerados; CREATE worker limpa cache em “does not exist”)
- `docs/how-to/operacoes-rotineiras.md` (Reenviar after picture-id error now re-uploads)

Do not write a new ADR. ADR-0016 already described CREATE as follow-up — this closes it in TASKS.

---

### Validation (mandatory before reporting done)

```
pnpm test -- supabase/functions/publish-familia-ml/__tests__/processar.test.ts supabase/functions/remover-publicado/__tests__/processar.test.ts supabase/functions/_shared/lote/__tests__/finalizar.test.ts src/lib/__tests__/escolher-lote-revisao.test.ts
pnpm lint
pnpm build
```

Do not commit. Report files changed + test/build output.
