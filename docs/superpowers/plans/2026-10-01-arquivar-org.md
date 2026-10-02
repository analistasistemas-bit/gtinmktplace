# Arquivar organização — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Super-admin arquiva/desarquiva uma organização pela Central; org arquivada some da Central/totais e para de sincronizar com o ML.

**Architecture:** Coluna `organizations.arquivada_em` + duas funções SQL transacionais (security definer, só `service_role`). Arquivar apaga as conexões da org (mesma lógica de `delete_marketplace_connection`) — isso desliga todas as rotinas que partem de `marketplace_connections` e o webhook. Edge `usuarios` expõe as ações; repositório da Central filtra; duas rotinas que listam `organizations` direto filtram; front ganha menu, diálogo e filtro.

**Tech Stack:** Postgres/Supabase (migration via CLI), Deno edge functions, React + vitest.

**Spec:** `docs/superpowers/specs/2026-10-01-arquivar-org-design.md` · ADR: `docs/decisions/0175-arquivar-organizacao.md`

## Global Constraints

- Migration **só** por `supabase migration new` + `supabase db push` (ADR-0043); nunca DDL via Management API.
- Funções novas: `security definer`, `set search_path = public, vault`, `revoke execute ... from public, anon, authenticated`, `grant execute ... to service_role`.
- Ações de plataforma só para `me.is_super_admin && !me.org_id` (padrão de `platformAction` em `usuarios/index.ts:32`).
- Toda ação de plataforma grava `platform_audit_events` (intent + success/failure) via `auditPlatformAction` (`usuarios/index.ts:39`).
- Textos de UI em pt-BR com acentuação.
- `delete_org` continua desabilitado (fora de escopo).
- Commits com `/usr/bin/git` e `-F <arquivo>`; mensagem termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Arquivar org com membro ativo → nada é apagado (conexão e segredos permanecem) — atomicidade. Teste SQL na Task 1.
2. Arquivar duas vezes → segunda chamada não falha nem muda a data. Teste SQL na Task 1.
3. Org arquivada não entra nos totais da carteira; já `organization(orgId)` (detalhe) **continua** devolvendo a org (o super-admin precisa abrir e desarquivar). Teste na Task 3.
4. Super-admin tenta arquivar sem `org_id` → 400; org inexistente → 404 (P0002). Teste na Task 2.
5. Filtro cliente `Organizacoes.tsx:223` precisa esconder arquivadas mesmo se a edge devolver (defesa dupla) — teste na Task 4.

---

### Task 1: Migration + teste SQL (modelo: opus — migration nunca rebaixa)

**Files:**
- Create: `supabase/migrations/<ts>_adr175_arquivar_organizacao.sql` (via `supabase migration new adr175_arquivar_organizacao`)
- Create: `supabase/tests/arquivar_organizacao.sql`

**Interfaces — Produces:**
- `public.arquivar_organizacao(p_org_id uuid) returns timestamptz` — erros: `P0002` org inexistente; `55000` membros ativos.
- `public.desarquivar_organizacao(p_org_id uuid) returns void` — `P0002` se inexistente.
- coluna `organizations.arquivada_em timestamptz null`.

- [ ] **Step 1: Teste SQL (falha antes da migration)** — `supabase/tests/arquivar_organizacao.sql`:

