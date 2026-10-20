# Marca própria configurável e marca por produto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Marca gravada no produto (`familias.marca`), definida no cadastro pelo Estoque (default = marca da org com marca própria), editável depois com envio imediato ao ML; marca própria e nome configuráveis na tela Organizações; planilha segue o FORNECEDOR.

**Architecture:** Coluna `familias.marca` é a fonte da BRAND. Regras puras em `_shared/categoria/marca-org.ts` (CREATE: marca→fornecedor→padrão; UPDATE: marca→fornecedor→não envia). Edição por edge `atualizar-marca-familia` → RPC transacional → worker `sincronizar-marca-ml` (lê a marca do produto, status durável, reagenda até o `family_id` convergir).

**Tech Stack:** Supabase (Postgres, Edge Functions Deno), QStash, React + TanStack Query + shadcn/Radix, vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-marca-por-produto-design.md`

## Global Constraints

- **NUNCA republicar.** Única escrita no ML nova: `PUT /items/{id} {attributes:[BRAND(,MANUFACTURER)]}` pelo worker.
- Migration só por `supabase migration new` + `supabase db push` (ADR-0043). Teste SQL por `scripts/teste-sql-desfeito.py`.
- Avil/orgs sem marca própria: saída idêntica (CREATE `fornecedor→marca_padrao→'Avil'`; UPDATE sem fornecedor não envia BRAND — ADR-0016).
- Planilha: CREATE grava `marca = null`; UPDATE copia `marca` e `atributos_ml` da família anterior (a marca do produto vence — Diego).
- Zaven `org_id = 'b95a1c97-8477-4e3a-89b8-04f735549072'`; backfill `familias.marca='Zaven'` só nela.
- Dropdown/switch: componentes `src/components/ui/*` (nunca `<select>` nativo).
- Revisão de diff: Codex `gpt-6.1-sol` high, read-only, `< /dev/null`.
- Mudança em `_shared/` → redeploy de todas as edges importadoras + conferir versão.

## Emenda — revisão Codex do plano (2026-10-20, vale por cima das tasks)

**Task 1 (migration):**
- **Default no banco (fecha a janela de rollout e o front antigo):** trigger `familias_marca_default` BEFORE INSERT:
  `new.marca is null` e lote `origem='manual'` e org com `marca_propria` → `new.marca = marca_padrao`. O cadastro
  só precisa mandar `marca` quando o usuário escolher outra.
- **BRAND dentro de `atributos_ml` protegido:** `familias_proteger_marca` (SECURITY INVOKER + `current_user in
  ('authenticated','anon')`, molde ADR-0135) recusa mudar `marca` **ou** os elementos BRAND/MANUFACTURER de
  `atributos_ml`. Dentro da RPC SECURITY DEFINER `current_user` é o dono → passa.
- **Versão da intenção:** `anuncios_externos.marca_sync_versao int not null default 0`; a RPC incrementa na raiz
  `particao=0` e devolve `{publicado, versao}`.
- **RPC fechada:** trava (`for update`) a raiz `particao=0` e as famílias; recusa `MARCA_OCUPADO` para
  `pendente|processando|publicando` e `mudando_composicao`; `MARCA_INEXISTENTE` se não há família do pai na org;
  status em **todas** as partições da raiz (mesmo `codigo_pai`); tudo numa transação (exception = rollback).
- **Testes SQL obrigatórios:** cada estado bloqueado (3) + `mudando_composicao`; rollback integral após recusa (marca,
  atributos, status iguais); múltiplos snapshots; família sem BRAND/`[]` intacta; pai inexistente; `authenticated`
  sem EXECUTE na RPC; `authenticated` mudando `marca`, BRAND em `atributos_ml`, `organizations.marca_propria/
  marca_padrao` → 42501; org B intocada; default do INSERT (Zaven manual sem marca → 'Zaven'; planilha → null;
  Avil → null).

**Task 3 (substituído pela Emenda 2 — herança no trigger):** ~~herança da planilha extraída para~~ `supabase/functions/ingest-lote/marca-herdada.ts`
(`herdarMarcaUpdate(ant: {marca, atributos_ml}): {marca, atributos_ml}`) com teste: anterior `{marca:'Lacoste',
BRAND=Lacoste}` + planilha FORNECEDOR='STAR' → nova linha `marca:'Lacoste'` e BRAND=Lacoste.

**Task 4:** inclui `src/components/estoque/dialog-cadastro-grade.tsx` (campo Marca, mesmo comportamento) e o
contrato espelhado `src/lib/produto-entrada.ts`; testes de payload dos dois formulários.

**Task 5 (worker):**
- Job `{org_id, codigo_pai, versao, dry_run?, tentativa?}`. Antes de cada PUT e antes de gravar status/reagendar,
  relê `marca_sync_versao`; se `!= job.versao` → para em silêncio (há job mais novo). `gravarStatus` é condicional
  (`where marca_sync_versao = versao`).
- **Convergindo ≠ erro:** todos os SKUs com a marca certa mas em 2 famílias → reagenda (não é `parouEm`).
  Divergência inesperada (marca errada em 2 famílias, 3ª família, id nulo) → `erro`.
- **Toda saída grava status:** erro transitório (leitura, gravar vínculo, sem conexão) → reagenda com orçamento
  (máx. 5, delay 120 s); orçamento esgotado ou falha ao reagendar → `erro` com motivo. `dry_run` não grava status
  nem reagenda.
- Testes: duas execuções sucessivas (2ª com zero PUT, grava `ok`); job com versão antiga não faz PUT nem status;
  convergindo → reagenda; transitório → reagenda; esgotado → `erro`; `dry_run` sem efeitos.

**Task 6:** gate `isAdmin || support.scope==='full'` + `auditarOperacaoSuporte` (molde `atualizar-status-publicado`);
enfileira com a `versao` devolvida. Testes: admin, membro (403), suporte read (403), suporte full (ok, auditado).

**Task 7:** teste no harness `supabase/functions/usuarios/__tests__/` (molde `arquivar-org.test.ts`): não-super-admin
→ 403; ligar sem nome → 400; sucesso grava e audita.

**Task 9 (ordem de rollout):** `db push` → deploy de **todas** as edges (cadastro, consumidores, worker, edição,
usuarios) a partir da branch → só então merge na `main` (Render publica o front). Validação de runtime inclui uma
reimportação por planilha de produto com marca (Lacoste) conferindo `familias.marca`, BRAND e o payload do UPDATE.

## Emenda 2 — 2ª rodada Codex (concorrência)

- **Serialização por produto (Task 1 + 5):** coluna `anuncios_externos.marca_sync_lease_ate timestamptz`; RPCs
  `adquirir_lease_marca(p_raiz uuid, p_ttl_s int) returns boolean` (UPDATE atômico `where lease is null or lease <
  now()`) e `liberar_lease_marca(p_raiz uuid)`, só `service_role`. O worker adquire antes de qualquer leitura/PUT
  (TTL 300 s > timeout da edge); sem lease → reagenda (30 s, não conta tentativa) e sai; libera em `finally`.
  Teste: duas execuções intercaladas (fake) — a 2ª não faz PUT enquanto a 1ª segura o lease.
- **Herança da planilha no banco (Task 1, substitui o helper da Task 3):** o trigger BEFORE INSERT
  `familias_marca_default` passa a: (a) se já existe família do mesmo (org, `codigo_pai`) → copia `marca` da mais
  recente lida com `for share` (espera edição em andamento) e, com marca não nula, reescreve BRAND/MANUFACTURER de
  `new.atributos_ml` para ela; (b) senão, lote `manual` + org com marca própria → `marca_padrao`. Teste SQL: família
  anterior `marca='Lacoste'` + INSERT de snapshot com `atributos_ml` BRAND=STAR → linha nova `marca='Lacoste'`,
  BRAND=Lacoste. A edição que chega depois encontra a linha `pendente` → `MARCA_OCUPADO`.

## Review Focus

1. Edição de marca enquanto o produto está `processando/publicando` → recusada com mensagem, nada gravado. (Task 1 SQL + Task 6)
2. Planilha reimportando produto com marca → marca e BRAND preservadas, FORNECEDOR novo ignorado. (Task 3)
3. Avil: UPDATE sem fornecedor e sem marca → `marca: null` no conector (não envia BRAND). (Task 3)
4. Worker após PUT com `family_id` ainda antigo → reagenda; esgotou 5 → `marca_sync_status='erro'`. (Task 5)
5. Org com marca própria e cliente antigo (sem campo `marca`) cadastrando → produto grava a marca da org. (Task 4)

---

### Task 1: ADR-0188 + migration (colunas, proteção, RPCs, backfill)

**Files:**
- Create: `docs/decisions/0188-marca-por-produto.md` (emenda ADR-0186; `git fetch` p/ confirmar número)
- Create: `supabase/migrations/<ts>_adr188_marca_por_produto.sql`
- Create: `supabase/tests/marca_por_produto.sql` (+ `marca_por_produto_antes.sql` se precisar de snapshot pré-migration, padrão de `supabase/tests/marca_propria_antes.sql`)
- Modify: `docs/reference/modelo-de-dados.md`, `src/lib/database.types.ts`

**Interfaces — Produces:**
- `familias.marca text null`
- `anuncios_externos.marca_sync_status text null check in ('pendente','ok','erro')`, `marca_sync_erro text null`, `marca_sync_em timestamptz null`
- Trigger `familias_proteger_marca` (BEFORE UPDATE): `authenticated/anon` mudando `marca` → 42501. Trigger `organizations_proteger_marca`: idem para `marca_propria`/`marca_padrao`.
- RPC `marca_da_org() returns jsonb` (security definer, `current_org_id()`): `{marca_propria boolean, marca_padrao text|null}`; grant execute a `authenticated`.
- RPC `gravar_marca_familia(p_org_id uuid, p_codigo_pai text, p_marca text) returns jsonb` (security definer, **só `service_role`**): trava (`for update`) todas as `familias` do (org, codigo_pai); se alguma em `('pendente','processando','publicando')` ou raiz UP com `mudando_composicao` → `raise exception 'MARCA_OCUPADO'`; grava `marca` e reescreve BRAND/MANUFACTURER de `atributos_ml` (`{id, value_name: p_marca}`, mesma reescrita do ADR-0186, só linhas que têm o atributo); se existe raiz `anuncios_externos` (canal ML, org, codigo_pai) → `marca_sync_status='pendente', marca_sync_erro=null, marca_sync_em=now()`. Retorna `{publicado boolean}`. `p_marca` vazia → exception.
- Backfill: `update familias set marca='Zaven' where org_id = Zaven` (assert: todas as linhas da Zaven vêm de lote `origem='manual'`; senão `raise`).

- [ ] **Step 1:** ADR-0188 — decisões do spec (marca no produto, duas regras CREATE/UPDATE, planilha, edição imediata, status durável, permissões, Legacy fora).
- [ ] **Step 2: Teste SQL (vermelho):** coluna existe; Zaven toda com `marca='Zaven'`; nenhuma outra org com `marca` não nula; `gravar_marca_familia(zaven,'00000064','Lacoste')` → todas as linhas do pai com `marca='Lacoste'` e BRAND `Lacoste` em `atributos_ml`, raiz com `marca_sync_status='pendente'`, retorno `publicado=true`; família de teste em `processando` → exception `MARCA_OCUPADO`; `set role authenticated` + update direto de `familias.marca` → 42501; `marca_da_org()` com `request.jwt.claims` da Zaven → `{"marca_propria": true, "marca_padrao": "Zaven"}`. Run: `python3 scripts/teste-sql-desfeito.py supabase/tests/marca_por_produto.sql` → FAIL.
- [ ] **Step 3:** Migration conforme Interfaces.
- [ ] **Step 4:** `python3 scripts/teste-sql-desfeito.py supabase/tests/marca_por_produto.sql supabase/migrations/<ts>_adr188_marca_por_produto.sql` → `PASSOU`; `npm run db:check` OK. Atualizar `database.types.ts` (colunas + RPCs).
- [ ] **Step 5: Commit** `feat(marca-produto): ADR-0188 + migration (marca no produto, proteção, RPCs, backfill Zaven)`.

---

### Task 2: Regras puras de marca

**Files:** Modify `supabase/functions/_shared/categoria/marca-org.ts`; Test `supabase/functions/_shared/categoria/__tests__/marca-org.test.ts`.

**Interfaces — Produces** (substituem `marcaDoProduto`/`forcarMarcaPropria`; `lerMarcaOrg`/`MarcaOrg` ficam):
- `export interface FamiliaMarca { marca?: string | null; fornecedor?: string | null }`
- `export function marcaParaCriacao(f: FamiliaMarca): string | undefined` — `marca?.trim() || fornecedor?.trim() || undefined` (o montador aplica `marcaPadrao`/`'Avil'` como já faz).
- `export function marcaParaUpdate(f: FamiliaMarca): string | null` — `marca?.trim() || fornecedor?.trim() || null`.
- `export function forcarMarcaDoProduto<T extends {id?: string; value_name?: string|null; value_id?: string|null}>(attrs: T[], marca: string | null | undefined): T[]` — sem marca → mesmo array; com marca → mesma regra do antigo `forcarMarcaPropria` (mantém item cujo nome já é a marca, com `value_id`).

- [ ] **Step 1: Testes (vermelho):** `marcaParaCriacao({marca:'Lacoste', fornecedor:'STAR'})='Lacoste'`; `({marca:null, fornecedor:' BUFALO '})='BUFALO'`; `({})=undefined`; `marcaParaUpdate({fornecedor:null})=null`; `marcaParaUpdate({marca:'Zaven', fornecedor:'X'})='Zaven'`; `forcarMarcaDoProduto([{id:'BRAND',value_name:'FEIRA',value_id:'9'}],'Zaven')` → `[{id:'BRAND',value_name:'Zaven'}]`; nome já igual com `value_id` → intacto; marca null → `toBe(mesmoArray)`. Run: `pnpm exec vitest run supabase/functions/_shared/categoria/__tests__/marca-org.test.ts` → FAIL.
- [ ] **Step 2:** Implementar; remover `marcaDoProduto`/`forcarMarcaPropria` (os chamadores mudam na Task 3 — compilar só depois dela).
- [ ] **Step 3:** mesmo comando → PASS. Commit junto da Task 3 (interfaces quebram o build sozinhas).

---

### Task 3: Pipeline lê a marca do produto

**Files (Modify)** — incluir `marca` nos selects e trocar a regra:
- `process-familia/index.ts` (~70 select; ~260-345): marca de montagem = `marcaParaCriacao(claimed)`, `marcaPadrao` da org; ao fim `atributosMl = forcarMarcaDoProduto(atributosMl, claimed.marca)`.
- `definir-categoria-familia/index.ts` (~59, ~70-95): `marcaParaCriacao(familia)`.
- `atributos-familia/index.ts` (~37, ~101): `merged = forcarMarcaDoProduto(merged, familia.marca)`.
- `criar-kit-vinculado/processar.ts` + `index.ts`: `deps.marcaOrg` → `deps.marcaPadrao?: string`; montagem com `marcaParaCriacao(base)`; `forcarMarcaDoProduto(atributosBase, base.marca)` nos dois ramos (sem override e após portabilidade). O clone do kit precisa carregar `marca` (conferir a lista de exclusão em `processar.ts:127`).
- `update-familia-ml/processar.ts` (~210, ~300): `marca = marcaParaUpdate(familia)`; passa `marcaProduto: familia.marca ?? null` ao UP.
- `publicar-split-ml/index.ts` (~212-232): `marcaParaUpdate(familia)`.
- `_shared/user-products/atualizar-familia-up.ts`: arg `marcaOrg` → `marcaProduto: string | null` (obrigatório no tipo, default `null` em runtime); `forcarMarcaDoProduto` nos mesmos dois pontos (ficha crua do irmão e `atributosFamiliaMl`).
- `reconciliar-convergencia-up/processar.ts` (~61, ~102): select `marca`, passa `marcaProduto: familia.marca ?? null`.
- `ingest-lote/index.ts` (~157 select, ~309 insert UPDATE): `marca: ant.marca`; CREATE não grava.
- `adicionar-variacoes-familia/processar.ts` (~505): conferir que o clone copia `marca`.
- Tests: atualizar os testes que usam `marcaOrg` (update-familia-ml, criar-kit-vinculado, atualizar-familia-up-ficha, reconciliar-convergencia-up) para `marcaProduto`/`marca` e adicionar:
  - update legado: família `{marca:'Lacoste', fornecedor:'STAR'}` → conector `marca:'Lacoste'`; Avil `{marca:null, fornecedor:null}` → `marca:null` (Review Focus 3).
  - kit: base `{marca:'Zaven', atributos_ml:[BRAND=FEIRA]}` → kit BRAND=Zaven (dois ramos).
  - UP cor nova: irmão BRAND=FEIRA + `marcaProduto:'Lacoste'` → BRAND=Lacoste; irmão `{BRAND, value_id:'777', value_name:'Zaven'}` + `marcaProduto:'Zaven'` → `{BRAND, value_id:'777'}`.
  - ingest UPDATE (Review Focus 2): se houver harness de `ingest-lote`, família anterior `{marca:'Lacoste'}` + planilha FORNECEDOR='STAR' → nova linha `marca:'Lacoste'`, `atributos_ml` copiado; sem harness → cobrir via teste SQL da Task 1 não se aplica; registrar Ruling e validar em runtime (Task 9).
- [ ] **Step 1:** testes (vermelho) → **Step 2:** implementar → **Step 3:** `pnpm exec vitest run supabase/functions` (pastas afetadas) PASS + `git add -A supabase` + `pnpm check:functions` + `pnpm lint:functions` → **Step 4: Commit** `feat(marca-produto): pipeline usa familias.marca (CREATE/UPDATE), planilha preserva a marca`.

---

### Task 4: Cadastro grava a marca

**Files:** Modify `supabase/functions/_shared/produto/validar.ts` (`ProdutoEntrada.marca?: string | null`; `montarLinhasProduto(..., opts: { marcaOrg: MarcaOrg })` grava `marca`), `supabase/functions/cadastrar-produto/index.ts|processar.ts` (lê `lerMarcaOrg`); tests existentes de `validar`/`cadastrar-produto`.

- Regra: org com `marcaPropria` → `marca = entrada.marca?.trim() || marcaPadrao`; sem marca própria → `marca = null` (ignora o campo).
- [ ] **Step 1: Testes (vermelho):** Zaven + `marca:'Lacoste'` → linha `marca:'Lacoste'`; Zaven sem `marca` (cliente antigo, Review Focus 5) → `'Zaven'`; Zaven `marca:'  '` → `'Zaven'`; Avil + `marca:'X'` → `null`.
- [ ] **Step 2-3:** implementar; testes PASS; check/lint. **Step 4: Commit** `feat(marca-produto): cadastro pelo Estoque grava a marca (default da org)`.

---

### Task 5: Worker `sincronizar-marca-ml` usa a marca do produto

**Files:** Modify `supabase/functions/sincronizar-marca-ml/processar.ts|index.ts`, tests.

**Interfaces:**
- Job: `{ org_id, codigo_pai, dry_run?, tentativa?: number }`.
- `DepsMarca` troca `lerMarcaOrg` por `lerMarcaAlvo(orgId, codigoPai): Promise<string | null>` (`familias.marca` da família com `publicado_em` mais recente, fallback `criado_em`) e ganha `gravarStatus(orgId, codigoPai, status: 'ok'|'erro'|'pendente', erro?: string)` e `reagendar(job, delaySeconds: number)`.
- Regras novas: marca alvo vazia → 400 + status `erro`. Sem filhos UP → status `erro` "anúncio Legacy: marca vai no próximo Atualizar" (200). Rodada com `corrigidos>0` e sem `parouEm` → `reagendar({...job, tentativa:(t??0)+1}, 120)` + status `pendente`. Rodada sem PUT e família unificada (gravou family_id) → status `ok`. `parouEm` → status `erro` com motivo. `tentativa >= 5` e ainda não unificada → status `erro` "família não convergiu".
- [ ] **Step 1: Testes (vermelho):** os existentes migrados para `lerMarcaAlvo` (alvo `'Zaven'`) + novos: alvo `'Lacoste'` com itens `Zaven` → PUT `Lacoste`; `corrigidos>0` → `reagendar` chamado com `tentativa:1, 120`; tudo certo e unificado → `gravarStatus('ok')`; `tentativa:5` com famílias divergentes → `gravarStatus('erro')` e sem `reagendar`; sem filhos → `gravarStatus('erro', /Legacy/)`; `parouEm` → `gravarStatus('erro', motivo)`.
- [ ] **Step 2-3:** implementar (`reagendar` = `qstashClient().publishJSON({url, body, delay, retries: 0})`); PASS; check/lint. **Step 4: Commit** `feat(marca-produto): worker sincroniza a marca do produto, status durável e reagendamento`.

---

### Task 6: Edge `atualizar-marca-familia`

**Files:** Create `supabase/functions/atualizar-marca-familia/index.ts` + `processar.ts` + `__tests__/processar.test.ts`; Modify `supabase/config.toml` (verify_jwt padrão), `_shared/queue.ts` (`enfileirarSincronizacaoMarca(orgId, codigoPai): Promise<string>`), `docs/reference/edge-functions.md`.

**Interfaces:** POST `{ codigo_pai: string, marca: string | null }` → `200 {ok:true, publicado:boolean, status:'pendente'|null}`; `409 {erro:'Produto em processamento/publicação — tente quando terminar.'}` em `MARCA_OCUPADO`; `403` não-admin; `400` org sem marca própria. `marca=null` → `marcaPadrao` da org.
- `processarAtualizacaoMarca(deps: { gravarMarca(orgId, codigoPai, marca) → {publicado}, enfileirar(orgId, codigoPai), gravarStatus(...) , lerMarcaOrg }, input: {orgId, isAdmin, codigoPai, marca})`.
- [ ] **Step 1: Testes (vermelho):** não-admin → 403 e nada gravado; org sem marca própria → 400; `marca:null` → grava `marcaPadrao`; publicado → `enfileirar` chamado; não publicado → não enfileira; `enfileirar` lança → `gravarStatus('erro', 'Falha ao enviar …')` e resposta 200 com `status:'erro'`; `gravarMarca` lança `MARCA_OCUPADO` → 409 (Review Focus 1); marca só espaços → 400.
- [ ] **Step 2-3:** implementar (`index.ts`: `requireUserOrg(req,{access:'write'})`, `isAdmin`, RPC `gravar_marca_familia` com service role); PASS; check/lint. **Step 4: Commit** `feat(marca-produto): edge atualizar-marca-familia`.

---

### Task 7: `usuarios` — `set_marca_org` + leitura

**Files:** Modify `supabase/functions/usuarios/index.ts` (`platformAction` inclui `set_marca_org`; `list_orgs` seleciona e devolve `marca_propria, marca_padrao`; case `set_marca_org` no molde de `set_tipo_pessoa_org`, com auditoria). Tests do `usuarios` se houver harness; senão extrair `validarMarcaOrg(body): {ok, marca_propria, marca_padrao} | {erro}` para `_shared/organizacao/marca.ts` com teste.

- Validação: `marca_propria` boolean obrigatório; `marca_padrao` aparado, ≤ 60 chars; ligar com `marca_padrao` vazia → 400 "Informe o nome da marca".
- [ ] Testes (vermelho) da validação → implementar → PASS → check/lint → **Commit** `feat(marca-produto): super-admin configura marca própria da org`.

---

### Task 8: Front

**Files:**
- Create `src/hooks/useMarcaOrg.ts` (`useQuery` → `supabase.rpc('marca_da_org')`, `QK.marcaOrg`).
- Modify `src/components/estoque/dialog-cadastro-produto.tsx` + `use-cadastro-produto.ts`: campo **Marca** ao lado de Fornecedor só se `marca_propria`; pré-preenchido com `marca_padrao`; obrigatório; enviado como `marca`.
- Modify `src/components/platform-admin/org-settings.tsx`: card "Marca própria" — `Switch` + `Input` "Nome da marca no ML" + Salvar → `set_marca_org`; tipo `OrgRow` ganha os campos.
- Create `src/components/estoque/dialog-editar-marca.tsx`: Input + botão "Usar a marca da org (X)" + Salvar → `supabase.functions.invoke('atualizar-marca-familia')`; mostra resultado (`Enviando ao Mercado Livre…` / erro 409).
- Modify `src/components/estoque/produto-card.tsx`: item "Editar marca" no menu (só `marca_propria` e admin); linha de status da marca quando `marca_sync_status` = `pendente` ("Enviando marca…") / `erro` (mensagem + "Reenviar", que chama a mesma edge com a marca atual). Fonte: query `familias.marca` (vigente) + `anuncios_externos.marca_sync_*` do `codigo_pai`.
- Tests (vitest + Testing Library, padrão `src/components/estoque/__tests__/`): campo Marca aparece pré-preenchido só com marca própria e vai no payload; diálogo "Usar a marca da org" envia `marca:null`; 409 mostra a mensagem; card mostra "Reenviar" com status `erro`; org-settings bloqueia salvar ligado sem nome.
- [ ] Testes (vermelho) → implementar → PASS → `pnpm preflight:static` → **Commit** `feat(marca-produto): UI — marca no cadastro, editar marca, config da org`.

---

### Task 9: Revisão, merge, deploy, validação

- [ ] `pnpm preflight` verde. Codex no diff da branch (rodada única); corrigir; preflight.
- [ ] Docs: `docs/TASKS.md`, `docs/reference/edge-functions.md`, `modelo-de-dados.md`, ADR-0186 aponta para 0188.
- [ ] Push → CI verde → fast-forward `main` → `git pull --ff-only` no checkout principal.
- [ ] `supabase db push` (link) → conferir pela Management API: `familias.marca` Zaven = 'Zaven' (todas), outras orgs null.
- [ ] Deploy: `process-familia`, `definir-categoria-familia`, `atributos-familia`, `criar-kit-vinculado`, `update-familia-ml`, `publicar-split-ml`, `reconciliar-convergencia-up`, `ingest-lote`, `adicionar-variacoes-familia` (se mudou), `cadastrar-produto`, `sincronizar-marca-ml`, `atualizar-marca-familia`, `usuarios` + importadores de `_shared/produto/validar.ts` (grep). Conferir versões.
- [ ] Runtime (só leitura no ML + 1 produto real escolhido pelo Diego): Editar marca → "Lacoste" → status `ok`, GET mostra BRAND=Lacoste, 1 `family_id`, status inalterado; "Usar a marca da org" → BRAND=Zaven. UI conferida com screenshot (skill playwright-cli, sessão isolada). Nunca republicar.
- [ ] Remover worktree/branch.
