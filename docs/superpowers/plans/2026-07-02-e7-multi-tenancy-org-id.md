# E7 — Multi-tenancy por `org_id` (SaaS multi-empresa) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isolar 100% dos dados por organização (empresa) — cada empresa vê **somente** seus próprios dados — sem quebrar nada do que fatura hoje (todos os dados atuais pertencem à org **Avil**).

**Architecture:** Migração *expand → migrate → contract* em 7 fases: cria `organizations` + `org_id` aditivo → código passa a gravar `org_id` (RLS antiga ainda vale) → `NOT NULL` + swap de uniques → **swap de RLS** (`is_membro_operacao()` → `org_id = current_org_id()`) → credenciais por org (`marketplace_connections`) → configs por org → gate final com **suite de isolamento cross-tenant executável**. Cada fase é deployável e reversível isoladamente; para os usuários da Avil o comportamento é idêntico do início ao fim.

**Tech Stack:** Supabase (Postgres RLS, Vault, Edge Functions Deno), QStash/Redis (Upstash), React+TS+TanStack Query, vitest.

**Ordem E7 → E6 (desvio consciente do roadmap E5→E6→E7):** o objetivo do Diego é SaaS multi-empresa com certeza de segurança; o E6 (orquestração multicanal) só tem validação real com o E5 (Shopee), que não existe. Fazendo o E7 primeiro, o E6 nasce tenant-aware (conexões por org). Registrado no ADR-0027 (Task 1).

## Global Constraints

- **ADR-0043:** todo schema nasce de `supabase migration new <nome>` + `supabase db push`; **proibido** `apply_migration`/painel para DDL; rodar `npm run db:check` após cada migration.
- **Deploy nunca defasado:** edge functions sempre via CLI completa (`supabase functions deploy <fn> [--no-verify-jwt]`); mudança em `_shared/` → redeployar **todas** as funções afetadas; conferir versão pós-deploy. O mapa `verify_jwt` do `supabase/config.toml` deve ser **preservado byte a byte** (incidente 2026-06-16).
- **TDD:** função pura nova → teste RED antes (vitest; shared modules Deno são testados via `supabase/functions/**/__tests__/` já incluído no vitest).
- **Baseline de verificação (rodar íntegro em todo checkpoint):** `pnpm test` (≥1103 verdes) + `npx tsc --noEmit` + `deno check` dos workers tocados + `pnpm lint` + `pnpm build`.
- **Produção:** app está em produção; branch isolada (nunca editar main); **cada "PONTO DE DEPLOY" abaixo só executa com OK explícito do Diego**; migrations reversíveis (seção "Reversão" em cada task de migration).
- **Segurança:** tokens só no Vault; RLS obrigatória em toda tabela de domínio; `get_advisors` (security) após cada migration; nunca publicar no ML sem revisão humana.
- **Nomes fixos deste plano (consistência entre tasks):** tabela `organizations`; colunas `org_id`; helpers SQL `public.current_org_id()`, `public.is_super_admin()`; helper Deno `requireUserOrg`; tabela `marketplace_connections`; RPCs `get_connection_tokens`, `upsert_marketplace_connection`, `delete_marketplace_connection`; resolvedor `resolverConexao`; token `getValidAccessTokenConexao`.

---

## Estado atual (mapeado no código em 2026-07-02 — base factual do plano)

- **12 tabelas de domínio** com RLS roteando por `public.is_membro_operacao()` (= qualquer autenticado): `lotes`, `familias`, `variacoes`, `anuncios_externos` (CRUD "membro") · `ml_credentials`, `ml_vendas`, `ml_vendas_itens`, `ml_perguntas`, `ml_devolucoes`, `ml_moderacao`, `ml_webhook_eventos` (só SELECT "membro"; escrita só worker/service_role) · `configuracoes` (SELECT membro; INSERT/UPDATE `is_admin()`). Helpers em `supabase/migrations/20260629030908_profiles_e_helpers.sql`; swap do ADR-0047 em `20260629030910_rls_operacao_compartilhada.sql` (o loop dessa migration é o template do nosso swap).
- **`profiles`**: `id, email, nome, is_admin, is_active, allowed_menus[], created_at, updated_at`. Trigger `handle_new_user` semeia de `raw_user_meta_data`.
- **Workers** usam `adminClient()` (service_role, **bypassa RLS**) e propagam `user_id` manualmente: claim `RETURNING user_id` (`process-familia/index.ts:51-65`), webhook `resolverUserId(admin, mlUserId)` via `ml_credentials.ml_user_id` (`_shared/faturamento/io.ts:10-12`).
- **Frontend não filtra por usuário** (confia 100% na RLS) — exceto `configuracoes` (`src/lib/queries.ts:376-423`, por `user_id`).
- **Storage:** bucket `imagens`, path `{user_id}/{lote_id}/{arquivo}`; SELECT "membro" (qualquer autenticado), INSERT/UPDATE/DELETE ainda "own" (`auth.uid()` = 1ª pasta).
- **Tokens ML:** `ml_credentials` (PK `user_id`) + Vault (`access_token_secret_id`/`refresh_token_secret_id`); porta única `getValidAccessToken(userId)` (`_shared/ml/token.ts:87`, lock Redis `lock:ml:refresh:${userId}`, ADR-0012); RPCs `get_ml_tokens`/`upsert_ml_credentials`/`delete_ml_credentials` (service_role-only).
- **Hard-coded single-tenant:** marca `Avil` (`_shared/categoria/atributos.ts:11`, fallback de BRAND em `:136`/`:199`; chamada por `process-familia` e `definir-categoria-familia`); `MP_ACCESS_TOKEN` secret único de instância (`_shared/faturamento/enriquecimento.ts:14`); `lotes.numero` identity global (`20260527123422:50`); fila serial `publish-ml-${userId}` (`_shared/queue.ts:43-47`).
- **Já tenant-ready:** Telegram por linha de `configuracoes`; cache cor `cache:cor:${userId}:${codigo}` (`_shared/redis/cache-cor.ts:14`, muda a chave p/ org); cache concorrência global de propósito; espelho `anuncios_externos` com `onConflict: 'user_id,canal,codigo_pai,particao'` (`_shared/anuncios/espelhar.ts:111`).
- **`requireUser`** em `supabase/functions/_shared/auth.ts:8`.

## Decisões travadas (desvios do stub ADR-0027, documentados na Task 1)