```sql
\set ON_ERROR_STOP on
begin;
insert into public.organizations (id, nome, slug) values
  ('92000000-0000-0000-0000-000000000001', 'Arq Teste', 'arq-teste'),
  ('92000000-0000-0000-0000-000000000002', 'Arq Membro', 'arq-membro');
-- conexão com segredos no Vault (org 1) e (org 2)
do $$
declare a uuid; r uuid;
begin
  a := vault.create_secret('tok-a1'); r := vault.create_secret('tok-r1');
  insert into public.marketplace_connections (org_id, canal, conta_externa_id, access_token_secret_id, refresh_token_secret_id, expires_at)
  values ('92000000-0000-0000-0000-000000000001', 'mercado_livre', '920001', a, r, now() + interval '6 hours');
  a := vault.create_secret('tok-a2'); r := vault.create_secret('tok-r2');
  insert into public.marketplace_connections (org_id, canal, conta_externa_id, access_token_secret_id, refresh_token_secret_id, expires_at)
  values ('92000000-0000-0000-0000-000000000002', 'mercado_livre', '920002', a, r, now() + interval '6 hours');
end $$;
-- membro ativo na org 2: o trigger handle_new_user cria o profile a partir de raw_user_meta_data
-- (profiles_identity_xor exige org_id no INSERT — UPDATE posterior não serve). Conferir as chaves
-- exatas em supabase/tests/support_access.sql:44 e copiar.
insert into auth.users (id, email, raw_user_meta_data) values
  ('92000000-0000-0000-0000-000000000102', 'membro-arq@teste.local',
   jsonb_build_object('org_id', '92000000-0000-0000-0000-000000000002'));

set local role service_role;
-- 1) arquivar org sem membros: apaga conexão + segredos, grava data
do $$
declare d timestamptz; d2 timestamptz;
begin
  d := public.arquivar_organizacao('92000000-0000-0000-0000-000000000001');
  if d is null then raise exception 'arquivada_em não retornada'; end if;
  if (select arquivada_em from public.organizations where id = '92000000-0000-0000-0000-000000000001') is distinct from d
    then raise exception 'arquivada_em persistida diverge do retorno'; end if;
  if exists (select 1 from public.marketplace_connections where org_id = '92000000-0000-0000-0000-000000000001')
    then raise exception 'conexão não apagada'; end if;
end $$;
reset role;
do $$
begin
  if (select count(*) from vault.decrypted_secrets where decrypted_secret in ('tok-a1','tok-r1')) <> 0
    then raise exception 'segredos não apagados'; end if;
end $$;
-- 2) idempotente: data antiga conhecida não pode ser regravada
update public.organizations set arquivada_em = '2020-01-01T00:00:00Z' where id = '92000000-0000-0000-0000-000000000001';
set local role service_role;
do $$
declare d2 timestamptz;
begin
  d2 := public.arquivar_organizacao('92000000-0000-0000-0000-000000000001');
  if d2 is distinct from '2020-01-01T00:00:00Z'::timestamptz then raise exception 'idempotência quebrada: %', d2; end if;
end $$;
reset role;

-- 2b) org arquivada não pode ganhar conexão (refresh/OAuth tardio) — trava no upsert
do $$
begin
  perform public.upsert_marketplace_connection('92000000-0000-0000-0000-000000000001', 'mercado_livre',
    '920001', 'x', 'a', 'r', 'scope', now() + interval '6 hours', null);
  raise exception 'upsert recriou conexão em org arquivada';
exception when sqlstate '55000' then null;
end $$;

-- 3) membro ativo → 55000 e nada apagado
do $$
begin
  perform public.arquivar_organizacao('92000000-0000-0000-0000-000000000002');
  raise exception 'arquivou org com membro ativo';
exception when sqlstate '55000' then null;
end $$;
do $$
begin
  if not exists (select 1 from public.marketplace_connections where org_id = '92000000-0000-0000-0000-000000000002')
    then raise exception 'conexão apagada apesar da recusa'; end if;
  if (select arquivada_em from public.organizations where id = '92000000-0000-0000-0000-000000000002') is not null
    then raise exception 'marcou arquivada apesar da recusa'; end if;
end $$;

-- 4) inexistente → P0002
do $$
begin
  perform public.arquivar_organizacao('92000000-0000-0000-0000-0000000000ff');
  raise exception 'aceitou org inexistente';
exception when sqlstate 'P0002' then null;
end $$;

-- 5) desarquivar
do $$
begin
  perform public.desarquivar_organizacao('92000000-0000-0000-0000-000000000001');
  if (select arquivada_em from public.organizations where id = '92000000-0000-0000-0000-000000000001') is not null
    then raise exception 'não desarquivou'; end if;
end $$;

-- 5b) desarquivada volta a aceitar upsert (reconexão via OAuth)
do $$
begin
  perform public.upsert_marketplace_connection('92000000-0000-0000-0000-000000000001', 'mercado_livre',
    '920001', 'x', 'a', 'r', 'scope', now() + interval '6 hours', null);
  if not exists (select 1 from public.marketplace_connections where org_id = '92000000-0000-0000-0000-000000000001')
    then raise exception 'upsert não reconectou após desarquivar'; end if;
end $$;

-- 6) anon e authenticated não executam nenhuma das duas
set local role authenticated;
do $$
begin
  perform public.arquivar_organizacao('92000000-0000-0000-0000-000000000001');
  raise exception 'authenticated executou arquivar';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform public.desarquivar_organizacao('92000000-0000-0000-0000-000000000001');
  raise exception 'authenticated executou desarquivar';
exception when insufficient_privilege then null;
end $$;
reset role;
set local role anon;
do $$
begin
  perform public.arquivar_organizacao('92000000-0000-0000-0000-000000000001');
  raise exception 'anon executou arquivar';
exception when insufficient_privilege then null;
end $$;
reset role;
rollback;
\echo 'arquivar_organizacao: OK'
```

