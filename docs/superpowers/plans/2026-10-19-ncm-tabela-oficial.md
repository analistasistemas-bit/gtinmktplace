# NCM validado na tabela oficial — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NCM inexistente ou vencido nunca entra no cadastro fiscal nem chega ao ML; o operador vê a descrição oficial do NCM ao digitar.

**Architecture:** Tabela global `ncm_oficial` (carga do Siscomex dentro da migration) + função SQL `ncm_consultar(text[])` como regra única de vigência; FK `NOT VALID` em `familias.ncm` como rede; helper de edge `ncmsInvalidos` chamado em todo ponto de escrita/envio; o form fiscal consulta a mesma função e mostra a descrição.

**Tech Stack:** Postgres/Supabase (migration via CLI), Deno Edge Functions, React + TS (vitest), script TS em `scripts/ncm/` (rodado com `npx tsx`).

**Spec:** `docs/superpowers/specs/2026-10-19-ncm-tabela-oficial-design.md`

## Global Constraints

- Fonte: `https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json` (segue redirect 307 → `?perfil=PUBLICO`).
- Vigente = `current_date between data_inicio and data_fim`; `31/12/9999` do JSON = sem fim. Regra só em SQL (`ncm_consultar`), nunca replicada em TS.
- Código nunca é apagado de `ncm_oficial`; sumiu do JSON → `data_fim = current_date - 1`.
- Migration só por `supabase migration new` + `supabase db push` (ADR-0043); validar com `npm run db:check`.
- Mensagens (copy exata): inexistente → `NCM {codigo} não existe na tabela oficial`; vencido → `NCM {codigo} não está mais vigente`.
- Leitura de `ncm_oficial`/`ncm_consultar` que falha **nunca** vira "válido" (fail-closed): edge de save → `{tipo:'falha'}`; worker → erro transitório (500); front → Salvar desabilitado com "Não foi possível verificar o NCM".
- Gate de publicação/envio só se aplica a org com módulo `fiscal` (mesmo escopo de hoje).
- Dropdown/select novo: `src/components/ui/select.tsx` (não há select novo previsto).
- Pré-push: `pnpm preflight:static`; revisão de diff por task e pré-merge: Codex `gpt-6.1-sol` high.

## Review Focus

1. NCM colado com pontos (`6203.49.00`) no form → normalizado para 8 dígitos e validado (owner: Task 6).
2. Leitura da tabela falha (timeout/RLS) → nenhum caminho trata como válido (owners: Tasks 3, 4, 5, 6).
3. Código com `data_inicio` futura (resolução publicada, ainda não vigente) → recusado hoje (owner: Task 2).
4. UPDATE de planilha só de preço com PAI de NCM vencido → lote abortado citando o PAI (owner: Task 4).
5. Refresh em que um código some do JSON → `data_fim = ontem`, FK das famílias intacta, linha não apagada (owner: Task 1).

---

### Task 1: ADR-0187 + gerador da tabela NCM

**Files:**
- Create: `docs/decisions/0187-ncm-validado-na-tabela-oficial.md` (decisões 1–4 do spec + vigência por datas + carga na migration + refresh manual; registrar em `docs/decisions/README.md`)
- Create: `scripts/ncm/compor.ts` (puro), `scripts/ncm/gerar-sql.ts` (CLI)
- Test: `tests/scripts/ncm-compor.test.ts`

**Interfaces:**
- Produces: `comporTabelaNcm(json: { Nomenclaturas: { Codigo: string; Descricao: string; Data_Inicio: string; Data_Fim: string }[] }): NcmLinha[]` com `NcmLinha = { codigo: string; descricao: string; dataInicio: string /* YYYY-MM-DD */; dataFim: string }`; `sqlSeed(linhas: NcmLinha[]): string` (INSERT em lotes de 1000); `sqlAtualizacao(linhas: NcmLinha[]): string` (upsert `on conflict (codigo) do update` + `update ncm_oficial set data_fim = current_date - 1, atualizado_em = now() where codigo <> all(array[...]) and data_fim >= current_date`).
- CLI: `npx tsx scripts/ncm/gerar-sql.ts --modo seed|atualizar --entrada <arquivo.json>` → SQL no stdout.