| # | Decisão | Racional |
|---|---|---|
| D-E7.1 | **1 organização por usuário** (`profiles.org_id NOT NULL`), sem `organization_members`/`organization_invitations` | No SaaS-alvo cada empresa convida seus funcionários; ninguém atravessa orgs. RLS vira 1 subquery cacheável no initplan (`org_id = (select current_org_id())`) — mais simples, mais rápida e mais auditável que EXISTS por linha. Se um dia precisar m2m, o corpo de `current_org_id()`/policies troca num único ponto (mesmo truque do ADR-0047). O stub previa m2m; o ADR-0047 (posterior) mostrou que o modelo real da operação é "todos do mesmo time" — o backfill "1 org pessoal por user" do stub está **obsoleto**: o backfill correto é **1 org Avil com todos os profiles atuais**. |
| D-E7.2 | **Sem enum `org_role`** por ora; `profiles.is_admin` continua sendo "admin da sua org"; novo `profiles.is_super_admin` (só Diego) cria orgs | Papéis por org são YAGNI com 1 admin por empresa; `is_admin` já dirige menu/edge `usuarios`. Owner p/ billing entra no E8. |
| D-E7.3 | Policies usam **`org_id = (select public.current_org_id())`** (SECURITY DEFINER STABLE, `search_path=''`, checa `is_active`) | Initplan cacheia 1× por statement; índice em `org_id` é usado; usuário desativado perde acesso a TUDO na hora (hoje só o `ProtectedRoute` bloqueia — ganho real de segurança). |
| D-E7.4 | `ml_credentials` → **`marketplace_connections`** (por `org_id`+`canal`), migrando os **mesmos** `secret_id` do Vault (zero re-criptografia) | Resolve a pendência do ADR-0047 ("membros não publicam"): a conexão é da org, não do chamador. |
| D-E7.5 | Workers continuam service_role; a defesa é **propagação obrigatória de `org_id`** (claim `RETURNING org_id`, webhook via connections) + `NOT NULL` que **falha alto** se algum caminho esquecer | RLS não protege service_role por definição; a blindagem é estrutural + auditoria função-por-função (Task 16) + suite de isolamento (Task 9). |
| D-E7.6 | Storage: **paths não mudam** (`{user_id}/...`); SELECT vira "dono do path pertence à minha org"; INSERT/UPDATE/DELETE continuam "own" | Zero movimentação de objetos; isolamento garantido via join `profiles.org_id`. |
| D-E7.7 | `MP_ACCESS_TOKEN` (Mercado Pago) vira segredo por org no Vault (`configuracoes.mp_access_token_secret_id`); org sem MP → enriquecimento **pula com log** (graceful) | Dado financeiro da Avil não pode vazar para outra org nem o contrário. |
| D-E7.8 | Criação de org: **só super-admin** (Diego), via edge `usuarios` action `create_org`. Sem self-service até o E8 (billing) | Porta de entrada controlada; signup público continua removido. |

## Estrutura de arquivos

**Criar:**
- `supabase/migrations/<ts>_e7_organizations.sql` · `<ts>_e7_org_id_dominio.sql` · `<ts>_e7_org_id_not_null.sql` · `<ts>_e7_rls_org.sql` · `<ts>_e7_marketplace_connections.sql` · `<ts>_e7_config_org.sql` (timestamps gerados por `supabase migration new`)
- `supabase/functions/_shared/canais/conexao.ts` — resolvedor de conexão por org+canal
- `supabase/functions/_shared/__tests__/conexao.test.ts`
- `scripts/verificar-isolamento-tenant.ts` — suite executável de isolamento cross-tenant
- `docs/decisions/0027-multi-tenancy-organizations.md` — reescrito de stub → aceito

**Modificar (principais):**
- `supabase/functions/_shared/auth.ts` (requireUserOrg) · `_shared/ml/token.ts` (token por conexão) · `_shared/faturamento/io.ts` (resolver por connections) · `_shared/anuncios/espelhar.ts` (org no upsert) · `_shared/categoria/atributos.ts` (marca por org) · `_shared/redis/cache-cor.ts` (chave por org) · `_shared/queue.ts` (payloads com org implícito via linha; fila serial por org)
- Workers: `process-familia`, `publish-familia-ml`, `update-familia-ml`, `publicar-split-ml`, `ingest-lote`, `ml-webhook`, `sync-venda`, `sync-pergunta`, `sync-devolucao`, `backfill-faturamento`, `reconciliar-faturamento`, `monitorar-moderados`, `notificar-liberacao`, `remover-publicado`, `vincular-catalogo`, `reprocessar-familia`, `regenerar-copy-familia`, `ml-oauth-start`, `ml-oauth-callback`, `ml-oauth-disconnect`
- Edges autenticadas: `usuarios`, `publicar-familias`, `status-publicados`, `metricas-vendas`, `atributos-familia`, `ingest-lote`, `upload-imagens-lote`, `invalidar-cache-cor`, `excluir-lote`, `definir-categoria-familia`, `analisar-viabilidade`, `responder-pergunta`, `sugerir-resposta-pergunta`, `resumo-financeiro`
- Front: `src/lib/auth-store*` (Profile.org_id), `src/lib/queries.ts` (configuracoes por org), `src/pages/Usuarios*` (convite carrega org), exibição do nº do lote

---

# FASE 0 — ADR antes do código

### Task 1: Reescrever ADR-0027 (stub → aceito)

**Files:**
- Modify: `docs/decisions/0027-multi-tenancy-organizations.md`

**Interfaces:** Produce: decisões D-E7.1..D-E7.8 registradas — todas as tasks seguintes citam este ADR.

- [ ] **Step 1: Substituir o conteúdo do stub** pelo ADR completo: Status `Aceito (2026-07-02)`; Contexto (estado pós-ADR-0047: RLS "todo autenticado", workers service_role, dados 100% Avil); Decisão = tabela D-E7.1..D-E7.8 acima + o plano de 7 fases (resumo de 1 linha por fase); Alternativas rejeitadas (m2m `organization_members` agora — adiado com ponto único de troca; schema-por-tenant — não escala no Supabase, D6 do doc mestre); Consequências (RLS por org em 12 tabelas + storage; conexão ML da org destrava publicação por membros; `is_membro_operacao()` deixa de existir); seção "Ordem E7→E6" registrando o desvio do roadmap.
- [ ] **Step 2: Commit**

```bash
git add docs/decisions/0027-multi-tenancy-organizations.md
git commit -m "docs(adr-0027): multi-tenancy detalhado — org única por usuário, current_org_id, connections por org"
```

---

# FASE 1 — Fundação aditiva (zero mudança de comportamento)

### Task 2: Migration `e7_organizations` — org, profiles.org_id, helpers

**Files:**
- Create: `supabase/migrations/<ts>_e7_organizations.sql` (via `supabase migration new e7_organizations`)

**Interfaces:** Produces: tabela `public.organizations(id, nome, slug, marca_padrao, lote_seq, criado_em, atualizado_em)`; `profiles.org_id uuid NOT NULL`; `profiles.is_super_admin boolean`; funções `public.current_org_id() returns uuid` e `public.is_super_admin() returns boolean`; org seed `slug='avil'`.

- [ ] **Step 1: Criar a migration**

Run: `supabase migration new e7_organizations` e preencher o arquivo gerado com:

```sql
-- E7 (ADR-0027): organizações (tenants). Aditivo — nenhuma policy existente muda aqui.
create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  slug          text not null unique,
  marca_padrao  text,                       -- resolve a dívida 'Avil' hard-coded (atributos.ts)
  lote_seq      integer not null default 0, -- numeração de lote por org (Task 14)
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.organizations enable row level security;

alter table public.profiles add column org_id uuid references public.organizations(id);
alter table public.profiles add column is_super_admin boolean not null default false;

-- Backfill: TODOS os dados atuais são da Avil (ADR-0047: operação compartilhada única).
do $$
declare v_org uuid;
begin
  insert into public.organizations (nome, slug, marca_padrao)
  values ('Avil', 'avil', 'Avil')
  returning id into v_org;
  update public.profiles set org_id = v_org;
end $$;

alter table public.profiles alter column org_id set not null;
create index profiles_org_id_idx on public.profiles (org_id);

-- Diego é o super-admin (único que cria organizações).
update public.profiles p set is_super_admin = true
from auth.users u where u.id = p.id and u.email = 'analistasistemas@gmail.com';

-- Helper central do isolamento. STABLE + initplan: 1 lookup por statement.
-- is_active: usuário desativado perde TODO o acesso via RLS (hoje só o ProtectedRoute barra).
create or replace function public.current_org_id()
returns uuid language sql security definer stable set search_path = ''
as $$
  select p.org_id from public.profiles p
  where p.id = (select auth.uid()) and p.is_active
$$;
revoke execute on function public.current_org_id() from public, anon;
grant execute on function public.current_org_id() to authenticated;

create or replace function public.is_super_admin()
returns boolean language sql security definer stable set search_path = ''
as $$
  select coalesce((select p.is_super_admin from public.profiles p
                   where p.id = (select auth.uid()) and p.is_active), false)
$$;
revoke execute on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

-- Policies de organizations (membro lê a própria; admin edita; criação só via service_role).
create policy "organizations: select propria" on public.organizations
  for select to authenticated
  using (id = (select public.current_org_id()));
create policy "organizations: update admin" on public.organizations
  for update to authenticated
  using (id = (select public.current_org_id()) and public.is_admin())
  with check (id = (select public.current_org_id()) and public.is_admin());

-- handle_new_user passa a exigir org_id no metadata do convite (signup sem convite falha — desejado).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, nome, allowed_menus, org_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    coalesce(
      (select array_agg(x) from jsonb_array_elements_text(new.raw_user_meta_data->'allowed_menus') as t(x)),
      '{}'
    ),
    (new.raw_user_meta_data->>'org_id')::uuid
  );
  return new;
end $$;
```

> Conferir o corpo atual de `handle_new_user` em `20260629030908_profiles_e_helpers.sql:50-69` e replicar exatamente a extração existente de `nome`/`allowed_menus`, adicionando **apenas** o `org_id` — a assinatura acima é a referência, o corpo real vigente vence em caso de divergência de detalhe.

- [ ] **Step 2: Aplicar e verificar**

Run: `supabase db push && npm run db:check`
Expected: push OK; `db:check` sem divergência.

Run (leitura, MCP `execute_sql`): `select slug, (select count(*) from profiles where org_id = o.id) as membros from organizations o;`
Expected: `avil` com N = nº de usuários atuais (todos).

- [ ] **Step 3: `get_advisors` (security)** — zero achado novo relacionado a `organizations`/helpers.
- [ ] **Step 4: Commit** — `git commit -m "feat(e7): organizations + profiles.org_id + current_org_id/is_super_admin (fase 1)"`

**Reversão:** `drop function current_org_id, is_super_admin; alter table profiles drop column org_id, drop column is_super_admin; drop table organizations;` (restaurar `handle_new_user` da migration 20260629030908). Nenhum comportamento do app depende disso ainda.

### Task 3: Migration `e7_org_id_dominio` — org_id aditivo nas 12 tabelas

**Files:**
- Create: `supabase/migrations/<ts>_e7_org_id_dominio.sql`

**Interfaces:** Produces: coluna `org_id uuid NULL references organizations(id)` + índice em: `lotes, familias, variacoes, anuncios_externos, ml_credentials, ml_vendas, ml_vendas_itens, ml_perguntas, ml_devolucoes, ml_moderacao, ml_webhook_eventos, configuracoes`; trigger `org_id_default` (preenche do JWT em INSERT autenticado); backfill Avil completo.

- [ ] **Step 1: Criar a migration**

```sql
-- E7 fase 1 (expand): org_id NULLABLE em toda tabela de domínio + backfill Avil + índices.
-- NOT NULL só na fase 3 (depois que o código gravar org_id) — zero janela de quebra.
do $$
declare t text; v_org uuid;
begin
  select id into v_org from public.organizations where slug = 'avil';
  foreach t in array array[
    'lotes','familias','variacoes','anuncios_externos',
    'ml_credentials','ml_vendas','ml_vendas_itens','ml_perguntas',
    'ml_devolucoes','ml_moderacao','ml_webhook_eventos','configuracoes'
  ] loop
    execute format('alter table public.%I add column if not exists org_id uuid references public.organizations(id)', t);
    execute format('update public.%I set org_id = %L where org_id is null', t, v_org);
    execute format('create index if not exists %I on public.%I (org_id)', t || '_org_id_idx', t);
  end loop;
end $$;

-- Default para INSERTs autenticados (front). BEFORE trigger roda antes do WITH CHECK da RLS.
-- service_role: auth.uid() = null -> current_org_id() = null -> worker TEM de setar explicitamente
-- (o NOT NULL da fase 3 falha alto se algum caminho esquecer — defesa estrutural D-E7.5).
create or replace function public.org_id_default()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.org_id is null then
    new.org_id := public.current_org_id();
  end if;
  return new;
end $$;
revoke execute on function public.org_id_default() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'lotes','familias','variacoes','anuncios_externos',
    'ml_vendas','ml_vendas_itens','ml_perguntas',
    'ml_devolucoes','ml_moderacao','ml_webhook_eventos','configuracoes'
  ] loop
    execute format('create trigger %I before insert on public.%I for each row execute function public.org_id_default()',
                   t || '_org_default', t);
  end loop;
end $$;
```

(`ml_credentials` fica fora do trigger: escrita é só por RPC service_role e a tabela será substituída na Fase 5.)

- [ ] **Step 2: Aplicar e verificar**

Run: `supabase db push && npm run db:check`
Run (leitura): `select 'lotes' t, count(*) filter (where org_id is null) nulos from lotes union all select 'ml_vendas', count(*) filter (where org_id is null) from ml_vendas;`
Expected: `nulos = 0` em ambas (amostra; repetir mentalmente para as 12).

- [ ] **Step 3: Baseline** — `pnpm test` + build verdes (nada do app lê `org_id` ainda; comportamento idêntico).
- [ ] **Step 4: Commit** — `git commit -m "feat(e7): org_id aditivo + backfill Avil + trigger default nas 12 tabelas (fase 1)"`

**Reversão:** drop dos triggers + `alter table ... drop column org_id` por tabela. Sem dependentes até a Fase 3.

---

# FASE 2 — Código grava e propaga `org_id` (RLS antiga ainda vale — zero risco de bloqueio)

### Task 4: `requireUserOrg` — identidade org do chamador nas edges autenticadas

**Files:**
- Modify: `supabase/functions/_shared/auth.ts`
- Test: `supabase/functions/_shared/__tests__/auth-org.test.ts`

**Interfaces:**
- Consumes: `requireUser(req): Promise<AuthedUser>` existente (`auth.ts:8`).
- Produces: `requireUserOrg(req): Promise<{ userId: string; orgId: string; isAdmin: boolean }>` — lança `Response` 403 se perfil inativo/sem org. Toda edge `verify_jwt=true` passa a usar (Task 16 audita).

- [ ] **Step 1: Teste RED** — a lógica pura de decisão é extraída para testável sem rede:

```ts
// supabase/functions/_shared/__tests__/auth-org.test.ts
import { describe, expect, it } from 'vitest';
import { resolverOrgDoPerfil } from '../auth.ts';

describe('resolverOrgDoPerfil', () => {
  it('devolve org e admin de perfil ativo', () => {
    expect(resolverOrgDoPerfil({ org_id: 'org-1', is_active: true, is_admin: true }))
      .toEqual({ orgId: 'org-1', isAdmin: true });
  });
  it('rejeita perfil inativo', () => {
    expect(() => resolverOrgDoPerfil({ org_id: 'org-1', is_active: false, is_admin: false })).toThrow();
  });
  it('rejeita perfil sem org', () => {
    expect(() => resolverOrgDoPerfil({ org_id: null, is_active: true, is_admin: false })).toThrow();
  });
});
```

Run: `pnpm test auth-org` → FAIL (função não existe).

- [ ] **Step 2: Implementar em `auth.ts`**

```ts
export interface PerfilOrgRow { org_id: string | null; is_active: boolean; is_admin: boolean }
export function resolverOrgDoPerfil(p: PerfilOrgRow): { orgId: string; isAdmin: boolean } {
  if (!p.is_active || !p.org_id) throw new Error('perfil inativo ou sem organização');
  return { orgId: p.org_id, isAdmin: p.is_admin };
}

/** Identidade completa do chamador autenticado: user + org (403 se inativo/sem org). */
export async function requireUserOrg(req: Request): Promise<{ userId: string; orgId: string; isAdmin: boolean }> {
  const user = await requireUser(req);
  const admin = adminClient();
  const { data, error } = await admin
    .from('profiles').select('org_id, is_active, is_admin').eq('id', user.id).single();
  if (error || !data) throw new Response(JSON.stringify({ error: 'perfil não encontrado' }), { status: 403 });
  try {
    const { orgId, isAdmin } = resolverOrgDoPerfil(data as PerfilOrgRow);
    return { userId: user.id, orgId, isAdmin };
  } catch {
    throw new Response(JSON.stringify({ error: 'perfil inativo ou sem organização' }), { status: 403 });
  }
}
```

(Ajustar import/instância de `adminClient` ao padrão já usado no arquivo; se `requireUser` devolve outra forma, casar o campo do id.)

- [ ] **Step 3:** `pnpm test auth-org` → PASS; `deno check supabase/functions/_shared/auth.ts` verde.
- [ ] **Step 4: Commit** — `git commit -m "feat(e7): requireUserOrg — identidade org do chamador (fase 2)"`

### Task 5: Workers gravam `org_id` em todo INSERT/UPSERT + propagam do claim

**Files (todos Modify):** `supabase/functions/ingest-lote/index.ts` · `_shared/anuncios/espelhar.ts` · `_shared/faturamento/io.ts` (+ callers `ml-webhook`, `sync-venda`, `backfill-faturamento`, `reconciliar-faturamento`) · `sync-pergunta/index.ts` · `sync-devolucao/index.ts` · `monitorar-moderados/index.ts` · `process-familia/index.ts`

**Interfaces:**
- Consumes: `org_id` presente (nullable) nas 12 tabelas (Task 3).
- Produces: **todo** caminho de escrita server-side popula `org_id`; padrão de propagação = "org da linha-mãe", nunca do chamador.

O padrão é o mesmo em todos os pontos — **ler o `org_id` junto do registro-âncora e incluí-lo no payload de escrita**:

- [ ] **Step 1: `ingest-lote`** — no INSERT de `lotes`, incluir `org_id` resolvido do chamador (`requireUserOrg`); nos INSERTs de `familias`/`variacoes`, incluir `org_id: lote.org_id`.

```ts
const { userId, orgId } = await requireUserOrg(req);
// insert lotes: { ..., user_id: userId, org_id: orgId }
// inserts familias/variacoes: { ..., org_id: orgId }
```

- [ ] **Step 2: `process-familia`** — o claim atômico (linhas ~51-57) ganha `org_id` no RETURNING:

```ts
.update({ status: 'processando' /* payload atual inalterado */)
.eq('id', familia_id).eq('status', 'pendente')
.select('id, user_id, org_id')   // antes: 'id, user_id'
```

e `const orgId = claimed.org_id` passa a acompanhar `userId` em toda escrita derivada da função (nenhuma nova tabela é escrita aqui além de `familias`/`variacoes` já com org — verificação, não mudança).

- [ ] **Step 3: `_shared/anuncios/espelhar.ts`** — `espelharAnuncioExterno` recebe/propaga `org_id` no `row` do upsert (o `onConflict` **não muda ainda** — muda na Task 7 junto do unique):

```ts
// assinatura ganha orgId; row: { user_id, org_id: orgId, canal, codigo_pai, particao, ... }
```

Callers (passam `familia.org_id`): `publish-familia-ml/index.ts`, `update-familia-ml/index.ts`, `publicar-split-ml/index.ts`, `vincular-catalogo/index.ts`.

- [ ] **Step 4: Faturamento** — `_shared/faturamento/io.ts`: `resolverUserId` vira `resolverIdentidade(admin, mlUserId): Promise<{ userId: string; orgId: string } | null>` lendo `ml_credentials.select('user_id, org_id')`; todos os INSERT/UPSERT de `ml_vendas`/`ml_vendas_itens` (em `sync-venda`, `backfill-faturamento`, `reconciliar-faturamento`) e de `ml_perguntas`/`ml_devolucoes`/`ml_webhook_eventos`/`ml_moderacao` (em `ml-webhook`, `sync-pergunta`, `sync-devolucao`, `monitorar-moderados`) incluem `org_id` da identidade resolvida. Grep de conferência ao final: `rtk proxy grep -rn "from('ml_vendas')" supabase/functions | grep -i insert` → todo site com `org_id`.
- [ ] **Step 5: Baseline completo** (suite + tsc + deno check dos arquivos tocados + lint). Testes existentes desses módulos continuam verdes (org_id é campo extra).
- [ ] **Step 6: Commit** — `git commit -m "feat(e7): workers gravam/propagam org_id em toda escrita (fase 2)"`

### Task 6: PONTO DE DEPLOY 1 (OK do Diego) — código org-aware em produção

- [ ] **Step 1:** Deploy CLI completo das funções tocadas (Tasks 4-5) preservando `verify_jwt`; conferir versão de cada uma pós-deploy.
- [ ] **Step 2: Verificação em produção (leitura):** importar/processar 1 lote pequeno real; `select org_id from lotes order by criado_em desc limit 1;` → org da Avil (preenchido pelo código novo, não pelo backfill).
- [ ] **Step 3:** Registrar no TASKS.md o checkpoint.

---

# FASE 3 — Contração: NOT NULL + uniques por org

### Task 7: Migration `e7_org_id_not_null`

**Files:**
- Create: `supabase/migrations/<ts>_e7_org_id_not_null.sql`
- Modify: `supabase/functions/_shared/anuncios/espelhar.ts` (onConflict)

**Interfaces:** Produces: `org_id NOT NULL` em 11 tabelas (exceção: `ml_webhook_eventos`, espelha o `user_id` nullable de eventos de vendedor desconhecido); unique de `anuncios_externos` = `(org_id, canal, codigo_pai, particao)`; unique de `configuracoes` = `(org_id)`.

- [ ] **Step 1: Migration**