(Ajustar o insert em `auth.users`/`profiles` ao trigger real de criação de profile — conferir em `supabase/tests/support_access.sql` como os testes criam usuário/profile e copiar o padrão. Se `marketplace_connections` exigir outras colunas NOT NULL, copiar do insert usado em outro teste SQL: `grep -n "insert into public.marketplace_connections" supabase/tests/*.sql`.)

- [ ] **Step 2: Rodar e ver falhar** — `docker exec -i supabase_db_<project-ref> psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/arquivar_organizacao.sql` → erro "function public.arquivar_organizacao does not exist". (Se o Postgres local não estiver de pé: `supabase start`; `db reset` é conhecido como quebrado — aplicar migrations via `psql` no container, ver memória `reference_worktree_guard_scripts_e2e_local`.)

- [ ] **Step 3: Migration**

```sql
-- ADR-0175: arquivar organização (soft delete). Arquivar desconecta os canais (mesma lógica de
-- delete_marketplace_connection) e marca arquivada_em, numa única transação.
alter table public.organizations add column if not exists arquivada_em timestamptz;

create or replace function public.arquivar_organizacao(p_org_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_org public.organizations%rowtype;
  v_cx public.marketplace_connections%rowtype;
  v_agora timestamptz := now();
begin
  select * into v_org from public.organizations where id = p_org_id for update;
  if v_org.id is null then
    raise exception 'Organização não encontrada.' using errcode = 'P0002';
  end if;
  if v_org.arquivada_em is not null then
    return v_org.arquivada_em; -- idempotente
  end if;
  if exists (select 1 from public.profiles where org_id = p_org_id and is_active) then
    raise exception 'A organização ainda possui membros ativos.' using errcode = '55000';
  end if;
  -- Reusa a RPC existente (mesma ordem de locks Vault → conexão que o "Desconectar" de Canais):
  -- travar a conexão aqui e o Vault depois criaria ciclo de deadlock com uma desconexão concorrente
  -- (Codex rodada 2, #1). A RPC é idempotente se a conexão já sumiu.
  for v_cx in select * from public.marketplace_connections where org_id = p_org_id loop
    perform public.delete_marketplace_connection(v_cx.id);
  end loop;
  update public.organizations set arquivada_em = v_agora where id = p_org_id;
  return v_agora;
end;
$$;

create or replace function public.desarquivar_organizacao(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.organizations set arquivada_em = null where id = p_org_id;
  if not found then
    raise exception 'Organização não encontrada.' using errcode = 'P0002';
  end if;
end;
$$;

-- Codex #1: um refresh de token (ou callback OAuth) que termine DEPOIS do arquivamento recriaria a
-- conexão. O upsert passa a travar a org primeiro (FOR SHARE) e recusar arquivada — mesma ordem de
-- lock do arquivamento (org FOR UPDATE → conexão → Vault), então os dois serializam.
-- Copiar a função INTEIRA de 20260730185835_marketplace_connections_mercadoenvios.sql (mesma
-- assinatura, mesmo default de p_me2_habilitado) e inserir no início do corpo:
--   perform 1 from public.organizations where id = p_org_id and arquivada_em is null for share;
--   if not found then
--     raise exception 'Organização arquivada ou inexistente: reconexão bloqueada.' using errcode = '55000';
--   end if;
-- Re-aplicar o mesmo revoke/grant que a migration original aplica (linha 70 em diante).

revoke execute on function public.arquivar_organizacao(uuid) from public, anon, authenticated;
revoke execute on function public.desarquivar_organizacao(uuid) from public, anon, authenticated;
grant execute on function public.arquivar_organizacao(uuid) to service_role;
grant execute on function public.desarquivar_organizacao(uuid) to service_role;
```

