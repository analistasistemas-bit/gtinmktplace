# NCM validado na tabela oficial — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NCM inexistente ou vencido nunca entra no cadastro fiscal nem chega ao ML; o operador vê a descrição oficial do NCM ao digitar.

**Architecture:** Tabela global `ncm_oficial` (carga do Siscomex dentro de uma migration aditiva) + função SQL `ncm_consultar(text[])` como regra única de vigência; helper de edge `ncmsInvalidos` em todo ponto de escrita/cópia/envio; o form fiscal consulta a mesma função e mostra a descrição; FK `NOT VALID` em `familias.ncm` numa **segunda** migration, aplicada só depois que edges e front novos estão no ar.

**Tech Stack:** Postgres/Supabase (migration via CLI), Deno Edge Functions, React + TS (vitest + @testing-library/user-event), script TS em `scripts/ncm/` (`npx tsx`).

**Spec:** `docs/superpowers/specs/2026-10-19-ncm-tabela-oficial-design.md`

## Global Constraints

- Fonte: `https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json` (segue redirect 307 → `?perfil=PUBLICO`).
- Vigente = `current_date between data_inicio and data_fim`; `31/12/9999` do JSON = sem fim. Regra **só** em SQL (`ncm_consultar` e o resumo do Estoque); nunca replicada em TS.
- Código nunca é apagado de `ncm_oficial`; sumiu do JSON → `data_fim = current_date - 1`.
- Migrations só por `supabase migration new` + `supabase db push` (ADR-0043). `npm run db:check` roda **depois** do push (compara histórico local×remoto).
- Copy exata: inexistente → `NCM {codigo} não existe na tabela oficial`; vencido → `NCM {codigo} não está mais vigente`; falha de leitura no front → `Não foi possível verificar o NCM`.
- Fail-closed: leitura de `ncm_consultar` ou do módulo fiscal que falha **nunca** vira "válido"/"sem módulo". Edge de save → `{tipo:'falha'}`/500; worker → erro **sem** `.status` (transitório, retenta); front → Salvar desabilitado.
- Leitura do módulo fiscal nos pontos tocados usa `moduloHabilitadoStrict` (`_shared/produto/modulo.ts:25`), não `exigirModulo` (fail-open).
- Gate de publicação/envio só para org com módulo `fiscal`. Fluxos de cópia (variações/kit) validam qualquer NCM não nulo (a FK cobre todas as orgs).
- Pré-push: `pnpm preflight:static`; revisão de diff: Codex `gpt-6.1-sol` high.

## Review Focus

1. NCM colado com pontos (`6203.49.00`) no input com `maxLength={8}` → vira `62034900` e valida (owner: Task 7; testar com `userEvent.paste`, não `fireEvent.change`).
2. Leitura falha (RPC/organizations) → nenhum caminho trata como válido ou "sem módulo" (owners: Tasks 3–7).
3. Código com `data_inicio` futura → recusado hoje (owner: Task 2).
4. UPDATE de planilha só de preço com PAI de NCM vencido → lote abortado citando o PAI (owner: Task 4).
5. Refresh com JSON parcial/duplicado → recusado; código ausente do JSON só é encerrado (`data_fim = ontem`, linha mantida) com confirmação explícita da contagem (owner: Task 1).

---

### Task 1: ADR-0187 + gerador da tabela NCM

**Files:**
- Create: `docs/decisions/0187-ncm-validado-na-tabela-oficial.md` (decisões 1–4 do spec, vigência por datas, duas migrations e ordem de rollout, refresh manual) + linha em `docs/decisions/README.md`
- Create: `scripts/ncm/compor.ts` (puro), `scripts/ncm/gerar-sql.ts` (CLI)
- Test: `tests/scripts/ncm-compor.test.ts`