```sql
-- E7 fase 3 (contract): re-backfill de retardatários (linhas criadas por worker antigo
-- entre a fase 1 e o deploy da fase 2) e NOT NULL.
do $$
declare t text; v_org uuid;
begin
  select id into v_org from public.organizations where slug = 'avil';
  foreach t in array array[
    'lotes','familias','variacoes','anuncios_externos','ml_credentials',
    'ml_vendas','ml_vendas_itens','ml_perguntas','ml_devolucoes','ml_moderacao','configuracoes'
  ] loop
    execute format('update public.%I set org_id = %L where org_id is null', t, v_org);
    execute format('alter table public.%I alter column org_id set not null', t);
  end loop;
  -- ml_webhook_eventos: só re-backfill dos conhecidos; permanece nullable.
  update public.ml_webhook_eventos set org_id = v_org where org_id is null and user_id is not null;
end $$;

-- Identidade do anúncio passa a ser da ORG (era do user) — ADR-0025 § âncora.
alter table public.anuncios_externos
  drop constraint anuncios_externos_user_id_canal_codigo_pai_particao_key;
alter table public.anuncios_externos
  add constraint anuncios_externos_org_canal_pai_particao_key
  unique (org_id, canal, codigo_pai, particao);

-- 1 configuração por organização (linha atual da Avil já satisfaz).
create unique index configuracoes_org_uniq on public.configuracoes (org_id);
```

> O nome real do constraint antigo pode diferir — confirmar antes com `select conname from pg_constraint where conrelid = 'public.anuncios_externos'::regclass and contype='u';` e usar o nome retornado.

- [ ] **Step 2:** `_shared/anuncios/espelhar.ts:111` — `onConflict: 'org_id,canal,codigo_pai,particao'`; e o SELECT de ancoragem em `publicar-split-ml` (leitura de partições existentes) troca o filtro `user_id` → `org_id`. `remover-publicado` deleta por `(org_id, canal, codigo_pai)`.
- [ ] **Step 3:** `supabase db push && npm run db:check`; baseline completo; deploy CLI das 3 funções tocadas (com OK do Diego).
- [ ] **Step 4: Commit** — `git commit -m "feat(e7): org_id NOT NULL + identidade do anúncio por org (fase 3)"`

**Reversão:** recriar unique antigo por `user_id`, `alter column org_id drop not null`. Código da fase 2 segue funcionando (org_id continua sendo gravado).

---

# FASE 4 — O swap de RLS (o coração do isolamento)

### Task 8: Migration `e7_rls_org` — policies por org em 12 tabelas + storage

**Files:**
- Create: `supabase/migrations/<ts>_e7_rls_org.sql`

**Interfaces:**
- Consumes: `current_org_id()` (Task 2); `org_id NOT NULL` (Task 7).
- Produces: nenhuma policy referencia mais `is_membro_operacao()` (função dropada); isolamento total por org no Postgres e no Storage.

- [ ] **Step 1: Migration** (template = loop do ADR-0047 em `20260629030910`):

```sql
-- E7 fase 4: RLS por organização. Para os usuários da Avil NADA muda
-- (todos têm current_org_id() = org Avil e todas as linhas têm org_id = Avil).

-- Grupo A: operáveis (CRUD por membro da org).
do $$
declare t text;
begin
  foreach t in array array['lotes','familias','variacoes','anuncios_externos'] loop
    execute format('drop policy if exists "%s: select membro" on public.%I', t, t);
    execute format('drop policy if exists "%s: insert membro" on public.%I', t, t);
    execute format('drop policy if exists "%s: update membro" on public.%I', t, t);
    execute format('drop policy if exists "%s: delete membro" on public.%I', t, t);
    execute format('create policy "%s: select org" on public.%I for select to authenticated using (org_id = (select public.current_org_id()))', t, t);
    execute format('create policy "%s: insert org" on public.%I for insert to authenticated with check (org_id = (select public.current_org_id()))', t, t);
    execute format('create policy "%s: update org" on public.%I for update to authenticated using (org_id = (select public.current_org_id())) with check (org_id = (select public.current_org_id()))', t, t);
    execute format('create policy "%s: delete org" on public.%I for delete to authenticated using (org_id = (select public.current_org_id()))', t, t);
  end loop;
end $$;

-- Grupo B: só-leitura no app (escrita segue service_role-only, sem policy de escrita).
do $$
declare t text;
begin
  foreach t in array array['ml_credentials','ml_vendas','ml_vendas_itens','ml_perguntas','ml_devolucoes','ml_moderacao','ml_webhook_eventos'] loop
    execute format('drop policy if exists "%s: select membro" on public.%I', t, t);
    execute format('create policy "%s: select org" on public.%I for select to authenticated using (org_id = (select public.current_org_id()))', t, t);
  end loop;
end $$;

-- Grupo C: configuracoes (leitura org; escrita admin da org).
drop policy if exists "configuracoes: select membro" on public.configuracoes;
drop policy if exists "configuracoes: insert admin" on public.configuracoes;
drop policy if exists "configuracoes: update admin" on public.configuracoes;
create policy "configuracoes: select org" on public.configuracoes
  for select to authenticated using (org_id = (select public.current_org_id()));
create policy "configuracoes: insert admin org" on public.configuracoes
  for insert to authenticated with check (org_id = (select public.current_org_id()) and public.is_admin());
create policy "configuracoes: update admin org" on public.configuracoes
  for update to authenticated
  using (org_id = (select public.current_org_id()) and public.is_admin())
  with check (org_id = (select public.current_org_id()) and public.is_admin());

-- profiles: admin só enxerga/gerencia perfis da própria org.
drop policy if exists "profiles: select self or admin" on public.profiles;
create policy "profiles: select self or admin org" on public.profiles
  for select to authenticated
  using (id = (select auth.uid())
         or (public.is_admin() and org_id = (select public.current_org_id())));
-- (replicar o mesmo escopo org nas policies de insert/update/delete de profiles,
--  mantendo o predicado is_admin() atual + 'org_id = current_org_id()').

-- Storage: leitura = o DONO do path (1ª pasta) pertence à MINHA org. Paths não mudam.
drop policy if exists "imagens: select membro" on storage.objects;
create policy "imagens: select org" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'imagens'
    and exists (
      select 1 from public.profiles p
      where p.id::text = (storage.foldername(name))[1]
        and p.org_id = (select public.current_org_id())
    )
  );
-- insert/update/delete "own" (auth.uid() = 1ª pasta) permanecem como estão.

-- O gancho intermediário do ADR-0047 morre aqui.
drop function public.is_membro_operacao();
```

- [ ] **Step 2:** `supabase db push && npm run db:check`; `get_advisors` (security) → **zero** achado de RLS.
- [ ] **Step 3: Prova de não-regressão imediata (Avil):** browser-use com login real → Dashboard, Publicados, Faturamento, Financeiro, Revisão idênticos (mesmos totais de antes do swap).
- [ ] **Step 4: Commit** — `git commit -m "feat(e7): RLS por org em 12 tabelas + storage; drop is_membro_operacao (fase 4)"`

**Reversão:** re-rodar o loop do ADR-0047 (`20260629030910`) recriando as policies "membro" + recriar `is_membro_operacao()` — script de reversão colado no PR.

### Task 9: Suite de isolamento cross-tenant (a prova executável)

