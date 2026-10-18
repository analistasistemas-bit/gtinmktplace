# Marca própria por organização (Zaven) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Org com `marca_propria` publica/atualiza BRAND/MANUFACTURER no ML sempre com `marca_padrao` (Zaven), nunca com o fornecedor; corrigir os 7 anúncios UP já publicados sem republicar.

**Architecture:** Coluna `organizations.marca_propria`. Um helper em `_shared/categoria/marca-org.ts` lê a org e decide a string "marca" que cada ponto de chamada já passava (hoje o fornecedor). `montarAtributosML/Base` não mudam. Data fix no `familias.atributos_ml` da Zaven + "Atualizar tudo" pelo fluxo normal leva o delta (ADR-0157) ao ML.

**Tech Stack:** Supabase Edge Functions (Deno/TS), Postgres (migration via CLI), vitest.

**Spec:** `docs/superpowers/specs/2026-10-18-marca-propria-zaven-design.md`

## Global Constraints

- Zaven: `id = 'b95a1c97-8477-4e3a-89b8-04f735549072'`, `marca_padrao = 'Zaven'`. Só ela recebe `marca_propria = true`.
- Migration só por `supabase migration new` + `supabase db push` (ADR-0043). Nunca DDL pela Management API.
- Avil e demais orgs: comportamento idêntico ao atual (fornecedor = marca; sem fornecedor → `marca_padrao` → `'Avil'`).
- **NUNCA republicar** os anúncios da Zaven (remover + publicar). Nenhum PUT manual no ML. Despausar/repausar só pelo app.
- Título e descrição: fora do escopo (não mexer em `diagnosticarTitulo` / `regenerar-copy-familia`).
- Mudança em `_shared/` → redeploy de todas as edges afetadas + conferir versão (CLAUDE.md).
- Revisão de diff: Codex `gpt-6.1-sol` high, read-only, `< /dev/null` (memória do Diego). Fallback Kimi.

## Review Focus

1. Org com `marca_propria = true` e `marca_padrao` nulo/vazio → `lerMarcaOrg` lança erro (nunca cai no fornecedor nem em `'Avil'`). Teste na Task 2.
2. Família da Zaven **sem** fornecedor no UPDATE legado → ainda manda BRAND=Zaven (hoje não manda nada). Teste na Task 3.
3. Avil sem fornecedor no UPDATE legado → continua **não** enviando BRAND. Teste na Task 3.
4. Data fix toca só BRAND/MANUFACTURER das famílias da Zaven; atributo com `value_id`/`values` nesses ids perde esses campos (senão o ML usaria o id antigo). Teste SQL na Task 1.
5. `comGeneroDaFamilia` (grade) não descarta BRAND do delta UP. Teste na Task 3.

---

### Task 1: ADR-0186 + migration (coluna, flag da Zaven, data fix)

**Files:**
- Create: `docs/decisions/0186-marca-propria-por-organizacao.md` (rodar `git fetch` e conferir que 0186 está livre em `origin/main`)
- Create: `supabase/migrations/<timestamp>_adr186_marca_propria.sql` (via `supabase migration new adr186_marca_propria`)
- Create: `supabase/tests/marca_propria.sql`
- Modify: `docs/decisions/README.md` (índice), `docs/reference/modelo-de-dados.md` (coluna nova)

**Interfaces:**
- Produces: `organizations.marca_propria boolean not null default false`.

- [ ] **Step 1: ADR-0186** — contexto (print `MLBU5549781487`, regra `fornecedor || marca_padrao`), decisão (flag por org, helper único, data fix, título fora), consequências (Avil intacta; UPDATE legado da Zaven passa a sempre mandar BRAND), regra "nunca republicar". Relaciona ADR-0016, 0088, 0157, D-E7.3.

- [ ] **Step 2: Teste SQL (vermelho)** em `supabase/tests/marca_propria.sql`, no padrão de `supabase/tests/vitrine.sql`:
  - `select marca_propria from organizations where id='b95a1c97-…'` = true; `count(*) where marca_propria` = 1.
  - Nenhuma família da Zaven com `atributos_ml` contendo BRAND/MANUFACTURER ≠ `'Zaven'`.
  - Nenhum BRAND/MANUFACTURER da Zaven com `value_id` ou `values`.
  - `md5(string_agg(atributos_ml::text, '' order by id))` das famílias **fora** da Zaven igual ao valor capturado antes (guardar em temp table no início do teste, antes das migrations? → o script aplica as migrations antes do corpo; então capturar o md5 de `org_id <> Zaven` via query read-only ANTES e colar o literal no teste).
  - Run: `python3 scripts/teste-sql-desfeito.py supabase/tests/marca_propria.sql` → Expected: FAIL (coluna não existe).

