# Correções do acesso autorizado de suporte — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir atomicamente a renovação de suporte, automatizar a retenção anual da auditoria e validar definitivamente a separação entre super-admin e tenant.

**Architecture:** Uma RPC PostgreSQL `start_support_session` realizará a troca de sessões e os eventos de auditoria na mesma transação. Uma migration canônica também validará `profiles_identity_xor` e registrará um único job diário do `pg_cron`; a Edge Function `suporte` apenas autorizará a chamada, invocará a RPC e notificará os administradores.

**Tech Stack:** PostgreSQL/Supabase migrations, PL/pgSQL, pgTAP/SQL transacional, Edge Functions Deno/TypeScript, Vitest.

## Global Constraints

- Preservar no máximo uma sessão `active` por super-admin.
- Renovação só é aceita nos 15 minutos finais, após nova aprovação, para o mesmo solicitante e organização.
- A nova sessão recebe duas horas completas; qualquer falha preserva integralmente a sessão anterior.
- Eventos `session_ended` e `session_started` pertencem à mesma transação da troca.
- Auditoria é excluída após um ano somente quando `legal_hold = false`.
- Super-admin ativo tem `org_id is null`; membro de tenant tem `is_super_admin = false` e `org_id is not null`.
- DDL somente por nova migration criada com Supabase CLI; não editar retroativamente migrations aplicadas.
- Não alterar interface, prazos ou permissões fora deste escopo.

---

### Task 1: Testes SQL das garantias do banco

**Files:**
- Modify: `supabase/tests/support_access.sql`

**Interfaces:**
- Consumes: tabelas `support_requests`, `support_audit_events` e constraint `profiles_identity_xor`.
- Produces: contrato executável para `public.start_support_session(uuid, uuid, timestamptz)`, job `cleanup-support-audit-events` e constraint validada.

- [ ] **Step 1: Escrever os testes falhos de renovação**

Adicionar ao teste SQL uma sessão ativa original e uma renovação aprovada. Chamar:

```sql
select public.start_support_session(
  '90000000-0000-0000-0000-000000000202',
  '90000000-0000-0000-0000-000000000102',
  '2026-07-25 12:00:00+00'
);
```

Assertar que a original ficou `ended`, a renovação ficou `active`, existe exatamente uma sessão ativa e foram gravados `session_ended` e `session_started`.

- [ ] **Step 2: Escrever o teste falho de rollback**

Criar renovação com organização diferente da sessão apontada, capturar a exceção e assertar que a sessão original continua `active` e a renovação continua `approved`.

- [ ] **Step 3: Escrever os testes falhos de retenção e XOR**

Inserir eventos antigo, recente e antigo com `legal_hold`; executar `cleanup_support_audit_events()` e assertar que somente o antigo sem bloqueio foi removido. Consultar:

```sql
select convalidated
from pg_constraint
where conname = 'profiles_identity_xor';
```

e exigir `true`. Consultar `cron.job` e exigir exatamente um job ativo chamado `cleanup-support-audit-events`.

- [ ] **Step 4: Executar os testes e confirmar RED**

Run:

```bash
supabase db reset
docker exec -i supabase_db_txvncrgkoynoxwopfkbp \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/support_access.sql
```

Expected: FAIL porque `start_support_session` e o job ainda não existem e `profiles_identity_xor` não está validada.

- [ ] **Step 5: Commitar somente os testes**

```bash
git add supabase/tests/support_access.sql
git commit -m "test: cover atomic support renewal"
```

### Task 2: Migration transacional, retenção e XOR

**Files:**
- Create: `supabase/migrations/<timestamp>_finalize_support_access.sql`
- Test: `supabase/tests/support_access.sql`

**Interfaces:**
- Consumes: `support_requests`, `support_audit_events`, `cleanup_support_audit_events()` e `profiles_identity_xor`.
- Produces: `public.start_support_session(p_request_id uuid, p_requester_id uuid, p_now timestamptz)` retornando `public.support_requests`; job `cleanup-support-audit-events`.

- [ ] **Step 1: Criar a migration pelo canal canônico**

Run:

```bash
supabase migration new finalize_support_access
```

- [ ] **Step 2: Implementar a RPC mínima**

A função deve ser `security definer set search_path = ''`, bloquear a solicitação nova com `FOR UPDATE`, validar solicitante/status/prazo e, quando houver `renewal_of`, bloquear e validar a sessão anterior. Dentro da mesma função:

```sql
update public.support_requests
set status = 'ended', ended_at = p_now
where id = v_new.renewal_of and status = 'active';

update public.support_requests
set status = 'active',
    started_at = p_now,
    expires_at = p_now + interval '2 hours'
where id = p_request_id
returning * into v_started;
```

Gravar `session_ended` e `session_started` antes do retorno. Revogar execução de `public`, `anon` e `authenticated`; conceder somente a `service_role`.

- [ ] **Step 3: Agendar a retenção idempotente**

Na mesma migration, habilitar `pg_cron`, remover eventual job com o mesmo nome e criar:

```sql
select cron.schedule(
  'cleanup-support-audit-events',
  '15 3 * * *',
  'select public.cleanup_support_audit_events();'
);
```

- [ ] **Step 4: Validar o XOR**

Na mesma migration:

```sql
alter table public.profiles
  validate constraint profiles_identity_xor;
```

Se houver identidade híbrida, a migration deve falhar e impedir implantação parcial.

- [ ] **Step 5: Executar os testes e confirmar GREEN**

Run os dois comandos da Task 1.  
Expected: migration aplicada e `support_access.sql` concluído sem erro.

- [ ] **Step 6: Validar o schema**

Run:

```bash
npm run db:check
```

Expected: PASS.

- [ ] **Step 7: Commitar a migration**

