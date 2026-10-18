# Marca própria por organização (Zaven) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Org com `marca_propria` nunca envia o fornecedor como BRAND/MANUFACTURER ao ML; os 7 anúncios UP já publicados da Zaven são corrigidos por uma ação nova `sincronizar-marca-ml` (PUT só de BRAND por SKU, com conferência), **sem republicar**.

**Architecture:** Coluna `organizations.marca_propria`. `_shared/categoria/marca-org.ts` concentra a política: decide a marca na montagem (`marcaDoProduto`) e a **impõe** sobre qualquer lista de atributos (`forcarMarcaPropria`) nos pontos que preservam/copiam/mesclam atributos. Worker novo `sincronizar-marca-ml` (QStash, molde `sincronizar-fiscal-ml`) converge SKU a SKU e para na 1ª divergência.

**Tech Stack:** Supabase Edge Functions (Deno/TS), Postgres (migration via CLI), QStash, vitest.

**Spec:** `docs/superpowers/specs/2026-10-18-marca-propria-zaven-design.md`

## Global Constraints

- Zaven: `id = 'b95a1c97-8477-4e3a-89b8-04f735549072'`, `marca_padrao = 'Zaven'`, conexão ML `8db34e23-d513-4d02-a305-a5efdac00816`. Só ela recebe `marca_propria = true`.
- Migration só por `supabase migration new` + `supabase db push` (ADR-0043).
- Avil e demais orgs (`marca_propria = false`): saída byte-a-byte igual à atual.
- **NUNCA republicar** (remover + publicar). Nenhum PUT manual no ML. O único escritor novo é `sincronizar-marca-ml`, que manda **só** `attributes` (BRAND, e MANUFACTURER se o item já o tiver) — nunca preço, estoque, fotos, descrição, título ou status.
- **Não** corrigir os 7 por planilha/"Atualizar tudo": os 7 têm grade (tamanho/gênero) e o `ingest-lote` perde `tamanho`/`genero` (`ingest-lote/index.ts:8`).
- Título e descrição: fora do escopo.
- Mudança em `_shared/` → redeploy de todas as edges importadoras + conferir versão.
- Revisão de diff: Codex `gpt-6.1-sol` high, read-only, `< /dev/null`; rodada única pré-merge.

## Review Focus

1. Org com `marca_propria = true` e `marca_padrao` vazio → `lerMarcaOrg` lança (nunca fornecedor nem `'Avil'`). Task 2.
2. Retry depois de falha parcial: SKU A já Zaven, SKU B ainda FEIRA → o sync pula A e corrige B (convergência por SKU, não delta de um irmão). Task 4.
3. Item com BRAND no ML **com `value_id`** de outra marca → é tratado como divergente e corrigido. Task 4.
4. `family_id` ou `status` muda depois do PUT → para imediatamente, não toca nos SKUs seguintes. Task 4.
5. `atributos_ml = []` ou sem BRAND na migration → linha intacta, sem erro de NOT NULL. Task 1.

---

### Task 1: ADR-0186 + migration (coluna, flag, data fix)

**Files:**
- Create: `docs/decisions/0186-marca-propria-por-organizacao.md` (`git fetch` antes; confirmar 0186 livre em `origin/main`)
- Create: `supabase/migrations/<ts>_adr186_marca_propria.sql` (via `supabase migration new adr186_marca_propria`)
- Create: `supabase/tests/marca_propria.sql`
- Modify: `docs/decisions/README.md`, `docs/reference/modelo-de-dados.md`

**Interfaces:**
- Produces: `organizations.marca_propria boolean not null default false`.