**Interfaces:**
- Produces: `type NcmLinha = { codigo: string; descricao: string; dataInicio: string /* YYYY-MM-DD */; dataFim: string }`; `comporTabelaNcm(json: { Nomenclaturas: { Codigo: string; Descricao: string; Data_Inicio: string; Data_Fim: string }[] }): NcmLinha[]`; `validarCargaNcm(linhas: NcmLinha[]): string[]` (problemas: `< 10000` códigos, código duplicado, data inválida, `dataInicio > dataFim`); `sqlSeed(linhas): string` (INSERTs em lotes de 1000); `sqlAtualizacao(linhas: NcmLinha[], encerrar: string[]): string` — um bloco `begin; … commit;` com upsert `on conflict (codigo) do update set descricao, data_inicio, data_fim, atualizado_em = now()` (a vigência normal vem do `Data_Fim` do próprio JSON) + **só se `encerrar` não for vazio**: `update public.ncm_oficial set data_fim = current_date - 1, atualizado_em = now() where codigo = any(array[<encerrar>]) and data_fim >= current_date`.
- CLI: `npx tsx scripts/ncm/gerar-sql.ts --modo seed|atualizar --entrada <json> [--atuais <codigos.txt>] [--confirmar-encerramentos=<n>]` — aborta (exit 1) se `validarCargaNcm` acusar algo. Em `atualizar`, `--atuais` é a lista de códigos hoje vigentes na tabela (exportada antes via Management API); os ausentes do JSON são **listados no stderr** e **nunca** encerrados sozinhos: sem `--confirmar-encerramentos` igual à quantidade listada, o CLI aborta (achado Codex r2: JSON parcial com 10 515 de 10 516 passaria a contagem mínima e extinguiria um código válido). O operador confere os listados contra a resolução Gecex antes de confirmar.

- [ ] **Step 1: Failing test** (fixture mínima: `62`, `62.03`, `6203.4`, `6203.42.00`, `6203.49.00`, `01`):
  - só 8 dígitos viram linha; `codigo` = `'62034900'`;
  - `descricao` de `62034900` começa pelo texto de `62.03`, contém `Calças, jardineiras, bermudas e shorts (calções)` (sem `<i>`, sem `- `/`-- `), termina em `De outras matérias têxteis`, separador ` › `;
  - `'31/12/9999'` → `'9999-12-31'`; `'01/04/2022'` → `'2022-04-01'`;
  - `validarCargaNcm`: lista com 9 999 linhas → acusa contagem; duplicado → acusa; data `'31/02/2026'` → acusa;
  - `sqlSeed` escapa `'` → `''`; `sqlAtualizacao(linhas, [])` começa com `begin;`, termina com `commit;`, contém o upsert e **não** contém `current_date - 1`; `sqlAtualizacao(linhas, ['11111111'])` contém o encerramento só de `11111111`;
  - CLI (testar a função de decisão exportada `ausentesParaEncerrar(atuais: string[], linhas: NcmLinha[], confirmados: number | null): { encerrar: string[] } | { erro: string }`): JSON parcial acima de 10 000 códigos com 1 ausente e sem confirmação → `erro` citando o código; com `confirmados = 1` → `encerrar = [código]`; `confirmados = 2` → `erro`.
- [ ] **Step 2:** `pnpm vitest run tests/scripts/ncm-compor.test.ts` → FAIL.
- [ ] **Step 3:** Implementar (ancestrais por prefixo de dígitos: 4 = posição, depois 5, 6, 7; capítulo de 2 dígitos fora).
- [ ] **Step 4:** PASS. Rodar o CLI no JSON real (baixar em `$CLAUDE_JOB_DIR/tmp`): 10 516 linhas, `75937727` ausente, `62034900` presente, nenhum problema.
- [ ] **Step 5:** Commit.

### Task 2: Migration A (aditiva) — tabela, carga, `ncm_consultar`, resumo do Estoque