- [ ] **Step 4: Aplicar local e rodar o teste** → `arquivar_organizacao: OK`. Rodar também `npm run db:check`.
- [ ] **Step 5: `src/lib/database.types.ts`** — `arquivada_em: string | null` (Row) / `arquivada_em?: string | null` (Insert/Update) em `organizations` (ordem alfabética, antes de `atualizado_em`, ~linha 2225); em `Functions` (ordem alfabética, ~3668): `arquivar_organizacao: { Args: { p_org_id: string }; Returns: string }` e `desarquivar_organizacao: { Args: { p_org_id: string }; Returns: undefined }`.
- [ ] **Step 6: Commit** `feat(adr-0175): migration arquivar/desarquivar organização`.

---

### Task 2: Edge `usuarios` — ações `archive_org` / `unarchive_org` (modelo: sonnet)

**Files:**
- Create: `supabase/functions/usuarios/arquivar-org.ts` (helper puro, testável)
- Create: `supabase/functions/usuarios/__tests__/arquivar-org.test.ts`
- Modify: `supabase/functions/usuarios/index.ts` (lista `platformAction` linha 32; novos `case` antes de `default` ~linha 313; `list_orgs` ~linha 129/138 passa a selecionar e devolver `arquivada_em`)

**Interfaces — Consumes:** RPCs da Task 1. **Produces:** ações `archive_org` / `unarchive_org` com body `{ action, org_id }`; resposta `{ ok: true, arquivada_em }` / `{ ok: true }`.

- [ ] **Step 1: Teste do helper**

```ts
import { describe, it, expect, vi } from 'vitest';
import { executarArquivamento } from '../arquivar-org.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const base = (over = {}) => ({
  orgAlvo: ORG, orgDoChamador: null as string | null, arquivar: true,
  existe: vi.fn().mockResolvedValue(true),
  rpc: vi.fn().mockResolvedValue({ data: '2026-10-01T00:00:00Z', error: null }),
  auditar: vi.fn().mockResolvedValue(null),
  ...over,
});

describe('executarArquivamento', () => {
  it('400 sem org_id', async () => {
    const d = base({ orgAlvo: '' });
    expect((await executarArquivamento(d)).status).toBe(400);
    expect(d.rpc).not.toHaveBeenCalled();
  });
  it('400 org_id que não é UUID, sem auditar', async () => {
    const d = base({ orgAlvo: 'nao-uuid' });
    expect((await executarArquivamento(d)).status).toBe(400);
    expect(d.auditar).not.toHaveBeenCalled();
  });
  it('400 própria org', async () => {
    const d = base({ orgDoChamador: ORG });
    expect((await executarArquivamento(d)).status).toBe(400);
  });
  it('404 inexistente ANTES de auditar (FK de platform_audit_events)', async () => {
    const d = base({ existe: vi.fn().mockResolvedValue(false) });
    expect((await executarArquivamento(d)).status).toBe(404);
    expect(d.auditar).not.toHaveBeenCalled();
    expect(d.rpc).not.toHaveBeenCalled();
  });
  it('500 (não 404) quando a leitura da org falha', async () => {
    const d = base({ existe: vi.fn().mockRejectedValue(new Error('db down')) });
    expect((await executarArquivamento(d)).status).toBe(500);
    expect(d.auditar).not.toHaveBeenCalled();
  });
  it('arquiva: intent → rpc → success', async () => {
    const d = base();
    const r = await executarArquivamento(d);
    expect(r).toEqual({ status: 200, body: { ok: true, arquivada_em: '2026-10-01T00:00:00Z' } });
    expect(d.rpc).toHaveBeenCalledWith('arquivar_organizacao', { p_org_id: ORG });
    expect(d.auditar.mock.calls.map((c) => c[1])).toEqual(['intent', 'success']);
  });
  it('500 se a auditoria failure não grava', async () => {
    const d = base({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: '55000', message: 'membros' } }),
      auditar: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('boom'),
    });
    expect((await executarArquivamento(d)).status).toBe(500);
  });
  it('409 membros ativos (55000) com auditoria failure', async () => {
    const d = base({ rpc: vi.fn().mockResolvedValue({ data: null, error: { code: '55000', message: 'A organização ainda possui membros ativos.' } }) });
    const r = await executarArquivamento(d);
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'A organização ainda possui membros ativos.' });
    expect(d.auditar.mock.calls.map((c) => c[1])).toEqual(['intent', 'failure']);
  });
  it('404 inexistente (P0002)', async () => {
    const d = base({ rpc: vi.fn().mockResolvedValue({ data: null, error: { code: 'P0002', message: 'Organização não encontrada.' } }) });
    expect((await executarArquivamento(d)).status).toBe(404);
  });
  it('500 se auditoria intent falha, sem chamar rpc', async () => {
    const d = base({ auditar: vi.fn().mockResolvedValue('boom') });
    expect((await executarArquivamento(d)).status).toBe(500);
    expect(d.rpc).not.toHaveBeenCalled();
  });
  it('desarquiva', async () => {
    const d = base({ arquivar: false, rpc: vi.fn().mockResolvedValue({ data: null, error: null }) });
    const r = await executarArquivamento(d);
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(d.rpc).toHaveBeenCalledWith('desarquivar_organizacao', { p_org_id: ORG });
  });
});
```