```bash
git add supabase/migrations/*_finalize_support_access.sql
git commit -m "fix: make support renewal atomic"
```

### Task 3: Edge Function usando a RPC

**Files:**
- Modify: `supabase/functions/suporte/index.ts`
- Modify: `supabase/functions/_shared/__tests__/support-state.test.ts` somente se a extração de lógica pura exigir cobertura adicional.
- Test: `supabase/tests/support_access.sql`

**Interfaces:**
- Consumes: RPC `start_support_session(uuid, uuid, timestamptz)`.
- Produces: resposta `{ request, notification_warning }` para a ação `start`, mantendo o contrato de `src/lib/suporte.ts`.

- [ ] **Step 1: Escrever teste falho do contrato do handler**

Extrair, se necessário, uma função pequena que normalize o resultado/erro da RPC e testar:

```ts
expect(mapearInicioSuporte({ code: 'P0001' })).toEqual({
  status: 409,
  error: 'transição não disponível',
});
```

O teste deve falhar antes da implementação.

- [ ] **Step 2: Executar o teste e confirmar RED**

Run:

```bash
pnpm vitest run supabase/functions/_shared/__tests__/support-state.test.ts
```

Expected: FAIL pela ausência da função/comportamento novo.

- [ ] **Step 3: Substituir o `update` de `start` pela RPC**

No ramo `action.action === 'start'`, chamar:

```ts
const { data: started, error: startError } = await db.rpc('start_support_session', {
  p_request_id: request.id,
  p_requester_id: user.id,
  p_now: now.toISOString(),
});
```

Em erro ou resultado vazio, retornar 409. Em sucesso, chamar `notificarAdmins` e devolver a solicitação iniciada. Não chamar `auditar` novamente para `session_started`, pois a RPC já gravou os eventos atomicamente.

- [ ] **Step 4: Executar testes e checks direcionados**

Run:

```bash
pnpm vitest run supabase/functions/_shared/__tests__/support-state.test.ts src/lib/__tests__/suporte.test.ts
deno lint --config supabase/functions/deno.json supabase/functions/suporte/index.ts
deno check --config supabase/functions/deno.json supabase/functions/suporte/index.ts
```

Expected: PASS.

- [ ] **Step 5: Commitar a Edge Function**

```bash
git add supabase/functions/suporte/index.ts supabase/functions/_shared/__tests__/support-state.test.ts
git commit -m "fix: start renewed support sessions transactionally"
```

### Task 4: Documentação, validação completa e nova revisão

**Files:**
- Modify: `docs/how-to/implantar-acesso-suporte.md`
- Modify: `docs/reference/modelo-de-dados.md`
- Modify: `docs/reference/edge-functions.md`
- Modify: `docs/explanation/arquitetura.md`
- Modify: `docs/TASKS.md`
- Modify: `obsidian-vault/04-Decisões/Índice de ADRs.md` somente se o índice exigir atualização do ADR-0092.
- Create: `.code-review-fable5/code-review-v2.md`
  > **Perdido em 2026-08-17.** Ao preservar o relatório da revisão do módulo Pulse eu copiei o
  > arquivo por cima deste, sem checar que o nome já existia. Os relatórios são gitignorados, então
  > não há histórico para recuperar. O conteúdo desta entrega continua descrito neste plano e em
  > `docs/TASKS.md`; o que se perdeu foi o relatório de revisão em si. O arquivo com esse nome hoje
  > não existe mais — o do Pulse foi renomeado para
  > `code-review-pulse-modulo-2026-08-17.md`.
- Modify: `.code-review-fable5/state.json`

**Interfaces:**
- Consumes: implementação final e comandos de validação.
- Produces: roteiro implantável, referências atualizadas e revisão independente com score 100/100.

- [ ] **Step 1: Atualizar documentação operacional**

Registrar a nova migration, a RPC, o job diário, a validação do XOR e o teste de renovação na DSA. Corrigir o roteiro para exigir conferência de identidades antes do `db push`.

- [ ] **Step 2: Executar validação completa**

Run:

```bash
pnpm lint
pnpm test
pnpm build
pnpm lint:functions
pnpm check:functions
npm run db:check
```

Expected: todos PASS sem erro novo.

- [ ] **Step 3: Executar o teste SQL real**

Repetir `supabase db reset` e `support_access.sql`.  
Expected: PASS, incluindo renovação, rollback, cron, retenção e XOR.

- [ ] **Step 4: Commitar documentação**

```bash
git add docs obsidian-vault
git commit -m "docs: finalize support access operations"
```

- [ ] **Step 5: Reexecutar `code-review-fable5`**

Revisar `5891c72..HEAD`, gerar `.code-review-fable5/code-review-v2.md` e atualizar `state.json`. Nenhum achado CRÍTICO, ALTO, MÉDIO ou BAIXO é aceitável para esta entrega.

- [ ] **Step 6: Corrigir e repetir até 100/100**

Para qualquer achado, criar primeiro um teste falho, aplicar a menor correção, repetir as validações e gerar a próxima versão do relatório até o score final ser `100/100 → APROVAR`.

- [ ] **Step 7: Integrar e publicar controladamente**

Após revisão 100/100, integrar a branch em `main`, aplicar a migration por `supabase db push --linked`, publicar `suporte`, verificar versões e executar o teste de fumaça controlado na DSA. Não usar a Avil para mutações de teste.

## Self-review

- Cobertura da especificação: renovação atômica, rollback, auditoria, retenção, XOR, testes, documentação e implantação estão mapeados.
- Placeholders: o único `<timestamp>` é produzido deterministicamente pelo comando oficial `supabase migration new`; não exige decisão manual.
- Consistência: RPC, parâmetros, nomes do job e contratos de retorno são iguais em todas as tasks.