**Files:**
- Create: `supabase/migrations/<ts>_adr187_ncm_oficial.sql` (`supabase migration new adr187_ncm_oficial`)
- Create: `supabase/tests/adr187_ncm_oficial.sql` (asserts; runner = `scripts/teste-sql-desfeito.py`, padrão do projeto sem Docker: aplica migration + teste numa transação desfeita, `raise` `TESTE_OK`; **nenhuma linha de domínio alterada** — só `ncm_oficial`/funções)
- Modify: `src/lib/database.types.ts`

**Interfaces:**
- Produces (SQL): `public.ncm_oficial(codigo text primary key check (codigo ~ '^[0-9]{8}$'), descricao text not null, data_inicio date not null, data_fim date not null, atualizado_em timestamptz not null default now())`; RLS on + policy `select to authenticated using (true)` + `grant select` (molde `20260819145325_sonar_snapshots.sql:21-29`); `public.ncm_consultar(p_codigos text[]) returns table(codigo text, descricao text, vigente boolean)` `language sql stable security definer set search_path = ''` — só códigos existentes; `grant execute … to authenticated, service_role`; `produtos_estoque_resumo()` via `create or replace` copiando **o corpo de `20260924141352_estoque_rpc_tamanho.sql` byte a byte** + chave `'ncm_vigente'`: `null` se `ncm` null; `false` se `ncm` preenchido sem linha em `ncm_oficial`; senão `current_date between data_inicio and data_fim`.
- **Sem FK nesta migration** (vai na Task 8).

- [ ] **Step 1:** Escrever `supabase/tests/adr187_ncm_oficial.sql`: `ncm_consultar(array['62034900','75937727'])` → 1 linha, `vigente=true`; inserir código fictício `99999901` com `data_inicio = current_date + 10` → `vigente=false`; `count(*) from ncm_oficial = 10516`; o JSON de `produtos_estoque_resumo()` (como `service_role` com `set local request.jwt.claims` de um usuário real, padrão dos testes SQL do projeto) contém a chave `ncm_vigente` em todos os produtos e preserva as chaves que já existiam (comparar `json_object_keys` antes×depois).
- [ ] **Step 2:** Rodar o runner só com o teste → FAIL (`ncm_consultar` não existe).
- [ ] **Step 3:** Escrever a migration (seed = `gerar-sql.ts --modo seed`).
- [ ] **Step 4:** Runner com migration + teste → `TESTE_OK`; `pnpm build`.
- [ ] **Step 5:** Commit. (Push da migration na Task 9.)

### Task 3: Helper `ncmsInvalidos` (edge)

**Files:** Create `supabase/functions/_shared/fiscal/ncm-oficial.ts`; Test `supabase/functions/_shared/fiscal/__tests__/ncm-oficial.test.ts`

**Interfaces:**
- Produces: `type NcmInvalido = { codigo: string; motivo: 'inexistente' | 'vencido' }`; `ncmsInvalidos(admin: SupabaseClient, ncms: (string | null | undefined)[]): Promise<NcmInvalido[]>` — filtra vazios/null, distintos, **uma** chamada `admin.rpc('ncm_consultar', { p_codigos })`, **lança** em `error`; `mensagemNcm(i: NcmInvalido): string` (copy das Global Constraints).

- [ ] **Step 1:** Testes (fake `admin.rpc`): `['62034900','75937727']` com rpc devolvendo só `62034900 vigente` → `[{codigo:'75937727', motivo:'inexistente'}]`; linha `vigente:false` → `vencido`; `[null, '', undefined]` → `[]` sem chamar rpc; duplicados → 1 chamada com código único; rpc com `error` → rejeita; `mensagemNcm` = copy exata nos dois motivos.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS. **Step 5:** Commit.

### Task 4: Planilha (ingest-lote)

**Files:** Modify `supabase/functions/ingest-lote/verificar-fiscal.ts`, `ingest-lote/index.ts:129-130`; Test `ingest-lote/__tests__/` (arquivo existente de `verificar-fiscal`)