- [ ] **Step 1: ADR-0186** — contexto (print `MLBU5549781487`; regra `fornecedor || marca_padrao`), decisão (flag por org; `marcaDoProduto` + `forcarMarcaPropria`; worker `sincronizar-marca-ml`; título fora), consequências (Avil intacta; limite conhecido: o delta UP do "Atualizar tudo" continua medido em 1 irmão — reparo = rodar `sincronizar-marca-ml`), proibição de republicar. Relaciona ADR-0016, 0088, 0135, 0157, D-E7.3.
- [ ] **Step 2: Teste SQL (vermelho)** `supabase/tests/marca_propria.sql`, padrão de `supabase/tests/vitrine.sql`:
  - `marca_propria` = true na Zaven; `count(*) filter (where marca_propria)` = 1.
  - Nenhum elemento BRAND/MANUFACTURER em `familias.atributos_ml` da Zaven com `value_name <> 'Zaven'` ou com chave `value_id`/`values`.
  - Demais atributos das famílias da Zaven preservados: `md5` do array **sem** BRAND/MANUFACTURER igual ao literal capturado antes (query read-only colada no teste).
  - `md5(string_agg(atributos_ml::text, '' order by id))` das famílias **fora** da Zaven = literal capturado antes.
  - Inserir 2 famílias de teste da Zaven: uma com `atributos_ml = '[]'`, outra sem BRAND → continuam idênticas.
  - Run: `python3 scripts/teste-sql-desfeito.py supabase/tests/marca_propria.sql` → FAIL (coluna inexistente).
- [ ] **Step 3: Migration**
  - `alter table public.organizations add column marca_propria boolean not null default false;` + `comment` citando ADR-0186.
  - `do $$` que faz o `update ... set marca_propria = true where id = 'b95a1c97-…' and btrim(coalesce(marca_padrao,'')) <> ''` e `raise exception` se `row_count <> 1`.
  - Data fix só em linhas com o atributo: `where org_id = Zaven and exists (select 1 from jsonb_array_elements(atributos_ml) e where e->>'id' in ('BRAND','MANUFACTURER'))`; reescrita com `jsonb_agg(case when e->>'id' in ('BRAND','MANUFACTURER') then jsonb_build_object('id', e->>'id', 'value_name', 'Zaven') else e end order by ord)` sobre `jsonb_array_elements(...) with ordinality`.
  - Obs.: a migration roda **depois** do teste do Step 2 por causa da ordem de colagem do teste; ver docstring de `scripts/teste-sql-desfeito.py`.
- [ ] **Step 4: Verde** — `python3 scripts/teste-sql-desfeito.py supabase/tests/marca_propria.sql supabase/migrations/<ts>_adr186_marca_propria.sql` → `TESTE_OK`; `npm run db:check` → OK.
- [ ] **Step 5: Commit** — `feat(marca-propria): ADR-0186 + migration da flag e data fix da Zaven`.

---

### Task 2: Política em `marca-org.ts`

**Files:**
- Create: `supabase/functions/_shared/categoria/marca-org.ts`
- Test: `supabase/functions/_shared/categoria/__tests__/marca-org.test.ts`

**Interfaces:**
- Produces:
  - `export interface MarcaOrg { marcaPadrao?: string; marcaPropria: boolean }`
  - `export async function lerMarcaOrg(admin: SupabaseClient, orgId: string): Promise<MarcaOrg>` — `select('marca_padrao, marca_propria')`; erro → lança; `marcaPropria && !marcaPadrao?.trim()` → lança `Error('Organização com marca própria sem marca_padrao')`.
  - `export function marcaDoProduto(fornecedor: string | null | undefined, org: MarcaOrg): string | undefined` — `marcaPropria` → `marcaPadrao`; senão `fornecedor?.trim() || undefined`.
  - `export function forcarMarcaPropria<T extends { id: string; value_name?: string | null; value_id?: string | null }>(attrs: T[], org: MarcaOrg): T[]` — sem `marcaPropria` → devolve **o mesmo array**; com → troca BRAND/MANUFACTURER existentes por `{ id, value_name: marcaPadrao }` (sem `value_id`/`values`), ordem preservada; não adiciona atributo ausente.