**Files:**
- Create: `scripts/verificar-isolamento-tenant.ts`

**Interfaces:**
- Consumes: service key + URL (`.env.local`), org Avil existente.
- Produces: script idempotente `pnpm tsx scripts/verificar-isolamento-tenant.ts` que **falha (exit 1) se qualquer vazamento existir**. Vira gate permanente (re-rodar após toda migration futura).

- [ ] **Step 1: Escrever o script** (estrutura completa; asserções são a especificação do isolamento):

```ts
// Prova de isolamento multi-tenant (E7/ADR-0027). Roda contra o projeto real.
// 1. (service_role) cria org "org-teste-isolamento" + usuário B (email sintético) + perfil;
//    insere 1 lote/família/variação/venda-marcador com org_id da org de teste.
// 2. (anon + senha de B) para CADA uma das 12 tabelas: select * -> só pode ver as linhas da org B
//    (asserção dura: nenhum registro com org_id da Avil; contagens da Avil = 0).
// 3. (anon + credencial de validação da Avil, VALIDATION_* do .env.local): select nas 12 tabelas
//    -> nenhuma linha da org de teste aparece.
// 4. Storage: B tenta createSignedUrl de um path real da Avil -> erro; lista da própria org -> ok.
// 5. Edges: B chama status-publicados -> semCredencialML/vazio (nunca dados da Avil);
//    B chama atributos-familia com familia_id da Avil -> 403/404.
// 6. Escrita cruzada: B tenta UPDATE numa família da Avil via PostgREST -> 0 linhas afetadas.
// 7. Cleanup: deleta a org de teste em cascata (service_role) e o usuário B.
// Saída: tabela PASS/FAIL por asserção; exit 1 em qualquer FAIL.

const TABELAS = ['lotes','familias','variacoes','anuncios_externos','ml_credentials','ml_vendas',
  'ml_vendas_itens','ml_perguntas','ml_devolucoes','ml_moderacao','ml_webhook_eventos','configuracoes'];
```

Implementar com `@supabase/supabase-js` (dois clients: service e anon-com-sessão), `console.table` do resultado, e cleanup em `finally`. Cada item 2-6 acima vira uma função `assertX()` própria — nenhuma asserção pode ser pulada silenciosamente.

- [ ] **Step 2: Rodar contra produção pós-swap**

Run: `pnpm tsx scripts/verificar-isolamento-tenant.ts`
Expected: todas PASS. Qualquer FAIL = **parar e corrigir antes de qualquer outra task**.

- [ ] **Step 3: Commit** — `git commit -m "test(e7): suite executável de isolamento cross-tenant"`

---

# FASE 5 — Credenciais por organização (`marketplace_connections`)

### Task 10: Migration `e7_marketplace_connections` + RPCs Vault

**Files:**
- Create: `supabase/migrations/<ts>_e7_marketplace_connections.sql`

**Interfaces:** Produces: tabela `marketplace_connections(id, org_id, canal, conta_externa_id, conta_label, scope, expires_at, access_token_secret_id, refresh_token_secret_id, criado_por, criado_em, atualizado_em)` unique `(org_id, canal)`; RPCs `get_connection_tokens(p_connection_id uuid)`, `upsert_marketplace_connection(...)`, `delete_marketplace_connection(p_connection_id uuid)` (service_role-only, espelhando `get_ml_tokens`/`upsert_ml_credentials`/`delete_ml_credentials` de `20260527141015`/`20260529185947`); linha da Avil migrada **reapontando os mesmos `secret_id`** (zero re-criptografia).

- [ ] **Step 1: Migration**

```sql
create table public.marketplace_connections (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organizations(id),
  canal                   public.canal_externo not null,
  conta_externa_id        text,          -- ml_user_id do vendedor no canal
  conta_label             text,          -- nickname
  scope                   text,
  expires_at              timestamptz,
  access_token_secret_id  uuid,
  refresh_token_secret_id uuid,
  criado_por              uuid references auth.users(id),
  criado_em               timestamptz not null default now(),
  atualizado_em           timestamptz not null default now(),
  unique (org_id, canal)
);
alter table public.marketplace_connections enable row level security;
create policy "marketplace_connections: select org" on public.marketplace_connections
  for select to authenticated using (org_id = (select public.current_org_id()));
-- escrita: só via RPCs service_role (como ml_credentials hoje).

-- Migra a conexão da Avil: MESMOS secret_ids do Vault.
insert into public.marketplace_connections
  (org_id, canal, conta_externa_id, conta_label, scope, expires_at,
   access_token_secret_id, refresh_token_secret_id, criado_por)
select c.org_id, 'mercado_livre', c.ml_user_id, c.ml_nickname, c.scope, c.expires_at,
       c.access_token_secret_id, c.refresh_token_secret_id, c.user_id
from public.ml_credentials c;
```

+ as 3 RPCs replicando a estrutura das existentes (SECURITY DEFINER, `search_path = public, vault`, `revoke execute from public, anon, authenticated`): `get_connection_tokens` retorna `(access_token, refresh_token, expires_at, conta_externa_id)` decifrados de `vault.decrypted_secrets`; `upsert_marketplace_connection` cria/atualiza os 2 segredos via `vault.create_secret`/`vault.update_secret` e a linha; `delete_marketplace_connection` apaga segredos + linha. **Copiar o corpo de `get_ml_tokens`/`upsert_ml_credentials` trocando a chave `user_id` → `connection_id`** — são as versões auditadas em produção.

- [ ] **Step 2:** `supabase db push && npm run db:check`; leitura: `select canal, conta_label, org_id from marketplace_connections;` → 1 linha (AVILBV, org Avil). `get_advisors` limpo.
- [ ] **Step 3: Commit** — `git commit -m "feat(e7): marketplace_connections por org + RPCs Vault + migração AVILBV (fase 5)"`

**Reversão:** `drop table marketplace_connections` + drop das 3 RPCs — `ml_credentials` permanece intacta como fonte até a Task 11 cortar o código.

### Task 11: Cutover do token — `getValidAccessTokenConexao` + todos os call sites

**Files:**
- Create: `supabase/functions/_shared/canais/conexao.ts` · Test: `supabase/functions/_shared/__tests__/conexao.test.ts`
- Modify: `supabase/functions/_shared/ml/token.ts` · `_shared/faturamento/io.ts` · `ml-oauth-start/index.ts` · `ml-oauth-callback/index.ts` · `ml-oauth-disconnect/index.ts` + os call sites da tabela abaixo

**Interfaces:**
- Produces:

```ts
// _shared/canais/conexao.ts
export interface ConexaoCanal {
  id: string; orgId: string; canal: string;
  contaExternaId: string | null; expiresAt: string | null;
}
/** Conexão da ORG para o canal (null = org não conectou o canal). */
export function resolverConexao(admin: SupabaseClient, orgId: string, canal: string): Promise<ConexaoCanal | null>
```

```ts
// _shared/ml/token.ts — substitui getValidAccessToken(userId)
export function getValidAccessTokenConexao(conexao: ConexaoCanal): Promise<string>
// lock Redis: `lock:token:refresh:${conexao.id}` (era lock:ml:refresh:${userId})
// tokens via rpc('get_connection_tokens', { p_connection_id: conexao.id })
// persistência do refresh via rpc('upsert_marketplace_connection', ...)
```