**Interfaces:**
- Consumes: `ncmsInvalidos`, `mensagemNcm`.
- Produces: `exigirNcmVigente(admin: SupabaseClient, rowsRaw: Record<string, unknown>[]): Promise<void>` — só linhas PAI (mesma regra de `exigirFiscalExplicito`), lança `Error`: `NCM fora da tabela oficial em {n} produto(s) PAI: {cod} ({mensagemNcm}), …. Corrija a planilha e reenvie (ADR-0187).`
- `index.ts`: `const moduloFiscal = await moduloHabilitadoStrict(admin, orgId, 'fiscal'); if (moduloFiscal) { exigirFiscalExplicito(rowsRaw); await exigirNcmVigente(admin, rowsRaw); }` — antes de persistir qualquer coisa, dentro do `try` que já marca o lote `erro`.

- [ ] **Step 1:** Testes: PAI `00000140` NCM `75937727` → rejeita citando `00000140` e `não existe na tabela oficial`; PAI com NCM vencido → rejeita com `não está mais vigente` (Review Focus 4); linhas filhas ignoradas; todos válidos → resolve; rpc com erro → rejeita (não passa).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS. **Step 5:** Commit.

### Task 5: Saves e cópias — Fiscal, cadastro (produto/grade/nota), variações, kit, sugestão IA

**Files:**
- Modify `supabase/functions/atualizar-fiscal-familia/processar.ts` (após `camposFiscaisFaltantes`, antes do update): inválido → `{tipo:'invalido', erros:[mensagemNcm(i)]}`; rpc erro → `{tipo:'falha', mensagem}`.
- Modify `supabase/functions/cadastrar-produto/processar.ts`: nova `validarNcmDaEntrada(admin: SupabaseClient, p: ProdutoEntrada, moduloFiscalAtivo: boolean): Promise<string[]>` (só com módulo; lança em erro de leitura); `cadastrar-produto/index.ts:50` passa a `moduloHabilitadoStrict` e chama `validarNcmDaEntrada` logo após `validarFiscalDaEntrada:98`, juntando ao mesmo 400 de faltas fiscais; erro de leitura → 500.
- Modify `supabase/functions/adicionar-variacoes-familia/index.ts` (antes de criar o lote ~linha 315) e `supabase/functions/criar-kit-vinculado/processar.ts` (antes de criar o lote ~linha 518): `ncmsInvalidos(admin, [anterior.ncm])`/`[base.ncm]` → inválido: 400 / `{ok:false, motivo:'ncm_invalido', mensagem: mensagemNcm(i) + ' — corrija no botão Fiscal antes.'}` **sem** criar lote; erro de leitura → 500 / `{ok:false, motivo:'falha_leitura'}`. Preservar os ramos de idempotência existentes (checagem vem depois do curto-circuito de `jaExistente`).
- Modify `supabase/functions/sugerir-ncm/prompt.ts`: nova `filtrarSugestaoNcm(admin: SupabaseClient, s: { ncm: string | null; justificativa: string }): Promise<{ ncm: string | null; justificativa: string }>` — inválido → `{ncm:null, justificativa:'A IA sugeriu um NCM fora da tabela oficial — preencha manualmente.'}`; erro de leitura → `SEM_SUGESTAO`; `index.ts` aplica antes de responder.
- Tests: `__tests__` de cada função (fronteira real: ausência de `update`/`insert`/enqueue no fake admin, não só a função pura).

- [ ] **Step 1:** Testes: atualizar-fiscal com `75937727` → `invalido` com a copy e **zero** updates/enqueue; rpc erro → `falha`, zero updates; `validarNcmDaEntrada` vencido → `['NCM … não está mais vigente']`, sem módulo → `[]` sem rpc; variações com família de NCM inexistente → 400 e nenhum insert em `lotes`/`familias`; kit idem → `motivo:'ncm_invalido'`, nenhum lote; sugestão `75937727` → `ncm:null`; `62034900` → mantém.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS. **Step 5:** Commit.