- [ ] **Step 1: Testes (vermelho)**
  - `marcaDoProduto('STAR GLAMOUR', zaven)` → `'Zaven'`; `marcaDoProduto(null, zaven)` → `'Zaven'`; `marcaDoProduto(' BUFALO ', avil)` → `'BUFALO'`; `marcaDoProduto('  ', avil)` → `undefined`.
  - `forcarMarcaPropria([{id:'BRAND',value_name:'FEIRA',value_id:'9'},{id:'COLOR',value_name:'Azul'}], zaven)` → `[{id:'BRAND',value_name:'Zaven'},{id:'COLOR',value_name:'Azul'}]`; com `avil` → `toBe(mesmoArray)`; `[]` → `[]`.
  - `lerMarcaOrg`: `{marca_padrao:'Zaven',marca_propria:true}` → ok; `{marca_padrao:null,marca_propria:false}` → `{marcaPadrao:undefined,marcaPropria:false}`; `{marca_padrao:' ',marca_propria:true}` → rejeita; `{error}` → rejeita.
  - Run: `pnpm test -- supabase/functions/_shared/categoria/__tests__/marca-org.test.ts` → FAIL.
- [ ] **Step 2: Implementar.** **Step 3:** mesmo comando → PASS. **Step 4: Commit** `feat(marca-propria): política marca-org`.

---

### Task 3: Aplicar a política em todos os caminhos de montagem/cópia

**Files (Modify)** — em cada um, ler a org com `lerMarcaOrg` (substitui o `select('marca_padrao')` existente) e:
- `process-familia/index.ts:260-264,300-345` — `marca = marcaDoProduto(claimed.fornecedor, org)` nas chamadas de `montarAtributosML` / `resolverAtributosGenericos` (`fornecedor: marca`, `marcaPadrao: org.marcaPadrao`); depois de `atributosMl` final (**inclusive** o ramo preservado de `atributos_editados_pelo_operador`), `atributosMl = forcarMarcaPropria(atributosMl, org)`. Não mexer em `diagnosticarTitulo` (:514).
- `definir-categoria-familia/index.ts:70-95` — idem + `forcarMarcaPropria` no resultado.
- `atributos-familia/index.ts:101` — `merged = forcarMarcaPropria(merged, org)` antes do update (operador da Zaven não grava outra marca).
- `criar-kit-vinculado/index.ts:148-167` + `processar.ts:81,402-470` — `deps.marcaPadrao` → `deps.marcaOrg: MarcaOrg` carregado **sempre**; montagem com `marcaDoProduto(base.fornecedor, deps.marcaOrg)` / `deps.marcaOrg.marcaPadrao`; `atributosBase = forcarMarcaPropria(atributosBase, deps.marcaOrg)` **depois** da portabilidade (:461) e no ramo sem override (:402).
- `update-familia-ml/processar.ts:291` — `marca = marcaDoProduto(familia.fornecedor, org) ?? null`.
- `publicar-split-ml/index.ts:212` — idem. Não mexer no título da partição (:248).
- `_shared/user-products/atualizar-familia-up.ts` — ler org; `atributosFamilia` passado à saga (:582) e o resultado de `mesclarAtributos` (cor nova herdando do irmão) passam por `forcarMarcaPropria`.
- Comentários "BRAND (do fornecedor)" em `_shared/canais/mercado-livre.ts:309` e `contrato.ts:166` → "marca decidida por `marcaDoProduto` (ADR-0186)".
- Tests: `update-familia-ml/__tests__/processar.test.ts`, `criar-kit-vinculado/__tests__/processar.test.ts`, teste existente de `atualizar-familia-up`/`atributos-irmao` em `_shared/user-products/__tests__/`, e `atributos-familia` se houver teste (senão cobrir via `forcarMarcaPropria`).

**Interfaces:** Consumes `lerMarcaOrg`, `marcaDoProduto`, `forcarMarcaPropria`, `MarcaOrg` (Task 2).

- [ ] **Step 1: Testes (vermelho)**
  - UPDATE legado: Zaven + fornecedor `'STAR GLAMOUR'` → conector recebe `marca: 'Zaven'`; Zaven + fornecedor `null` → `'Zaven'`; Avil + fornecedor `null` → `marca: null`.
  - Kit: `marcaOrg` Zaven, base fornecedor `'FEIRA'` e `atributos_ml` com `BRAND=FEIRA` → kit com `BRAND=Zaven` nos dois ramos (com/sem `categoriaOverride`); `marcaOrg` Avil → igual ao atual.
  - UP cor nova: irmão com `BRAND=FEIRA` + org Zaven → payload da cor nova com `BRAND=Zaven`; org Avil → irmão vence (comportamento ADR-0088 intacto).
  - Run: `pnpm test -- update-familia-ml criar-kit-vinculado user-products categoria` → FAIL nos novos.