- [ ] **Step 2: `pnpm test -- supabase/functions/usuarios/__tests__/arquivar-org.test.ts`** → FAIL (módulo inexistente).
- [ ] **Step 3: Helper**

```ts
// ADR-0175: lógica das ações archive_org/unarchive_org, isolada do Deno.serve para teste.
type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
export interface ArquivamentoDeps {
  orgAlvo: string;
  orgDoChamador: string | null;
  arquivar: boolean;
  existe: (orgId: string) => Promise<boolean>;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
  auditar: (orgId: string, result: 'intent' | 'success' | 'failure', details?: Record<string, unknown>) => Promise<string | null>;
}
export interface Resposta { status: number; body: Record<string, unknown> }

const STATUS_POR_CODIGO: Record<string, number> = { P0002: 404, '55000': 409 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function executarArquivamento(d: ArquivamentoDeps): Promise<Resposta> {
  if (!d.orgAlvo || !UUID.test(d.orgAlvo)) return { status: 400, body: { error: 'org_id inválido' } };
  if (d.orgAlvo === d.orgDoChamador) return { status: 400, body: { error: 'Não é possível arquivar a sua própria empresa.' } };
  // platform_audit_events.org_id tem FK para organizations: auditar org inexistente daria 500.
  // `existe` LANÇA em erro de consulta — falha de banco não pode virar 404 (Codex rodada 2, #5).
  let existe: boolean;
  try { existe = await d.existe(d.orgAlvo); }
  catch (e) { return { status: 500, body: { error: `Falha ao ler a empresa: ${e instanceof Error ? e.message : String(e)}` } }; }
  if (!existe) return { status: 404, body: { error: 'Empresa não encontrada.' } };
  const intent = await d.auditar(d.orgAlvo, 'intent');
  if (intent) return { status: 500, body: { error: `Falha ao registrar auditoria (intent): ${intent}` } };
  const fn = d.arquivar ? 'arquivar_organizacao' : 'desarquivar_organizacao';
  const { data, error } = await d.rpc(fn, { p_org_id: d.orgAlvo });
  if (error) {
    const falha = await d.auditar(d.orgAlvo, 'failure', { code: error.code ?? null, message: error.message });
    if (falha) return { status: 500, body: { error: `Falha ao registrar auditoria (failure): ${falha}` } };
    return { status: STATUS_POR_CODIGO[error.code ?? ''] ?? 500, body: { error: error.message } };
  }
  const ok = await d.auditar(d.orgAlvo, 'success');
  if (ok) return { status: 500, body: { error: `Falha ao registrar auditoria (success): ${ok}` } };
  return { status: 200, body: d.arquivar ? { ok: true, arquivada_em: data } : { ok: true } };
}
```

- [ ] **Step 4: Ligar em `index.ts`** — adicionar `'archive_org', 'unarchive_org'` ao array de `platformAction` (linha 32) e, antes de `default:`:

```ts
    case 'archive_org':
    case 'unarchive_org': {
      if (!me.is_super_admin) return json({ error: 'forbidden' }, 403);
      const r = await executarArquivamento({
        orgAlvo: String(body.org_id ?? ''),
        orgDoChamador: (me.org_id as string | null) ?? null,
        arquivar: action === 'archive_org',
        existe: async (id) => {
          const { data, error } = await db.from('organizations').select('id').eq('id', id).maybeSingle();
          if (error) throw new Error(error.message);
          return !!data;
        },
        // db.rpc devolve um builder PromiseLike — o await converte para a Promise que o helper tipa.
        rpc: async (fn, args) => await db.rpc(fn, args),
        auditar: (orgId, result, details) => auditPlatformAction(orgId, action, result, details),
      });
      return json(r.body, r.status);
    }
```

e `import { executarArquivamento } from './arquivar-org.ts';`. Em `list_orgs`, incluir `arquivada_em` no select e no objeto devolvido.

**Codex #6 (membro em org arquivada):** nos cases `invite` e `set_active` (este só quando `active === true`), antes de gravar, ler `organizations.arquivada_em` da org de destino e responder `409 { error: 'Empresa arquivada: desarquive antes.' }` se preenchida. (A janela de corrida com o `arquivar_organizacao` é aceita e registrada no ADR — ação rara, só super-admin.)
- [ ] **Step 5: Testes passam; `deno check supabase/functions/usuarios/index.ts`** (ou o lint de edge usado no CI: `pnpm lint`).
- [ ] **Step 6: Commit** `feat(adr-0175): ações archive_org/unarchive_org na edge usuarios`.

---

### Task 3: Central (repositório/handler) + rotinas que listam orgs (modelo: sonnet)

**Files:**
- Modify: `supabase/functions/_shared/platform-admin/repository.ts:22,117-120,127-128,137`
- Modify: `supabase/functions/_shared/platform-admin/types.ts:112` (`OrgSummary.arquivada_em: string | null`)
- Modify: `supabase/functions/_shared/platform-admin/handler.ts:34-36` (repassa `include_archived: body.include_archived === true`)
- Modify: `supabase/functions/sincronizar-promocoes/index.ts:72` e `supabase/functions/materializar-metricas/index.ts:41` → `.is('arquivada_em', null)`
- Create: `supabase/functions/_shared/orgs-arquivadas.ts` (+ teste)
- Modify: `supabase/functions/notificar-liberacao/index.ts`, `supabase/functions/reconciliar-estoque/index.ts`, `supabase/functions/reconciliar-convergencia-up/processar.ts` (+ `index.ts`)
- Test: `supabase/functions/_shared/platform-admin/__tests__/repository.test.ts`, `handler.test.ts:62`