- [ ] **Step 1: TDD do resolvedor** (mock do client; org sem conexão → null; com conexão → mapeada) → implementar `conexao.ts`.
- [ ] **Step 2: Reescrever `token.ts`** mantendo intacta a máquina do ADR-0012 (buffer 5 min, `SET NX EX 30`, retries ~10×300ms) — muda **apenas** a chave do lock, a origem/destino dos segredos (RPCs novas) e o parâmetro. **Apagar** `getValidAccessToken(userId)` — o `deno check` aponta todos os call sites restantes (nenhum wrapper de transição: cutover completo nesta task).
- [ ] **Step 3: Atualizar os call sites** — de onde vem o `orgId` em cada um:

| Função | Origem do `orgId` |
|---|---|
| `publish-familia-ml`, `update-familia-ml`, `publicar-split-ml`, `reprocessar-familia`, `regenerar-copy-familia`, `vincular-catalogo` | `familia.org_id` (linha já carregada) |
| `process-familia` (concorrência), `remover-publicado` | `claimed.org_id` / `familia.org_id` |
| `publicar-familias`, `status-publicados`, `metricas-vendas`, `calcular-tarifa-ml`, `responder-pergunta`, `sugerir-resposta-pergunta`, `atributos-familia`, `definir-categoria-familia`, `analisar-viabilidade` | `requireUserOrg(req).orgId` |
| `ml-webhook`, `sync-venda`, `sync-pergunta`, `sync-devolucao` | `resolverIdentidade` (Task 5) — que passa a ler de `marketplace_connections.conta_externa_id` em vez de `ml_credentials.ml_user_id` |
| `monitorar-moderados`, `notificar-liberacao`, `backfill-faturamento`, `reconciliar-faturamento` | iteração por conexão (Task 12) |

Padrão em cada site: `const conexao = await resolverConexao(admin, orgId, 'mercado_livre'); if (!conexao) → caminho "sem credencial" já existente; const token = await getValidAccessTokenConexao(conexao);`

- [ ] **Step 4: OAuth org-aware** — `ml-oauth-start`: `requireUserOrg`; state no Redis vira JSON `{ user_id, org_id }` (chave `oauth:ml:state:{state}`, TTL 10 min, uso único — inalterados). `ml-oauth-callback`: lê `{user_id, org_id}` e grava via `upsert_marketplace_connection` (org do state). `ml-oauth-disconnect`: `requireUserOrg` + `delete_marketplace_connection` da conexão da org. `ml_credentials` fica **congelada** (não é mais lida nem escrita; drop na Task 17).
- [ ] **Step 5:** Baseline completo + `deno check` de TODOS os workers (garante zero call site órfão).
- [ ] **Step 6: PONTO DE DEPLOY 2 (OK do Diego):** deploy CLI completo (mudança em `_shared` → todas as funções); smoke: publicar 1 família de teste real (fluxo controlado) + Faturamento sincronizando. **Membro não-admin consegue publicar** (pendência do ADR-0047 resolvida — validar com browser-use logado como membro).
- [ ] **Step 7: Commit** — `git commit -m "feat(e7): token por conexão da org; oauth/webhook via marketplace_connections (fase 5)"`

### Task 12: Iteradores globais viram "por conexão"

**Files:** Modify: `monitorar-moderados/index.ts` · `notificar-liberacao/index.ts` · `backfill-faturamento/index.ts` · `reconciliar-faturamento/index.ts`

**Interfaces:** Consumes: `resolverConexao`/`getValidAccessTokenConexao` (Task 11). Produces: cada job agendado processa **todas** as conexões, escopando cada consulta/escrita pela org da conexão.

- [ ] **Step 1:** Em cada função: `const { data: conexoes } = await admin.from('marketplace_connections').select('*').eq('canal','mercado_livre');` e envolver o corpo atual num `for (const cx of conexoes)`, com **toda** query interna ganhando `.eq('org_id', cx.org_id)` e o token vindo de `getValidAccessTokenConexao(cx)`. Falha em uma conexão **não** aborta as demais (try/catch por conexão + log).
- [ ] **Step 2:** Baseline + deploy CLI (com OK). Com 1 conexão (Avil) o comportamento é idêntico ao atual — verificar Telegram de liberação e monitor de moderados no dia seguinte.
- [ ] **Step 3: Commit** — `git commit -m "feat(e7): jobs agendados iteram por conexão/org (fase 5)"`

---

# FASE 6 — Configuração por org + frontend

### Task 13: `configuracoes`/Telegram/marca/cache/MP por org

**Files:** Modify: `src/lib/queries.ts` (376-423) · `_shared/notificacoes/config.ts` · `_shared/categoria/atributos.ts` · `process-familia/index.ts` · `definir-categoria-familia/index.ts` · `_shared/redis/cache-cor.ts` · `invalidar-cache-cor/index.ts` · `_shared/faturamento/enriquecimento.ts` · Create: `supabase/migrations/<ts>_e7_config_org.sql`

- [ ] **Step 1: Front `configuracoes` por org** — `queries.ts`: trocar `.eq('user_id', user.id)` / `upsert({ user_id: user.id, ... })` por `.eq('org_id', profile.org_id)` / `upsert({ org_id: profile.org_id, user_id: user.id /* criado_por */ , ... }, { onConflict: 'org_id' })` (perfil já vive no auth-store — ADR-0047; expor `org_id` no tipo `Profile`).
- [ ] **Step 2: Telegram** — `_shared/notificacoes/config.ts`: `lerConfigTelegram(admin, orgId)` lê `configuracoes` por `org_id` (era por `user_id`); atualizar os callers (mesmos arquivos das notificações de venda/pergunta/devolução/liberação/moderação).
- [ ] **Step 3: Marca por org** — `atributos.ts`: `montarAtributosBase(schema, nome, marca?, marcaPadrao = 'Avil')` e `montarAtributosML(tipo, nome, marca?, marcaPadrao = 'Avil')` — o literal `MARCA` vira parâmetro com default compatível; `process-familia` e `definir-categoria-familia` leem `organizations.marca_padrao` (1 select pela org da família) e passam. TDD: caso novo em `atributos.test.ts` cobrindo marcaPadrao customizada.
- [ ] **Step 4: Cache cor por org** — `cache-cor.ts:14`: chave `cache:cor:${orgId}:${codigo}`; callers: `process-familia` (get/set) e `invalidar-cache-cor` (invalidar) passam `orgId`. Cache antigo por user expira sozinho (TTL 90d) — sem migração de chaves; custo: re-inferência de cor pontual (aceito).
- [ ] **Step 5: MP por org** — migration `e7_config_org`: `alter table configuracoes add column mp_access_token_secret_id uuid;` + RPC `get_mp_token(p_org_id uuid)` (service_role-only, Vault). Seed: mover o valor de `MP_ACCESS_TOKEN` para o Vault e apontar na linha da Avil (passo manual documentado na migration). `enriquecimento.ts:14`: token via RPC pela org da venda; ausente → `return` com log `mp_token_ausente` (enriquecimento pulado, venda persiste sem os campos MP — comportamento hoje já tolerado quando o MP falha).
- [ ] **Step 6:** Baseline + browser-use (Configurações salvam; Telegram testa; badge de marca correta numa família nova) + deploy CLI (OK do Diego).
- [ ] **Step 7: Commit** — `git commit -m "feat(e7): configuracoes/telegram/marca/cache-cor/MP por organização (fase 6)"`