- [ ] **Step 2: Implementar.** **Step 3:** mesmo comando → PASS; `pnpm preflight:static` → OK.
- [ ] **Step 4: Commit** `feat(marca-propria): política aplicada em montagem, kit, edição e UP`.

---

### Task 4: Worker `sincronizar-marca-ml`

**Files:**
- Create: `supabase/functions/sincronizar-marca-ml/index.ts` (casca: assinatura QStash + injeção, molde `sincronizar-fiscal-ml/index.ts`)
- Create: `supabase/functions/sincronizar-marca-ml/processar.ts`
- Test: `supabase/functions/sincronizar-marca-ml/__tests__/processar.test.ts`
- Modify: `supabase/config.toml` (`[functions.sincronizar-marca-ml] verify_jwt = false`), `_shared/queue.ts` (`SincronizarMarcaJob`), `docs/reference/edge-functions.md`

**Interfaces:**
- Consumes: `lerMarcaOrg` (Task 2).
- Produces:
  - `export interface SincronizarMarcaJob { org_id: string; codigo_pai: string; dry_run?: boolean }`
  - `export interface PortasMarca { listarFilhos(orgId, codigoPai): Promise<{ sku: string; itemId: string }[]>; lerItem(itemId): Promise<{ status: string; familyId: string | null; attrs: { id: string; value_id?: string | null; value_name?: string | null }[] }>; putAtributos(itemId, attrs: { id: string; value_name: string }[]): Promise<void> }`
  - `export async function processarSincronizacaoMarca(deps: { admin; portas: PortasMarca }, job: SincronizarMarcaJob): Promise<{ status: number; body: ResultadoMarca }>`
  - `type ResultadoMarca = { corrigidos: string[]; jaCertos: string[]; parouEm?: { sku: string; motivo: string } ; dryRun: boolean }`

Regras (o algoritmo que os testes fixam):
1. `org = lerMarcaOrg`; `!org.marcaPropria` → 400 (nada é lido do ML).
2. `listarFilhos` = `anuncios_externos_itens` não retirados com `item_externo_id`, do `anuncios_externos` (org, canal `mercado_livre`, `codigo_pai`). Vazio → 400.
3. Lê **todos** os itens antes de qualquer PUT; algum `familyId` **ausente/null** ou diferente entre eles → para (`motivo: 'family_id ausente ou divergente antes'`), nenhum PUT. Na releitura, `familyId` null também conta como divergência.
4. Por SKU, em ordem: "certo" = BRAND com `value_name` igual (trim, sem caixa) a `marcaPadrao` **e sem `value_id`** de outra marca, e MANUFACTURER ausente ou igual. Certo → `jaCertos`. Senão, se `dry_run` → lista em `corrigidos` sem PUT; senão `putAtributos(itemId, [{BRAND}, ...(MANUFACTURER presente ? [{MANUFACTURER}] : [])])`, relê e exige BRAND certo **e** `familyId` igual ao inicial **e** `status` igual ao inicial; falhou qualquer um → `parouEm` e **retorna sem tocar os SKUs seguintes** (status 200 com corpo, sem retry do QStash).
5. Erro do PUT (ex.: ML recusa item pausado) → `parouEm` com a mensagem do ML; 200 (não retenta sozinho).
6. Erro de leitura (rede) antes de qualquer PUT → 500 (QStash retenta; idempotente pela regra 4).

- [ ] **Step 1: Testes (vermelho)** com portas em memória:
  - org Avil → 400, `lerItem` não chamado.
  - 3 SKUs `FEIRA` → 3 PUTs com `[{id:'BRAND',value_name:'Zaven'}]`, `corrigidos` = 3.
  - SKU A já `Zaven`, B `FEIRA` → só B recebe PUT (Review Focus 2).
  - BRAND `{value_name:'Zaven Store', value_id:'123'}` → divergente, recebe PUT (Review Focus 3).
  - item com MANUFACTURER `FEIRA` → PUT inclui `{id:'MANUFACTURER',value_name:'Zaven'}`.
  - releitura com `familyId` diferente após o 1º PUT → `parouEm.sku` = 1º SKU, 2º SKU sem PUT (Review Focus 4); idem `status` `paused`→`active`.
  - `familyId` divergente antes → zero PUT; `familyId` null em qualquer item antes → zero PUT; `familyId` null na releitura → `parouEm`.
  - `dry_run: true` → zero PUT, `corrigidos` listados.
  - Run: `pnpm test -- sincronizar-marca-ml` → FAIL.