- [ ] **Step 1: Testes** — em `repository.test.ts`:
  - **Fake (`repository.test.ts:31`):** implementar `.is(col, val)` (filtra `row[col] === val`, com `undefined` tratado como `null`) e acrescentar `arquivada_em: null` a TODOS os fixtures de org existentes (inclusive o gerador do teste de 201 orgs, ~linha 63).
  - (a) `wallet` sem flag não devolve org com `arquivada_em` preenchida e os totais não a contam;
  - (b) com `include_archived: true` a org vem nas linhas com `arquivada_em`, **mas os totais (`WalletTotals`) continuam sem ela** (ADR-0175 §6);
  - (c) `organization(orgId)` devolve org arquivada (detalhe continua acessível).
  - Em `handler.test.ts:62` atualizar a expectativa para incluir `include_archived: false`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** — `DbQuery` (`repository.ts:5`) declara `is(column: string, value: null): DbQuery`; `OrgRow` ganha `arquivada_em: string | null`; o parâmetro inline de `enrichOne` (`repository.ts:86`) passa a ser `OrgRow`; selects passam a `'id,nome,slug,is_test,arquivada_em'`; `loadOrganizations(includeTest, includeArchived)` adiciona `if (!includeArchived) query = query.is('arquivada_em', null);`; `wallet` recebe `include_archived?: boolean`; `enrichOne` copia `arquivada_em` para o summary; **totais, `completeMetrics`, `completePreviews` e warnings (`repository.ts:143-163`) são todos calculados sobre `const ativas = summaries.filter((s) => !s.arquivada_em)`** — as linhas da tabela continuam usando `summaries` (Codex rodada 2, #3; teste: arquivada com leitura falhando + `include_archived: true` não deixa total `null`).
- [ ] **Step 4: Rotinas que listam `organizations` direto** — `sincronizar-promocoes:72`: `admin.from('organizations').select('id').contains('modulos_habilitados', ['promocoes']).is('arquivada_em', null)`; `materializar-metricas:41`: `admin.from('organizations').select('id').is('arquivada_em', null)`.
- [ ] **Step 4b (Codex #2): rotinas que enumeram por vendas/movimentos/anúncios** — criar `supabase/functions/_shared/orgs-arquivadas.ts`:

```ts
// ADR-0175: rotinas que enumeram por linhas de domínio (vendas, movimentos, anúncios) e não por
// conexão precisam pular orgs arquivadas explicitamente.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { paginarTudo } from './pagina.ts';

export async function listarOrgsArquivadas(admin: SupabaseClient): Promise<Set<string>> {
  // Paginado (teto de 1000 linhas do PostgREST): id omitido seria tratado como org ativa.
  const linhas = await paginarTudo<{ id: string }>(
    (de, ate) => admin.from('organizations').select('id').not('arquivada_em', 'is', null).order('id').range(de, ate),
  );
  return new Set(linhas.map((o) => o.id));
}

/** Filtro PostgREST `not.in` — vazio quando não há arquivadas (aplicar só se `!== null`). */
export function filtroNotIn(ids: Set<string>): string | null {
  return ids.size === 0 ? null : `(${[...ids].join(',')})`;
}
```

  (Conferir a assinatura de `paginarTudo` em `_shared/pagina.ts:15` e como ela propaga `error` — copiar o uso de `reconciliar-estoque/index.ts:36`.) Teste `supabase/functions/_shared/__tests__/orgs-arquivadas.test.ts`: fake paginado com 1001 ids → Set com 1001; erro → throw; `filtroNotIn(new Set())` → null; `filtroNotIn(new Set(['a','b']))` → `'(a,b)'`. Aplicar, **excluindo na consulta** (antes do limite de linhas — Codex rodada 2, #2):
  - `notificar-liberacao/index.ts:~38`: `const arquivadas = filtroNotIn(await listarOrgsArquivadas(admin));` e, na query de `ml_vendas`, `if (arquivadas) q = q.not('org_id', 'in', arquivadas);` (montar a query em variável `let q = admin.from('ml_vendas')...` antes do `await`).
  - `reconciliar-estoque/index.ts:~36`: idem nas duas queries de `estoque_movimentos` dentro dos callbacks de `paginarTudo`.
  - `reconciliar-convergencia-up/processar.ts:19`: `listarRaizesTravadas(deps, limite)` com `deps: { admin; orgsArquivadas: Set<string> }` aplica `.not('org_id', 'in', ...)` quando houver; o chamador em `index.ts` carrega com `listarOrgsArquivadas`. Ajustar o teste existente de `listarRaizesTravadas`, se houver (`grep -rn listarRaizesTravadas supabase/functions`).
- [ ] **Step 5: `pnpm test -- supabase/functions/_shared/platform-admin supabase/functions/_shared/__tests__/orgs-arquivadas.test.ts supabase/functions/reconciliar-convergencia-up`** verde; `deno check` nos arquivos alterados (`deno check supabase/functions/<fn>/index.ts` para usuarios, platform-admin, sincronizar-promocoes, materializar-metricas, notificar-liberacao, reconciliar-estoque, reconciliar-convergencia-up); `pnpm lint`.
- [ ] **Step 6: Commit** `feat(adr-0175): Central e rotinas ignoram org arquivada`.

---

### Task 4: Front — menu, diálogo, filtro, selo (modelo: sonnet)

**Files:**
- Modify: `src/hooks/usePlatformAdmin.ts:21,67` (param `include_archived`)
- Modify: `src/pages/Organizacoes.tsx` (estado `includeArchived` junto de `includeTest` ~168; hook ~194; filtro cliente ~223; selo ~355; itens no menu ⋯ após o separador ~475; checkbox ao lado de "Incluir testes" ~592)
- Create: `src/components/platform-admin/dialog-arquivar-org.tsx`
- Test: `src/pages/__tests__/Organizacoes.test.tsx`

**Interfaces — Consumes:** `callUsuarios({ action: 'archive_org' | 'unarchive_org', org_id })` (`Organizacoes.tsx:78`), `OrgSummary.arquivada_em`.

- [ ] **Step 1: Testes** em `Organizacoes.test.tsx` (mocks já existentes de `invoke` e `usePlatformAdmin`):
  - `usePlatformWallet` chamado com `include_archived: false` por padrão (ajustar a asserção da linha 177).
  - Linha com `arquivada_em: null` mostra item "Arquivar"; com data mostra "Desarquivar" e selo "Arquivada".
  - "Arquivar" abre diálogo; botão confirmar desabilitado até digitar o slug exato; ao confirmar chama `invoke('usuarios', { body: { action: 'archive_org', org_id } })`.
  - "Desarquivar" usa o mesmo diálogo (slug digitado, conforme ADR-0175 §6) e chama `unarchive_org`.
  - Org com `arquivada_em` some quando o filtro está desligado mesmo se vier na resposta (defesa do filtro cliente).
  - Codex #13: arquivar a única org da última página volta para a página anterior (não fica tela vazia); trocar "Incluir arquivadas" volta para a página 1 e reinicia `travado` (mesmo efeito que já reage a `includeTest`, ~linha 190).
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: `dialog-arquivar-org.tsx`** — `Dialog` do shadcn (mesmo usado em `org-billing.tsx`), props `{ org: { id, nome, slug } | null; modo: 'arquivar' | 'desarquivar'; onClose(); onConfirm(): Promise<void> }`. Texto arquivar: "Arquivar **{nome}**? A conexão com o Mercado Livre será removida e a empresa deixa de sincronizar. Pause os anúncios no ML antes. Para desfazer, desarquive e reconecte o ML em Canais." Texto desarquivar: "Desarquivar **{nome}**? A empresa volta à carteira; para sincronizar de novo, reconecte o Mercado Livre em Canais." Input "Digite **{slug}** para confirmar"; botão ("Arquivar" destrutivo / "Desarquivar") habilitado só com `valor === slug`; erro da edge exibido via `toast.error`.
- [ ] **Step 4: Página** — itens no menu ⋯; ao concluir: `toast.success` + invalidar a query do wallet (mesmo `queryClient.invalidateQueries` usado após outras ações da página; se não houver, usar `refetch` do hook). Selo `<Badge variant="outline">Arquivada</Badge>` junto do de Teste. Checkbox "Incluir arquivadas". Filtro cliente: `pageRows.filter((org) => (includeTest || !org.is_test) && (includeArchived || !org.arquivada_em))`.
- [ ] **Step 5: `pnpm test -- src/pages/__tests__/Organizacoes.test.tsx`**, `pnpm lint`, `pnpm build`.
- [ ] **Step 6: Commit** `feat(adr-0175): arquivar/desarquivar na Central de organizações`.

---

### Task 5: Docs + entrega (sessão principal)

- [ ] ADR-0175 → **Aceito**; `docs/decisions/README.md` (índice). Acrescentar em Consequências os riscos aceitos na revisão do Codex: (#6) corrida entre ativação de membro e arquivamento — mitigada só pela recusa na edge; (#10) mensagens já enfileiradas/execuções em voo no momento do arquivamento podem terminar (janela de segundos; sem conexão, as seguintes falham/pulam); e a trava nova em `upsert_marketplace_connection` (OAuth em org arquivada é recusado — desarquivar antes).
- [ ] `docs/how-to/central-organizacoes.md` (seção arquivar; ordem: pausar anúncios → arquivar), `docs/reference/modelo-de-dados.md` (coluna + funções), `docs/reference/edge-functions.md` (ações novas), `docs/TASKS.md`. Usar skill `docs-update-checklist`.
- [ ] `pnpm preflight:static` (portão de pré-push).
- [ ] Revisão Grok 4.7 xhigh do diff da branch (`cursor-agent -p --mode ask --model grok-4.7-xhigh ... < /dev/null`), corrigir achados (rodada única).
- [ ] `supabase db push` → deploy `usuarios`, `platform-admin` (edge que usa `_shared/platform-admin/handler.ts` — conferir nome), `sincronizar-promocoes`, `materializar-metricas`, `notificar-liberacao`, `reconciliar-estoque`, `reconciliar-convergencia-up`; conferir versões.
- [ ] CI verde → merge fast-forward na main → apagar branch/worktree.