- [ ] **Step 1: Write the failing test** `tests/scripts/ncm-compor.test.ts` com fixture mínima (nós `62`, `62.03`, `6203.4`, `6203.42.00`, `6203.49.00`, `01` sem folha):
  - só códigos de 8 dígitos viram linha; `codigo` sem pontos (`'62034900'`);
  - `descricao` de `62034900` começa pelo texto da posição `62.03`, contém `Calças, jardineiras, bermudas e shorts (calções)` (sem `<i>`/`</i>` e sem `- `/`-- ` de nível) e termina em `De outras matérias têxteis`, níveis separados por ` › `;
  - `Data_Fim: '31/12/9999'` → `dataFim: '9999-12-31'`; `Data_Inicio: '01/04/2022'` → `'2022-04-01'`;
  - `sqlAtualizacao` contém `on conflict (codigo) do update` e o `update ... data_fim = current_date - 1` com os códigos da lista; `sqlSeed` escapa aspas simples (`'` → `''`).
- [ ] **Step 2:** `pnpm vitest run tests/scripts/ncm-compor.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3:** Implementar `compor.ts` (ancestrais por prefixo de dígitos do código: 4 dígitos = posição, depois 5, 6, 7; pular capítulo de 2 dígitos) e `gerar-sql.ts`.
- [ ] **Step 4:** teste → PASS. Rodar o CLI no JSON real (baixar para `$CLAUDE_JOB_DIR/tmp`) e conferir: 10.516 linhas; `75937727` ausente; `62034900` presente.
- [ ] **Step 5:** Commit (ADR + script + teste).

### Task 2: Migration — tabela, carga, `ncm_consultar`, FK, resumo do Estoque

**Files:**
- Create: `supabase/migrations/<timestamp>_adr187_ncm_oficial.sql` (via `supabase migration new adr187_ncm_oficial`)
- Modify: `src/lib/database.types.ts` (tabela + função)
- Test: `scripts/teste-sql-desfeito.py` (padrão do projeto: transação desfeita em prod, `raise` `TESTE_OK`)

**Interfaces:**
- Produces (SQL): tabela `public.ncm_oficial(codigo text primary key check (codigo ~ '^[0-9]{8}$'), descricao text not null, data_inicio date not null, data_fim date not null, atualizado_em timestamptz not null default now())`; RLS on + policy `select to authenticated using (true)` + `grant select` (molde `20260819145325_sonar_snapshots.sql:21-29`); `public.ncm_consultar(p_codigos text[]) returns table(codigo text, descricao text, vigente boolean)` `stable security definer set search_path=''`, devolve só códigos existentes, `vigente = current_date between data_inicio and data_fim`; `grant execute` a `authenticated` e `service_role`; FK `familias_ncm_oficial_fk foreign key (ncm) references public.ncm_oficial(codigo) not valid`; `produtos_estoque_resumo()` recriado (`create or replace`, corpo idêntico a `20260924141352_estoque_rpc_tamanho.sql`) com a chave `'ncm_vigente'` (`null` quando ncm é null; senão o `vigente` de `ncm_consultar`).
- Seed: saída de `gerar-sql.ts --modo seed` colada no arquivo.

- [ ] **Step 1:** Escrever o teste SQL (em transação desfeita): após a migration, `ncm_consultar(array['62034900','75937727'])` devolve 1 linha `vigente=true`; inserir em `ncm_oficial` um código com `data_inicio = current_date + 10` → `vigente=false`; `update familias set ncm='75937727'` numa família → erro `23503`; família existente com NCM válido continua atualizável.
- [ ] **Step 2:** Rodar o teste antes da migration → FAIL (`ncm_consultar` não existe).
- [ ] **Step 3:** Escrever a migration; `npm run db:check`.
- [ ] **Step 4:** Teste SQL → `TESTE_OK`; `pnpm build` (tipos).
- [ ] **Step 5:** Commit. (**`db push` só no deploy, Task 8.**)

### Task 3: Helper `ncmsInvalidos` (edge)

**Files:**
- Create: `supabase/functions/_shared/fiscal/ncm-oficial.ts`
- Test: `supabase/functions/_shared/fiscal/__tests__/ncm-oficial.test.ts`

**Interfaces:**
- Produces: `type NcmInvalido = { codigo: string; motivo: 'inexistente' | 'vencido' }`; `ncmsInvalidos(admin: SupabaseClient, ncms: string[]): Promise<NcmInvalido[]>` (distintos, ignora vazio/null, 1 chamada `admin.rpc('ncm_consultar', { p_codigos })`, **lança** em erro de leitura); `mensagemNcm(i: NcmInvalido): string` (copy das Global Constraints).

- [ ] **Step 1:** Testes com fake `admin.rpc`: `['62034900','75937727']` com rpc devolvendo só `62034900 vigente` → `[{codigo:'75937727', motivo:'inexistente'}]`; linha `vigente:false` → `vencido`; `[]`/`[null]` → `[]` sem chamar rpc; rpc com `error` → rejeita; `mensagemNcm` = copy exata.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS. **Step 5:** Commit.

### Task 4: Encaixes de escrita — Fiscal, cadastro, planilha, IA

**Files:**
- Modify: `supabase/functions/atualizar-fiscal-familia/processar.ts` (após `camposFiscaisFaltantes`, antes do update ~linha 84)
- Modify: `supabase/functions/cadastrar-produto/index.ts:98` (após `validarFiscalDaEntrada`, só com módulo fiscal)
- Modify: `supabase/functions/ingest-lote/verificar-fiscal.ts` + `ingest-lote/index.ts:129-130`
- Modify: `supabase/functions/sugerir-ncm/index.ts` (antes de `json(extrairSugestaoNcm(raw))`)
- Test: os `__tests__` existentes de cada função

**Interfaces:**
- Consumes: `ncmsInvalidos`, `mensagemNcm` (Task 3).
- Produces: `exigirNcmVigente(admin: SupabaseClient, rowsRaw: Record<string, unknown>[]): Promise<void>` em `verificar-fiscal.ts` — só PAIs (mesma regra de `exigirFiscalExplicito`), lança `Error` com `NCM fora da tabela oficial em {n} produto(s) PAI: {cod} (NCM {codigo} não existe na tabela oficial), …. Corrija a planilha e reenvie (ADR-0187).`; chamado em `index.ts` logo após `exigirFiscalExplicito`, dentro do mesmo `if (moduloFiscal)`.

- [ ] **Step 1: Testes que falham:**
  - atualizar-fiscal: NCM `75937727` → `{tipo:'invalido', erros:['NCM 75937727 não existe na tabela oficial']}` e **nenhum** update; rpc com erro → `{tipo:'falha'}`; NCM válido → caminho atual intacto.
  - cadastrar-produto: NCM vencido com módulo fiscal → 400 com a mensagem; sem módulo → não consulta.
  - ingest: planilha com PAI `00000140` NCM `75937727` → lança citando `00000140`; PAI com NCM vencido (Review Focus 4) → lança; todos válidos → resolve.
  - sugerir-ncm: IA devolve `75937727` → resposta `{ncm:null, justificativa: ...}` mencionando tabela oficial; devolve `62034900` → mantém.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (sugerir-ncm: em erro de leitura da tabela, devolver `SEM_SUGESTAO` — fail-closed). **Step 4:** PASS. **Step 5:** Commit.

### Task 5: Gate de publicação/update e envio fiscal

**Files:**
- Modify: `supabase/functions/_shared/fiscal/gate.ts` (`exigirFiscalCompletoSePreciso`, após `camposFiscaisFaltantes`)
- Modify: `supabase/functions/sincronizar-fiscal-ml/processar.ts` (após `camposFiscaisFaltantes`, ~linha 70)
- Test: `supabase/functions/_shared/fiscal/__tests__/gate.test.ts` (criar se não existir), `sincronizar-fiscal-ml/__tests__/processar.test.ts`

**Interfaces:**
- Consumes: `ncmsInvalidos`, `mensagemNcm`.

- [ ] **Step 1: Testes:** gate com NCM vencido → lança `status=400` com `NCM {x} não está mais vigente` no texto; rpc com erro → lança **sem** `status` (transitório, retenta); sincronizar com NCM inexistente → `can_invoice=false`, causa começando com `push recusado:` (a reconciliação não limpa — regra de `monitorar-moderados/can-invoice.ts`), portas ML nunca chamadas; rpc com erro → `{status:500}` sem tocar `can_invoice`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar chamando `ncmsInvalidos(deps.admin, [familia.ncm])` direto (sem nova dep injetada); o fake admin dos testes ganha `rpc`. **Step 4:** PASS. **Step 5:** Commit.

### Task 6: Front — descrição no form, Salvar travado, filtro "Fiscal pendente"

**Files:**
- Create: `src/hooks/useNcmOficial.ts`
- Modify: `src/components/estoque/etapa-fiscal-form.tsx` (`fiscalCompleto` + bloco abaixo do input NCM ~linha 127-131)
- Modify: chamadores de `fiscalCompleto`: `dialog-fiscal-produto.tsx:109-112`, `use-cadastro-produto.ts` (podeSalvar) — grep `fiscalCompleto(`
- Modify: `src/lib/produtos-saldo.ts` (`ProdutoEstoqueResumo.ncmVigente: boolean | null`, mapeado de `ncm_vigente`), `src/lib/produtos-saldo-filtro.ts` (`produtoFiscalPendente`: `p.ncmVigente === false` → pendente)
- Test: `src/components/estoque/__tests__/etapa-fiscal-form.test.tsx` (existente ou novo), `src/lib/__tests__/produtos-saldo-filtro.test.ts`

**Interfaces:**
- Produces: `useNcmOficial(ncm: string): { status: 'incompleto' | 'carregando' | 'ok' | 'inexistente' | 'vencido' | 'erro'; descricao: string | null }` (react-query, chave `['ncm-oficial', ncm]`, `staleTime` longo, só consulta com 8 dígitos; `supabase.rpc('ncm_consultar', { p_codigos: [ncm] })`); `fiscalCompleto(f, origem, ncmStatus: NcmStatus)` exige `ncmStatus === 'ok'`.
- Copy: ok → `{6203.49.00} — {descricao}` (código formatado `NNNN.NN.NN`); inexistente/vencido → copy das Global Constraints em `text-destructive`; erro → `Não foi possível verificar o NCM`.

- [ ] **Step 1: Testes:** form com NCM `75937727` (rpc mock vazio) → mostra `NCM 75937727 não existe na tabela oficial` e `fiscalCompleto` false; `62034900` → mostra `6203.49.00 — ` + descrição; colar `6203.49.00` → valor `62034900` (Review Focus 1); rpc erro → mensagem de erro e Salvar desabilitado; filtro: `ncmVigente:false` → `produtoFiscalPendente` true.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS + `pnpm build`. **Step 5:** Commit.

### Task 7: Docs

**Files:** `docs/reference/edge-functions.md`, `docs/reference/modelo-de-dados.md` (ou equivalente que listar tabelas), `docs/TASKS.md`, `docs/project-status.md` — seguir a skill `docs-update-checklist`; documentar o refresh: `npx tsx scripts/ncm/gerar-sql.ts --modo atualizar --entrada ncm.json` + aplicar via Management API (DML).

- [ ] **Step 1:** `pnpm docs:links` OK. **Step 2:** Commit.

### Task 8: Entrega

- [ ] `pnpm preflight:static` + `pnpm test` verdes.
- [ ] Revisão Codex `gpt-6.1-sol` high do diff da branch (rodada única; corrigir achados).
- [ ] Push branch → CI verde → merge fast-forward na `main`.
- [ ] `supabase db push` (migration) → conferir `select count(*) from ncm_oficial` = 10516 e a FK presente.
- [ ] Deploy das edges que importam `_shared/fiscal/gate.ts`, `_shared/fiscal/ncm-oficial.ts` ou foram alteradas (grep dos importadores; no mínimo `atualizar-fiscal-familia`, `cadastrar-produto`, `ingest-lote`, `sugerir-ncm`, `publish-familia-ml`, `update-familia-ml`, `sincronizar-fiscal-ml`), com o `verify_jwt` do `supabase/config.toml` de cada uma; conferir versão pós-deploy.
- [ ] Validação real (playwright-cli, sessão isolada): form fiscal com `75937727` → erro e Salvar desabilitado; `62034200` → descrição; screenshot.
- [ ] Limpar branch e worktree.