- [ ] **Step 2: Implementar** `processar.ts` + `index.ts` (portas reais: `resolverConexao` + `getValidAccessTokenConexao`; `lerItem` = `GET /items/{id}?attributes=id,status,family_id,attributes` (mesmo campo pedido em `_shared/ml/buscar-item.ts:120`; conferir no retorno real com `scripts/ops/ml-get.ts` antes); `putAtributos` = `PUT /items/{id}` body `{ attributes }`).
- [ ] **Step 3:** `pnpm test -- sincronizar-marca-ml` → PASS; `pnpm preflight:static` → OK.
- [ ] **Step 4: Commit** `feat(marca-propria): worker sincronizar-marca-ml (só BRAND, para na 1ª divergência)`.

---

### Task 5: Revisão, merge e deploy

- [ ] `pnpm preflight` → verde.
- [ ] Codex (gpt-6.1-sol high, read-only, `< /dev/null`) no diff da branch; corrigir achados; teste + preflight.
- [ ] Docs (`docs-update-checklist`): `docs/TASKS.md`, `docs/reference/edge-functions.md`, `modelo-de-dados.md`. Commit.
- [ ] Push → CI verde (`frontend`, `backend-lint`) → fast-forward na `main` (`push origin <sha>:main`).
- [ ] `supabase db push` (com link) → conferir pela Management API: `marca_propria` só na Zaven; BRAND das famílias da Zaven = Zaven.
- [ ] Deploy: `sincronizar-marca-ml` + todas as edges que importam arquivos alterados (no mínimo `process-familia`, `definir-categoria-familia`, `atributos-familia`, `criar-kit-vinculado`, `update-familia-ml`, `publicar-split-ml`, e quem importar `atualizar-familia-up.ts` — listar por grep). Conferir versões novas ativas.
- [ ] Remover worktree e branch.

---

### Task 6: Corrigir os 7 anúncios (sem republicar)

Ordem: `00000064` sozinho; depois `00000105`, `00000112`, `00000119`, `00000043`, `00000010`, `00000069` — um por vez.

- [ ] **Step 1:** publicar no QStash `{ org_id: Zaven, codigo_pai: '00000064', dry_run: true }` para `sincronizar-marca-ml` → conferir `corrigidos` = 4, `parouEm` ausente.
- [ ] **Step 2:** mesmo job com `dry_run: false` → esperado `corrigidos` = 4, sem `parouEm`.
- [ ] **Step 3:** conferência independente com `scripts/ops/ml-get.ts` nos 4: BRAND=Zaven, `status=paused`, 1 `family_id`. Repetir ~30 min depois.
- [ ] **Step 4a — qualquer SKU que não esteja `paused` ao fim (inclusive reativação inesperada após PUT, `parouEm` por status):** pausar **pelo app** imediatamente e confirmar `paused` por SKU via `ml-get.ts` antes de encerrar ou reportar; reconferir após 30 min.
- [ ] **Step 4 — se `parouEm` por item pausado:** reativar **pelo app** (Publicados → Reativar, ADR-0060), rodar o job de novo, e **pausar de novo pelo app em qualquer desfecho** (sucesso ou erro); confirmar `paused` por SKU via `ml-get.ts`, e de novo após 30 min. Qualquer outro `parouEm` (family_id, status, recusa) → parar e reportar ao Diego. **Nunca republicar.**
- [ ] **Step 5:** OK do `00000064` → repetir Steps 1–4 nas outras 6, uma por vez.
- [ ] **Step 6:** relatório ao Diego: 109 SKUs com BRAND=Zaven, 7 `family_id` intactos, todos `paused`.