### Task 14: Numeração de lote por org

**Files:** Create: parte da migration `e7_config_org` (mesma da Task 13) · Modify: `ingest-lote/index.ts` + ponto único de exibição do nº no front

- [ ] **Step 1: Migration (mesmo arquivo da Task 13):**

```sql
alter table public.lotes add column numero_org integer;
update public.lotes l set numero_org = sub.rn
from (select id, row_number() over (order by criado_em) rn from public.lotes) sub
where sub.id = l.id;
create unique index lotes_org_numero_uniq on public.lotes (org_id, numero_org);

-- Próximo número: UPDATE com row-lock na org (concorrência-safe).
create or replace function public.proximo_numero_lote(p_org uuid)
returns integer language sql security definer set search_path = ''
as $$
  update public.organizations set lote_seq = lote_seq + 1, atualizado_em = now()
  where id = p_org returning lote_seq
$$;
revoke execute on function public.proximo_numero_lote(uuid) from public, anon, authenticated;
-- seed do contador da Avil:
update public.organizations o set lote_seq = coalesce((select max(numero_org) from public.lotes where org_id = o.id), 0);
```

- [ ] **Step 2:** `ingest-lote`: `numero_org: (await admin.rpc('proximo_numero_lote', { p_org: orgId })).data` no INSERT do lote. `lotes.numero` (identity global) permanece como PK técnica de exibição legada; o front passa a exibir `numero_org ?? numero` (helper único onde o "Lote #N" é montado).
- [ ] **Step 3:** Baseline; para a Avil os números coincidem (backfill = ordem cronológica) → zero mudança visível.
- [ ] **Step 4: Commit** — `git commit -m "feat(e7): numeração de lote por organização"`

### Task 15: Front org-aware + gestão de usuários/orgs

**Files:** Modify: tipo `Profile` + auth-store · `supabase/functions/usuarios/index.ts` · `src/pages/Usuarios*.tsx`

- [ ] **Step 1:** `Profile` ganha `org_id: string` e `is_super_admin: boolean` (select do auth-store já lê `profiles`; incluir colunas).
- [ ] **Step 2: Edge `usuarios`:** todas as actions passam a validar com `requireUserOrg`; `invite` inclui `org_id: orgId` (a org do admin chamador) no `data` do `inviteUserByEmail` (o `handle_new_user` da Task 2 consome); `update_menus`/`set_active`/`set_admin` só atuam em perfis `org_id = orgId` do chamador. Nova action **`create_org`** (só `is_super_admin`): `{ nome, slug, marca_padrao, admin_email, admin_nome }` → insere org + convida o primeiro admin com `{ org_id, is_admin: true }` (o trigger cria o perfil; um UPDATE service_role marca `is_admin = true`).
- [ ] **Step 3: UI:** tela Usuarios inalterada para admins (o escopo org é transparente); se `is_super_admin`, seção extra "Organizações" (criar org + convidar admin — formulário simples).
- [ ] **Step 4:** Baseline + browser-use: convite de membro (org herdada), criação de org-teste pelo super-admin, login do admin da org nova vendo tela vazia (nenhum dado da Avil!).
- [ ] **Step 5: Commit** — `git commit -m "feat(e7): convites por org + criação de organizações (super-admin)"`

---

# FASE 7 — Gate final e limpeza

### Task 16: Auditoria função-por-função + gate completo

**Files:** nenhum código novo — verificação. Create: seção no ADR-0027 "Auditoria de identidade por função (2026-07)".

- [ ] **Step 1: Auditoria** — para **cada** função do `config.toml`, confirmar no código e registrar no ADR a linha da tabela: nome · `verify_jwt` · como resolve identidade (JWT via `requireUserOrg` / claim `RETURNING org_id` / webhook via connections / iteração por conexão) · quais tabelas escreve (todas com `org_id`?). As 33 funções, sem exceção. Qualquer função que não se encaixe em um dos 4 padrões = achado a corrigir **antes** de fechar o épico.
- [ ] **Step 2: Gate:** suite completa (≥1103) + tsc + deno check + lint + build verdes; `pnpm tsx scripts/verificar-isolamento-tenant.ts` → 100% PASS; `get_advisors` security limpo; browser-use como Diego (tudo idêntico) **e** como membro (publica) **e** como admin de org de teste (vê nada da Avil).
- [ ] **Step 3: Commit** — `git commit -m "docs(e7): auditoria de identidade por função + gate de isolamento"`

### Task 17: Limpeza diferida (executar só após ≥1 semana de produção estável)

- [ ] **Step 1:** Migration `e7_cleanup`: `drop function get_ml_tokens, upsert_ml_credentials, delete_ml_credentials; drop table ml_credentials;` (segredos do Vault **não** são apagados — foram reapontados). Remover do código qualquer referência morta (grep `ml_credentials`).
- [ ] **Step 2: Docs finais:** `docs/reference/modelo-de-dados.md` (organizations, org_id, marketplace_connections, numero_org) · `docs/reference/edge-functions.md` (identidade por função) · `docs/explanation/arquitetura.md` (+diagrama tenancy) · `docs/project-status.md` + `TASKS.md` · `obsidian-vault/` (nota de arquitetura multi-tenant) · Graphify re-ingest.
- [ ] **Step 3: Commit + fechamento do épico** (critério de saída abaixo).

---

## Critério de saída do E7 (do doc mestre, operacionalizado)

1. ✅ 2 organizações reais no banco (Avil + org de teste) com **zero** visibilidade cruzada — provado por `scripts/verificar-isolamento-tenant.ts` (todas as asserções PASS).
2. ✅ `get_advisors` (security) sem achados de RLS.
3. ✅ Suite ≥1103 + tsc + deno check + lint + build verdes; browser-use OK nos 3 perfis (Diego, membro, admin de outra org).
4. ✅ Membro não-admin da Avil publica no ML (conexão é da org) — pendência do ADR-0047 fechada.
5. ✅ Nenhuma função fora dos 4 padrões de identidade (auditoria Task 16 no ADR).

## Self-review (executado na escrita do plano)

- **Cobertura vs spec/ADR-0027:** E7.1 (orgs+helpers) → Tasks 2; E7.2 (org_id+backfill+índices) → 3, 7; E7.3 (swap policies) → 8; E7.4 (connections+Vault) → 10, 11; E7.5 (blindagem das functions) → 4, 5, 11, 12, 16; E7.6 (onboarding) → 2 (trigger), 15; E7.7 (numero por org) → 14. Extras necessários descobertos na exploração: storage (8), configuracoes/Telegram/marca/cache/MP (13), suite de isolamento (9), limpeza (17). Sem lacunas.
- **Placeholders:** dois pontos exigem leitura do estado real em execução (corpo vigente de `handle_new_user`; nome do constraint unique de `anuncios_externos`) — ambos marcados com instrução exata de como obter, não "TBD".
- **Consistência de nomes:** `current_org_id`/`requireUserOrg`/`resolverConexao`/`getValidAccessTokenConexao`/`marketplace_connections` idênticos em todas as tasks (checado).