- [ ] **Step 3: Migration**
  - `alter table public.organizations add column marca_propria boolean not null default false;`
  - `update … set marca_propria = true where id = 'b95a1c97-…' and marca_padrao is not null and btrim(marca_padrao) <> ''`; `get diagnostics` num `do $$` e `raise exception` se ≠ 1 linha.
  - Data fix: para `familias where org_id = Zaven and atributos_ml is not null`, reescrever o array: elementos com `id in ('BRAND','MANUFACTURER')` → `jsonb_build_object('id', id, 'value_name', 'Zaven')` (descarta `value_id`/`values`); demais intactos, ordem preservada (`jsonb_agg(... order by ordinality)`).
  - Comentário na coluna citando ADR-0186.

- [ ] **Step 4: Verde** — Run: `python3 scripts/teste-sql-desfeito.py supabase/tests/marca_propria.sql supabase/migrations/<arquivo>.sql` → Expected: `TESTE_OK`. Run: `npm run db:check` → OK.

- [ ] **Step 5: Commit** — `feat(marca-propria): ADR-0186 + migration da flag e data fix da Zaven`. (O `db push` é na Task 4, depois do merge.)

---

### Task 2: Helper `marca-org.ts`

**Files:**
- Create: `supabase/functions/_shared/categoria/marca-org.ts`
- Test: `supabase/functions/_shared/categoria/__tests__/marca-org.test.ts`

**Interfaces:**
- Produces:
  - `export interface MarcaOrg { marcaPadrao?: string; marcaPropria: boolean }`
  - `export async function lerMarcaOrg(admin: SupabaseClient, orgId: string): Promise<MarcaOrg>` — `select('marca_padrao, marca_propria')`; erro de leitura → lança; `marcaPropria && !marcaPadrao?.trim()` → lança `Error('Organização com marca própria sem marca_padrao')`.
  - `export function marcaDoProduto(fornecedor: string | null | undefined, org: MarcaOrg): string | undefined` — `org.marcaPropria` → `org.marcaPadrao`; senão `fornecedor?.trim() || undefined`.

- [ ] **Step 1: Testes (vermelho)**
  - `marcaDoProduto('STAR GLAMOUR', { marcaPadrao: 'Zaven', marcaPropria: true })` → `'Zaven'`
  - `marcaDoProduto(null, { marcaPadrao: 'Zaven', marcaPropria: true })` → `'Zaven'`
  - `marcaDoProduto(' BUFALO ', { marcaPadrao: 'Avil', marcaPropria: false })` → `'BUFALO'`
  - `marcaDoProduto('  ', { marcaPadrao: 'Avil', marcaPropria: false })` → `undefined`
  - `lerMarcaOrg` com mock `{ marca_padrao: 'Zaven', marca_propria: true }` → `{ marcaPadrao: 'Zaven', marcaPropria: true }`; com `{ marca_padrao: null, marca_propria: false }` → `{ marcaPadrao: undefined, marcaPropria: false }`; com `{ marca_padrao: ' ', marca_propria: true }` → rejeita; com `{ error }` → rejeita.
  - Run: `pnpm test -- supabase/functions/_shared/categoria/__tests__/marca-org.test.ts` → FAIL.
- [ ] **Step 2: Implementar** em `marca-org.ts` (mock do client no estilo dos testes existentes de `update-familia-ml/__tests__/processar.test.ts`).
- [ ] **Step 3: Verde** — mesmo comando → PASS.
- [ ] **Step 4: Commit** — `feat(marca-propria): helper lerMarcaOrg/marcaDoProduto`.

---

### Task 3: Ligar o helper em todos os pontos de chamada

**Files (Modify):**
- `supabase/functions/process-familia/index.ts:260-264` — trocar o select de `marca_padrao` por `const org = await lerMarcaOrg(admin, orgId)`; `const marca = marcaDoProduto(claimed.fornecedor, org)`; passar `marca` em `montarAtributosML` (~310) e em `resolverAtributosGenericos(..., { ..., fornecedor: marca }, ..., org.marcaPadrao)` (~331). **Não** mexer em `fornecedor` do `diagnosticarTitulo` (~514).
- `supabase/functions/definir-categoria-familia/index.ts:70-95` — idem (`montarAtributosML` e `resolverAtributosGenericos`).
- `supabase/functions/criar-kit-vinculado/index.ts:148-167` + `processar.ts:81,415,428` — `deps.marcaPadrao` vira `deps.marcaOrg?: MarcaOrg` (lido só quando `categoriaOverride`, como hoje); em `processar.ts` a marca passa a ser `deps.marcaOrg ? marcaDoProduto(base.fornecedor, deps.marcaOrg) : base.fornecedor ?? undefined` e o fallback `deps.marcaOrg?.marcaPadrao`.
- `supabase/functions/update-familia-ml/processar.ts:291` — `const marca = marcaDoProduto(familia.fornecedor, await lerMarcaOrg(admin, familia.org_id)) ?? null`.
- `supabase/functions/publicar-split-ml/index.ts:212` — idem. **Não** mexer no `fornecedor` do título da partição (:248).
- Atualizar comentários "BRAND (do fornecedor)" em `_shared/canais/mercado-livre.ts:309` e `contrato.ts:166` para "da marca decidida por `marcaDoProduto` (ADR-0186)".
- Tests: `supabase/functions/update-familia-ml/__tests__/processar.test.ts`, `supabase/functions/criar-kit-vinculado/__tests__/processar.test.ts`, `supabase/functions/_shared/user-products/__tests__/` (arquivo existente de `atributos-divergentes`/`comGeneroDaFamilia`).