### Task 6: Gate de publicação/update e envio fiscal (workers QStash)

**Files:** Modify `supabase/functions/_shared/fiscal/gate.ts` (`exigirFiscalCompletoSePreciso(admin, familia)`, após `camposFiscaisFaltantes`); Modify `supabase/functions/publicar-split-ml/index.ts` (achado Codex r2: a rota de split — `publicar-familias/index.ts:149` → este worker — cria/atualiza anúncios sem gate fiscal algum; chamar `exigirFiscalCompletoSePreciso(admin, familia)` junto de `exigirSemReajusteAtivo` ~linha 99, **antes** de qualquer escrita no ML, dentro do mesmo `try` que já trata erro definitivo×transitório; isso também fecha a lacuna pré-existente do D-7 nessa rota); Modify `supabase/functions/sincronizar-fiscal-ml/processar.ts` (após `camposFiscaisFaltantes`, ~linha 70, usando `deps.admin`); Tests `_shared/fiscal/__tests__/gate.test.ts` (criar se não existir), `sincronizar-fiscal-ml/__tests__/processar.test.ts`, e o teste do worker `publish-familia-ml` que já cobre o gate (grep `exigirFiscalCompletoSePreciso` nos `__tests__`).

**Interfaces:** Consumes `ncmsInvalidos(admin, [familia.ncm])`, `mensagemNcm`.

- [ ] **Step 1:** Testes: gate com NCM vencido → lança com `status = 400` e a copy no texto (definitivo: worker grava erro e responde 200, sem retry); rpc erro → lança **sem** `status` (transitório: worker responde 500 e o QStash retenta; família continua `publicando`); sincronizar com NCM inexistente → `can_invoice=false`, causa `push recusado: NCM … não existe na tabela oficial` (começa com `push` → reconciliação não limpa), portas ML nunca chamadas, 200; rpc erro → 500 sem tocar `can_invoice`; replay do mesmo job → mesmo resultado, sem update duplicado relevante; `publicar-split-ml` com família de NCM vencido → erro definitivo e **zero** chamadas ao ML (fake de fetch/canal sem nenhuma chamada), rpc erro → transitório, zero chamadas ao ML.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS. **Step 5:** Commit.

### Task 7: Front — descrição no form, Salvar travado, filtro "Fiscal pendente"

**Files:**
- Create `src/hooks/useNcmOficial.ts`
- Modify `src/components/estoque/etapa-fiscal-form.tsx` (bloco sob o input NCM ~linha 127-131; `fiscalCompleto`)
- Modify os 3 chamadores de `fiscalCompleto`: `dialog-fiscal-produto.tsx:110`, `dialog-cadastro-produto.tsx:447`, `dialog-cadastro-grade.tsx:849` — cada um chama `useNcmOficial(form.ncm)` e passa o status
- Modify `src/lib/produtos-saldo.ts` (`ProdutoEstoqueResumo.ncmVigente: boolean | null` ← `ncm_vigente`), `src/lib/produtos-saldo-filtro.ts` (`produtoFiscalPendente`: `p.ncmVigente === false` → true, com regime presente)
- Tests: `src/components/estoque/__tests__/` (dialogs), `src/lib/__tests__/produtos-saldo-filtro.test.ts`

**Interfaces:**
- Produces: `type NcmStatus = 'incompleto' | 'carregando' | 'ok' | 'inexistente' | 'vencido' | 'erro'`; `useNcmOficial(ncm: string): { status: NcmStatus; descricao: string | null }` — react-query, chave `['ncm-oficial', ncm]`, só com 8 dígitos, `staleTime: 0` + `refetchOnMount: 'always'` (vigência muda no banco sem mudar o código); estado de erro de um refetch **prevalece** sobre dado antigo (status `'erro'`); `supabase.rpc('ncm_consultar', { p_codigos: [ncm] })`. `fiscalCompleto(f, origem, ncmStatus: NcmStatus)` exige `ncmStatus === 'ok'`.
- Copy: ok → `{NNNN.NN.NN} — {descricao}` em `text-muted-foreground`; inexistente/vencido → copy das Global Constraints em `text-destructive`; erro → `Não foi possível verificar o NCM`; carregando → nada novo (Salvar desabilitado).