**Interfaces:**
- Consumes: `lerMarcaOrg`, `marcaDoProduto`, `MarcaOrg` (Task 2).

- [ ] **Step 1: Testes (vermelho)**
  - `update-familia-ml processar`: org mock `{ marca_padrao: 'Zaven', marca_propria: true }`, fornecedor `'STAR GLAMOUR'` → a chamada ao conector recebe `marca: 'Zaven'`; fornecedor `null` → `marca: 'Zaven'`; org `{ marca_padrao: 'Avil', marca_propria: false }` + fornecedor `null` → `marca: null` (Review Focus 3).
  - `criar-kit-vinculado processar`: `marcaOrg: { marcaPadrao: 'Zaven', marcaPropria: true }`, base com fornecedor `'FEIRA'` → `atributos_ml` do kit tem `BRAND = 'Zaven'`; sem `marcaOrg` → comportamento atual (fornecedor).
  - Delta UP: `atributosDivergentes(comGeneroDaFamilia([{id:'BRAND',value_name:'Zaven'}, …grade]), [{id:'BRAND',value_name:'STAR GLAMOUR'}])` contém `{id:'BRAND', value_name:'Zaven'}` (Review Focus 5).
  - Run: `pnpm test -- update-familia-ml criar-kit-vinculado user-products` → FAIL nos novos.
- [ ] **Step 2: Implementar** as trocas listadas acima.
- [ ] **Step 3: Verde + estático** — `pnpm test -- update-familia-ml criar-kit-vinculado user-products categoria` → PASS; `pnpm preflight:static` → OK.
- [ ] **Step 4: Commit** — `feat(marca-propria): BRAND/MANUFACTURER pela marca da org em todos os caminhos`.

---

### Task 4: Revisão, merge e deploy

- [ ] **Step 1:** `pnpm preflight` (completo) → verde.
- [ ] **Step 2:** Revisão Codex do diff da branch (`codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s read-only … < /dev/null`), rodada única; corrigir achados; teste + preflight.
- [ ] **Step 3:** Docs: `docs/TASKS.md`, `docs/reference/edge-functions.md` se aplicável (skill `docs-update-checklist`). Commit.
- [ ] **Step 4:** Push da branch → CI verde (`frontend`, `backend-lint`) → fast-forward na `main` (`push origin <sha>:main`).
- [ ] **Step 5:** `supabase db push` (com link) → conferir `select marca_propria …` = true só na Zaven e BRAND das famílias da Zaven = Zaven (Management API, read-only).
- [ ] **Step 6:** Deploy de todas as edges que importam `_shared/categoria/marca-org.ts` ou os arquivos alterados: no mínimo `process-familia`, `definir-categoria-familia`, `criar-kit-vinculado`, `update-familia-ml`, `publicar-split-ml` (listar importadores com grep em `supabase/functions/*/index.ts`). Conferir versão nova ativa de cada uma (`supabase functions list`).
- [ ] **Step 7:** Remover worktree e branch.

---

### Task 5: Corrigir os 7 anúncios (sem republicar)

Ordem: `00000064` (4 SKUs) sozinho primeiro; depois `00000105`, `00000112`, `00000119`, `00000043`, `00000010`, `00000069`.

- [ ] **Step 1 (guard):** para a família, conferir que os SKUs das variações vigentes = os filhos em `anuncios_externos_itens` (sem cor nova/removida). Divergiu → parar e voltar ao Diego (descrição seria reenviada / cor criada com foto).
- [ ] **Step 2 (gatilho — Diego):** subir planilha só com o PAI → Revisão → Publicar **"Atualizar tudo"** (sem "somente estoque"). É a revisão humana obrigatória antes de publicar.
- [ ] **Step 3 (conferir na hora):** `scripts/ops/ml-get.ts 8db34e23-d513-4d02-a305-a5efdac00816 "/items/<id>?attributes=id,status,attributes"` em todos os filhos: BRAND = `Zaven`, status `paused`; `GET /user-products/<user_product_id>` → 1 `family_id` para todos.
  - Se o ML recusou o PUT por estar pausado: reativar pelo app (Publicados → Reativar, ADR-0060), repetir Step 2, e **pausar de novo pelo app** logo em seguida; reconferir `paused`.
  - Se recusou por outro motivo ou desagrupou: **parar**, sem republicar, e reportar ao Diego com o erro.
- [ ] **Step 4 (~30 min depois):** repetir o GET; BRAND continua `Zaven`.
- [ ] **Step 5:** repetir Steps 1–4 nas outras 6 famílias (podem ir juntas numa planilha só, depois do `00000064` aprovado).
- [ ] **Step 6:** relatório final ao Diego: 109 SKUs com BRAND=Zaven, 7 `family_id` intactos, todos `paused`.