- [ ] **Step 1:** Testes: em cada um dos 3 dialogs, NCM `75937727` (rpc mock vazio) → texto `NCM 75937727 não existe na tabela oficial` e botão Salvar `disabled`; `62034900` → texto começando `6203.49.00 — ` e Salvar habilitado (demais campos completos); `userEvent.paste('6203.49.00')` no input → valor `62034900` (Review Focus 1); rpc com erro → `Não foi possível verificar o NCM` + Salvar `disabled`; sucesso seguido de refetch com erro → status `erro`. Filtro: `ncmVigente:false` → `produtoFiscalPendente` true; `null` com NCM vazio → regra atual.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS + `pnpm build`. **Step 5:** Commit.

### Task 8: Migration B — FK `NOT VALID`

**Files:** Create `supabase/migrations/<ts>_adr187_ncm_fk.sql`: `alter table public.familias add constraint familias_ncm_oficial_fk foreign key (ncm) references public.ncm_oficial(codigo) not valid;` (com `set local lock_timeout = '5s'`). Test: acrescentar a `supabase/tests/adr187_ncm_oficial.sql` (dentro da transação desfeita): `update familias set ncm = '75937727'` numa família → `23503` capturado e `raise` de sucesso; mesmo update com `62034900` → ok (tudo desfeito).

- [ ] **Step 1:** Teste → FAIL sem a FK. **Step 2:** Migration. **Step 3:** Runner → `TESTE_OK`. **Step 4:** Commit. (Push só no passo 6 da Task 9.)

### Task 9: Docs + entrega (ordem de rollout)

- [ ] Docs via skill `docs-update-checklist` (`docs/reference/edge-functions.md`, modelo de dados, `docs/TASKS.md`, `docs/project-status.md`); documentar o refresh (`gerar-sql.ts --modo atualizar` + aplicar via Management API como DML, conferindo a contagem impressa). `pnpm docs:links`.
- [ ] `pnpm preflight:static` + `pnpm test` verdes; revisão Codex do diff da branch (rodada única); corrigir achados.
- [ ] **Rollout, nesta ordem:**
  1. Push da branch → CI verde.
  2. `supabase db push` **só da Migration A** (aditiva, inofensiva para o código atual — mover a Migration B para fora de `supabase/migrations/` até o passo 6, ou criá-la só então). Conferir `count(*) = 10516` e `ncm_consultar` respondendo.
  3. Deploy de todas as edges alteradas/importadoras (grep importadores de `_shared/fiscal/gate.ts` e `_shared/fiscal/ncm-oficial.ts`; no mínimo `atualizar-fiscal-familia`, `cadastrar-produto`, `ingest-lote`, `sugerir-ncm`, `adicionar-variacoes-familia`, `criar-kit-vinculado`, `publish-familia-ml`, `update-familia-ml`, `publicar-split-ml`, `sincronizar-fiscal-ml`), cada uma com o `verify_jwt` do `supabase/config.toml`; conferir versão.
  4. Merge fast-forward na `main` → deploy do front no Render; conferir o hash do bundle novo servido.
  5. Validação real (playwright-cli, sessão isolada): form fiscal com `75937727` → erro + Salvar desabilitado; `62034200` → descrição; screenshot.
  6. Commit/merge da Migration B → `supabase db push` → `npm run db:check` → conferir a constraint em `pg_constraint`.
- [ ] Limpar branch e worktree.
