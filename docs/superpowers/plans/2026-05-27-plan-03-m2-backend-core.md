# Plano 03 — M2: Backend core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sair de "tudo mockado" (M1) para "Diego sobe uma planilha real + imagens, autenticado, e vê famílias/variações reais persistidas no Supabase com progresso ao vivo via Realtime". O sistema fica pronto para receber a camada de IA no M3.

**Architecture:**
- **Schema:** 4 tabelas (`lotes`, `familias`, `variacoes`, `ml_credentials`) + enums Postgres + RLS por `user_id` em tudo + Supabase Vault (`supabase_vault`) para tokens OAuth ([ADR-0007](../../decisions/0007-modelo-de-dados-4-tabelas.md))
- **Auth:** Supabase Auth (email/senha) com store Zustand global + `ProtectedRoute` que envolve `AppShell`
- **Upload:** frontend faz upload **direto pro Supabase Storage** (bucket `imagens`) com signed-URL POST; só depois chama a Edge Function passando o `lote_id`
- **Ingest:** Edge Function `ingest-lote` (Deno) parseia `.xlsx` com SheetJS, agrupa por `PAI`, faz match de imagens por nome de arquivo (`00CODIGO.jpeg`), detecta CREATE vs UPDATE ([ADR-0005](../../decisions/0005-lifecycle-publish-and-update.md)), persiste e enfileira 1 job QStash por família para processamento posterior — **idempotente** ([ADR-0006](../../decisions/0006-qstash-em-vez-de-postgres-queue.md))
- **Frontend:** `useLotes`/`useFamilias` deixam de ler de mocks e passam a usar **TanStack Query** contra o Supabase, mantendo a mesma assinatura usada pelas telas do M1; tela Progresso usa Supabase Realtime
- **QStash:** processamento real das famílias (IA, ML) fica para M3/M4. No M2, o handler `process-familia` é um **stub** que apenas marca a família como `pronto` e devolve 200, validando a integração da fila ponta-a-ponta sem bloquear no que ainda não existe.

**Tech Stack:**
- Vite 5 + React 18 + TypeScript 5 (strict) + Tailwind 4 + shadcn/ui (mantidos do M0/M1)
- **Novo:** `@tanstack/react-query` ^5 (queries/mutations/cache)
- **Novo:** `zustand` ^4 (auth global)
- **Novo:** `xlsx` ^0.20 (parser SheetJS — frontend e Edge Function)
- **Novo:** `@upstash/qstash` ^2 (cliente QStash em Deno via npm: specifier)
- Supabase Postgres 15 + Auth + Storage + Edge Functions (Deno) + Realtime + `supabase_vault` (standalone — Supabase removeu pgsodium em 2024)
- Upstash QStash (eu-central-1)

**Documentos relacionados:**
- Spec consolidado: [docs/superpowers/specs/2026-05-26-ean2marketplace-design.md](../specs/2026-05-26-ean2marketplace-design.md)
- ROADMAP: [docs/ROADMAP.md](../../ROADMAP.md) (seção 🏁 M2 — Backend core)
- TASKS.md: [docs/TASKS.md](../../TASKS.md) (seção 🏁 M2 — Backend core)
- ADRs: [0005](../../decisions/0005-lifecycle-publish-and-update.md), [0006](../../decisions/0006-qstash-em-vez-de-postgres-queue.md), [0007](../../decisions/0007-modelo-de-dados-4-tabelas.md), [0008](../../decisions/0008-estrategia-de-preco-condicional.md), [0009](../../decisions/0009-campos-payload-ml-e-categoria-deterministica.md)
- CLAUDE.md: [CLAUDE.md](../../../CLAUDE.md)

**Quando o plano estiver completo:** atualizar [docs/TASKS.md](../../TASKS.md) marcando todos os `- [ ]` do M2 como `- [x]`, mudar header de "Última atualização" e "Próximo passo recomendado" para apontar para Plano 04 (M3 IA); atualizar [docs/ROADMAP.md](../../ROADMAP.md) com status `✅ Concluído` no M2 e entrada no histórico.

---

## File Structure

Arquivos que serão criados ou modificados:

```
supabase/
├── config.toml                                       (NOVO — projeto local, opcional)
├── migrations/
│   ├── 20260527000001_enums_lotes_storage.sql       (NOVO)
│   ├── 20260527000002_familias_variacoes.sql        (NOVO)
│   └── 20260527000003_ml_credentials_vault.sql      (NOVO)
└── functions/
    ├── _shared/
    │   ├── cors.ts                                   (NOVO)
    │   ├── supabase.ts                               (NOVO — admin client)
    │   ├── auth.ts                                   (NOVO — JWT verify helper)
    │   ├── qstash.ts                                 (NOVO — verify signature)
    │   └── types.ts                                  (NOVO — domínio compartilhado)
    ├── hello/index.ts                                (mantido — smoke test do M0)
    ├── ingest-lote/index.ts                          (NOVO)
    └── process-familia/index.ts                      (NOVO — stub do M2; real no M3)

src/
├── App.tsx                                           (MODIFY: QueryClientProvider + ProtectedRoute)
├── lib/
│   ├── supabase.ts                                   (mantido — singleton client)
│   ├── utils.ts                                      (mantido)
│   ├── database.types.ts                             (NOVO — gerado por supabase gen types)
│   ├── auth.ts                                       (NOVO — funções signIn/signUp/signOut)
│   ├── storage.ts                                    (NOVO — upload + signed URL)
│   ├── ingest.ts                                     (NOVO — chama a Edge Function)
│   ├── queries.ts                                    (NOVO — TanStack Query keys + fns)
│   └── mocks/                                        (REMOVE no Step final — passou a ser dado real)
├── stores/
│   └── auth-store.ts                                 (NOVO — Zustand)
├── components/
│   ├── protected-route.tsx                           (NOVO)
│   ├── app-shell.tsx                                 (MODIFY: usa user real do store)
│   ├── topbar.tsx                                    (MODIFY: email do user + botão sair)
│   └── dropzone.tsx                                  (mantido)
├── hooks/
│   ├── useLotes.ts                                   (MODIFY: TanStack Query + Supabase)
│   ├── useFamilias.ts                                (MODIFY: TanStack Query + Supabase)
│   ├── useAuth.ts                                    (NOVO — wrapper do Zustand store)
│   ├── useLoteRealtime.ts                            (NOVO — Supabase channels)
│   └── useUploadLote.ts                              (NOVO — orquestra upload + ingest)
└── pages/
    ├── Login.tsx                                     (NOVO)
    ├── Cadastro.tsx                                  (NOVO)
    ├── ResetSenha.tsx                                (NOVO)
    ├── NovoLote.tsx                                  (MODIFY: upload real)
    ├── Progresso.tsx                                 (MODIFY: Realtime real)
    ├── Dashboard.tsx                                 (MODIFY: lotes reais)
    └── Revisao.tsx                                   (MODIFY: famílias reais — leitura apenas; mutations no M3)

tests/
├── lib/
│   ├── auth.test.ts                                  (NOVO)
│   ├── storage.test.ts                               (NOVO)
│   └── ingest.test.ts                                (NOVO)
├── hooks/
│   ├── useAuth.test.ts                               (NOVO)
│   └── useUploadLote.test.ts                         (NOVO)
└── edge/
    └── ingest-lote.test.ts                           (NOVO — unit tests dos parsers puros)

docs/
├── TASKS.md                                          (MODIFY no final — marcar M2 ✅)
└── ROADMAP.md                                        (MODIFY no final — marcar M2 ✅)

.env.local                                            (MODIFY — adicionar VITE_SUPABASE_URL/ANON_KEY se ainda não estiver)
.env.local.example                                    (CRIAR se não existir — sem valores)
```

---

## Convenções deste plano

- **Working directory:** `/Users/diego/Desktop/IA/Anuncios MktPlace`
- **Package manager:** `pnpm` (mantido)
- **TDD aplicado em:** lógica de parse/agrupamento/match da edge function, helpers de auth/storage/ingest, hooks de upload. **Pulado em:** UI de páginas de auth (smoke test só), migrations SQL (validação por `list_tables`/`execute_sql` MCP).
- **Migrations:** usam timestamps `YYYYMMDDHHMMSS` no nome do arquivo; aplicadas via MCP `apply_migration` (que executa contra o projeto remoto `txvncrgkoynoxwopfkbp` e registra em `supabase_migrations.schema_migrations`).
- **Edge Functions:** deployadas via MCP `deploy_edge_function`; testadas via `curl` direto contra a URL de produção (não há ambiente local).
- **MCPs prioritários:** `supabase-mcp-server` (DB, types, edge functions, advisors, logs), `upstash` (QStash publish + dashboard), `context7` antes de qualquer dúvida de SDK.
- **Commits:** após cada Task, prefixo `feat:` (código novo), `chore:` (migrations/setup), `test:` (testes novos), `refactor:` (mudar mocks → real), `docs:` (TASKS/ROADMAP).
- **`pnpm test` deve passar a cada commit.** Build (`pnpm build`) idem.
- **Segredos:** `.env.local` é gitignored (já está); valores reais nunca em commits. Edge Functions leem de `Deno.env.get(...)` configurado via Supabase Secrets (CLI ou dashboard).
- **Idempotência:** TODA Edge Function chamada por QStash segue o padrão do ADR-0006 (ver Task 12 Step 12.3 abaixo).

---

## Pré-requisitos

- [ ] **PR-1: M1 walkthrough aprovado** ou ajustes documentados em TASKS.md (commit recente que marca M1 como concluído)
- [ ] **PR-2: working tree clean** (`git status` mostra nada pendente)
- [ ] **PR-3: tests passing** (`pnpm test` retorna ≥ 45 passed)
- [ ] **PR-4: build OK** (`pnpm build` sem erros)
- [ ] **PR-5: `.env.local` tem todas as chaves** — Supabase URL/ANON, Upstash Redis URL/TOKEN, QStash TOKEN + SIGNING_KEY + NEXT_SIGNING_KEY, OpenRouter (não usado ainda no M2, mas adicione já para evitar idas e voltas no M3)
- [ ] **PR-6: projeto Supabase está vivo** — `mcp supabase list_projects` retorna `txvncrgkoynoxwopfkbp` com `status: ACTIVE_HEALTHY`. Banco `public` está vazio (0 tabelas, 0 migrations) confirmado em 2026-05-27.

---

## Task 1: Setup — dependências e estrutura base

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`
- Create: `supabase/functions/_shared/cors.ts`, `supabase/functions/_shared/supabase.ts`, `.env.local.example`

> Sem TDD — apenas instalação e scaffolding.

- [ ] **Step 1.1: Instalar dependências do frontend**

```bash
pnpm add @tanstack/react-query@^5 zustand@^4 xlsx@^0.20
```

Esperado: 3 novas entradas em `dependencies` no `package.json`. `xlsx` puxa SheetJS — usado também na edge function via npm: specifier do Deno.

- [ ] **Step 1.2: Criar diretório `supabase/migrations/`**

```bash
mkdir -p supabase/migrations supabase/functions/_shared
```

Esperado: dois diretórios novos.

- [ ] **Step 1.3: Criar `supabase/functions/_shared/cors.ts`**

```ts
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, upstash-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function handleOptions(): Response {
  return new Response(null, { headers: corsHeaders });
}
```

- [ ] **Step 1.4: Criar `supabase/functions/_shared/supabase.ts`**

```ts
import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function userClient(jwt: string): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são injetadas automaticamente pelo Supabase no runtime das Edge Functions (variáveis built-in, não precisam ser setadas via `supabase secrets set`).

- [ ] **Step 1.5: Criar `.env.local.example` no root**

```bash
# Frontend (Vite)
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=

# Edge Functions secrets (configurados via `supabase secrets set` ou dashboard)
# Frontend NÃO usa estes:
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
OPENROUTER_API_KEY=
```

- [ ] **Step 1.6: Validar build**

```bash
pnpm build
```

Esperado: build OK sem erros.

- [ ] **Step 1.7: Commit**

```bash
git add package.json pnpm-lock.yaml supabase/functions/_shared/ .env.local.example
git commit -m "$(cat <<'EOF'
chore: setup deps and shared edge function modules for M2

- TanStack Query, Zustand, SheetJS (xlsx) on frontend
- Edge functions shared: cors, admin/user clients
- .env.local.example with all secret keys documented

Plano 03 Task 1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Migration 001 — enums + tabela `lotes` + storage bucket

**Files:**
- Create: `supabase/migrations/20260527000001_enums_lotes_storage.sql`
- Apply via MCP: `apply_migration` (project `txvncrgkoynoxwopfkbp`)

> Não tem TDD nesta etapa — validação é via `list_tables` (MCP) e `get_advisors` (MCP) após aplicar.

- [ ] **Step 2.1: Criar `supabase/migrations/20260527000001_enums_lotes_storage.sql`**

```sql
-- ============================================================================
-- Migration 001 — Enums, tabela lotes, bucket de imagens
-- Plano 03 (M2). Refs: ADR-0007 (4 tabelas), ADR-0009 (campos extras).
-- ============================================================================

-- Extensões necessárias
create extension if not exists pgsodium with schema pgsodium;
create extension if not exists moddatetime with schema extensions;

-- ----------------------------------------------------------------------------
-- Enums de domínio
-- ----------------------------------------------------------------------------

create type public.lote_status as enum (
  'importando',  -- upload + parse em curso
  'processando', -- famílias em fila/IA/concorrência
  'revisao',     -- aguardando aprovação humana
  'publicando',  -- enfileirado pro Mercado Livre
  'concluido',   -- terminado (todas as famílias publicadas ou erro definitivo)
  'erro'         -- falha na ingestão (planilha inválida etc.)
);

create type public.familia_status as enum (
  'pendente',    -- recém criada pelo ingest
  'processando', -- worker pegou (lock de idempotência)
  'pronto',      -- IA terminou, vai pra tela de revisão
  'publicando',  -- enviado pra fila de publicação
  'publicado',  -- POST/PUT /items OK
  'erro'         -- falha definitiva
);

create type public.operacao_ml as enum ('CREATE', 'UPDATE');

create type public.tipo_aviamento as enum ('linha', 'botao', 'fita', 'outro');

create type public.tipo_origem as enum ('regex', 'ia', 'manual');

create type public.estrategia_preco as enum ('proprio', 'competitivo', 'manual');

create type public.cor_origem as enum ('descricao', 'vision', 'manual');

-- ----------------------------------------------------------------------------
-- Tabela: lotes
-- ----------------------------------------------------------------------------

create table public.lotes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  numero        bigint generated by default as identity, -- amigável pra UI ("Lote #42")
  status        public.lote_status not null default 'importando',
  planilha_path text,  -- path no bucket imagens
  imagens_paths text[] not null default '{}',
  total_familias       integer not null default 0,
  total_publicadas     integer not null default 0,
  total_erros          integer not null default 0,
  erro_mensagem        text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index lotes_user_id_criado_em_idx on public.lotes (user_id, criado_em desc);

create trigger lotes_set_updated_at
  before update on public.lotes
  for each row execute procedure extensions.moddatetime (atualizado_em);

-- RLS
alter table public.lotes enable row level security;

create policy "lotes: select own"  on public.lotes for select using (auth.uid() = user_id);
create policy "lotes: insert own"  on public.lotes for insert with check (auth.uid() = user_id);
create policy "lotes: update own"  on public.lotes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "lotes: delete own"  on public.lotes for delete using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Storage bucket: imagens (privado, com policies por user_id)
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('imagens', 'imagens', false)
on conflict (id) do nothing;

-- Path layout: {user_id}/{lote_id}/{filename}
-- A primeira pasta do path tem que bater com auth.uid() (storage.foldername(name))[1]

create policy "imagens: select own"
  on storage.objects for select
  using (bucket_id = 'imagens' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "imagens: insert own"
  on storage.objects for insert
  with check (bucket_id = 'imagens' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "imagens: update own"
  on storage.objects for update
  using (bucket_id = 'imagens' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "imagens: delete own"
  on storage.objects for delete
  using (bucket_id = 'imagens' and auth.uid()::text = (storage.foldername(name))[1]);
```

- [ ] **Step 2.2: Aplicar migration via MCP**

Chamar `mcp__supabase-mcp-server__apply_migration` com:
- `project_id`: `txvncrgkoynoxwopfkbp`
- `name`: `enums_lotes_storage`
- `query`: conteúdo completo do `20260527000001_enums_lotes_storage.sql`

Esperado: resposta `{"success": true}` (ou equivalente).

- [ ] **Step 2.3: Validar via MCP**

Chamar `mcp__supabase-mcp-server__list_tables` (schema `public`, `verbose: true`).
Esperado: tabela `lotes` listada com 12 colunas, PK `id`, FK `user_id → auth.users.id`.

Chamar `mcp__supabase-mcp-server__execute_sql` com:
```sql
select count(*) from storage.buckets where id = 'imagens';
select typname from pg_type where typname in ('lote_status', 'familia_status', 'operacao_ml');
```
Esperado: bucket count = 1; 3 tipos retornados.

Chamar `mcp__supabase-mcp-server__get_advisors` (type: `security`). Esperado: zero issues novos (ou apenas o aviso de "function search_path" se o moddatetime trigger gerar — anotar como aceitável).

- [ ] **Step 2.4: Commit**

```bash
git add supabase/migrations/20260527000001_enums_lotes_storage.sql
git commit -m "$(cat <<'EOF'
chore(db): migration 001 — enums, lotes, bucket imagens

- 7 enums de domínio (lote_status, familia_status, operacao_ml,
  tipo_aviamento, tipo_origem, estrategia_preco, cor_origem)
- Tabela lotes (12 cols) com RLS por user_id e trigger updated_at
- Bucket imagens (privado) com 4 policies de RLS por user_id
- Extensões pgsodium + moddatetime habilitadas

Refs: ADR-0007. Plano 03 Task 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Migration 002 — tabelas `familias` e `variacoes`

**Files:**
- Create: `supabase/migrations/20260527000002_familias_variacoes.sql`

> Sem TDD. Validação via MCP.

- [ ] **Step 3.1: Criar `supabase/migrations/20260527000002_familias_variacoes.sql`**

```sql
-- ============================================================================
-- Migration 002 — familias e variacoes
-- Refs: ADR-0007 (modelo), ADR-0008 (estrategia_preco), ADR-0009 (campos ML).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tabela: familias
-- ----------------------------------------------------------------------------

create table public.familias (
  id              uuid primary key default gen_random_uuid(),
  lote_id         uuid not null references public.lotes(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,

  -- Identidade do PAI
  codigo_pai      text not null,           -- código do PAI da planilha (string pra preservar zeros à esquerda)
  nome_pai        text not null,
  descricao_pai   text,
  unidade         text,

  -- Lifecycle / status
  status          public.familia_status not null default 'pendente',
  operacao        public.operacao_ml not null,

  -- Categoria ML (determinística — ADR-0009)
  tipo_aviamento  public.tipo_aviamento,
  tipo_origem     public.tipo_origem,
  categoria_ml_id text,

  -- Copywriting (preenchido no M3)
  titulo_ml       text,
  descricao_ml    text,
  atributos_ml    jsonb not null default '[]'::jsonb,

  -- Estratégia de preço (ADR-0008) — preenchido no M4
  estrategia_preco public.estrategia_preco,
  estrategia_motivo text,

  -- Envio (ADR-0009)
  shipping_mode   text not null default 'me2',
  frete_gratis    boolean not null default false,
  sale_terms      jsonb not null default
    '[{"id":"WARRANTY_TYPE","value_id":"2230279"},{"id":"WARRANTY_TIME","value_name":"30 dias"}]'::jsonb,

  -- Resultado da publicação
  ml_item_id      text,
  ml_permalink    text,
  publicado_em    timestamptz,

  -- Auditoria de edição humana (ADR-0007)
  titulo_editado_pelo_operador    boolean not null default false,
  descricao_editada_pelo_operador boolean not null default false,
  editado_em                       timestamptz,
  observacao_operador              text,

  -- Erro / fila
  erro_mensagem      text,
  qstash_message_id  text,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  unique (lote_id, codigo_pai)
);

create index familias_lote_id_idx           on public.familias (lote_id);
create index familias_user_id_codigo_pai_idx on public.familias (user_id, codigo_pai);
create index familias_user_ml_item_idx       on public.familias (user_id, ml_item_id)
  where ml_item_id is not null;
create index familias_status_idx              on public.familias (status);

create trigger familias_set_updated_at
  before update on public.familias
  for each row execute procedure extensions.moddatetime (atualizado_em);

alter table public.familias enable row level security;

create policy "familias: select own" on public.familias for select using ((select auth.uid()) = user_id);
create policy "familias: insert own" on public.familias for insert with check ((select auth.uid()) = user_id);
create policy "familias: update own" on public.familias for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "familias: delete own" on public.familias for delete using ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- Tabela: variacoes
-- ----------------------------------------------------------------------------

create table public.variacoes (
  id          uuid primary key default gen_random_uuid(),
  familia_id  uuid not null references public.familias(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,

  codigo      text not null,           -- código do filho na planilha
  nome        text,
  gtin        text,
  estoque     integer not null default 0,

  -- Preços
  preco             numeric(12,2) not null,
  preco_publicacao  numeric(12,2),  -- após estratégia (ADR-0008, ADR-0009)
  preco_editado_pelo_operador boolean not null default false,

  -- Dimensões / peso (vão pro shipping no payload ML)
  peso_gramas    numeric(10,2),
  altura_cm      numeric(10,2),
  largura_cm     numeric(10,2),
  comprimento_cm numeric(10,2),

  -- Cor da variação (ADR-0004) — preenchido no M3
  cor         text,
  cor_hex     text,
  cor_origem  public.cor_origem,

  -- Imagem
  imagem_path text,        -- path completo no bucket (user_id/lote_id/00CODIGO.jpeg)
  ml_picture_id text,      -- preenchido após upload pra ML no M4

  -- Resultado por variação
  ml_variation_id text,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  unique (familia_id, codigo)
);

create index variacoes_familia_id_idx on public.variacoes (familia_id);
create index variacoes_user_id_codigo_idx on public.variacoes (user_id, codigo);

create trigger variacoes_set_updated_at
  before update on public.variacoes
  for each row execute procedure extensions.moddatetime (atualizado_em);

alter table public.variacoes enable row level security;

create policy "variacoes: select own" on public.variacoes for select using ((select auth.uid()) = user_id);
create policy "variacoes: insert own" on public.variacoes for insert with check ((select auth.uid()) = user_id);
create policy "variacoes: update own" on public.variacoes for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "variacoes: delete own" on public.variacoes for delete using ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- Trigger: atualiza contadores de lote quando família muda de status
-- ----------------------------------------------------------------------------

create or replace function public.update_lote_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') or (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    update public.lotes l
       set total_familias   = (select count(*) from public.familias where lote_id = l.id),
           total_publicadas = (select count(*) from public.familias where lote_id = l.id and status = 'publicado'),
           total_erros      = (select count(*) from public.familias where lote_id = l.id and status = 'erro')
     where l.id = coalesce(new.lote_id, old.lote_id);
  end if;
  return new;
end;
$$;

create trigger familias_update_lote_counters
  after insert or update on public.familias
  for each row execute procedure public.update_lote_counters();
```

- [ ] **Step 3.2: Aplicar migration via MCP**

`apply_migration` com `name: familias_variacoes` e a query acima.
Esperado: sucesso.

- [ ] **Step 3.3: Validar**

`list_tables` (verbose). Esperado: 3 tabelas no public (`lotes`, `familias`, `variacoes`), com FKs corretas.

`execute_sql`:
```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename;
```
Esperado: 3 linhas, todas com `rowsecurity = true`.

`get_advisors` (type: `security`). Esperado: zero issues novos (ignorar warnings de search_path em triggers — aceitáveis para o MVP).

- [ ] **Step 3.4: Commit**

```bash
git add supabase/migrations/20260527000002_familias_variacoes.sql
git commit -m "$(cat <<'EOF'
chore(db): migration 002 — familias e variacoes com RLS

- familias: 28 cols cobrindo lifecycle, ADR-0008 e ADR-0009
- variacoes: 19 cols (preço, dimensões, cor, imagem, ml_variation_id)
- Triggers updated_at + recalc de contadores do lote
- RLS por user_id em ambas (8 policies)
- Unique (lote_id, codigo_pai) e (familia_id, codigo)

Refs: ADR-0007, ADR-0008, ADR-0009. Plano 03 Task 3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Migration 003 — `ml_credentials` + Vault

**Files:**
- Create: `supabase/migrations/20260527000003_ml_credentials_vault.sql`

> Tokens OAuth da Meli ficam criptografados em `vault.secrets`. A tabela `ml_credentials` guarda apenas metadados + o `key_id` do segredo.

- [ ] **Step 4.1: Criar `supabase/migrations/20260527000003_ml_credentials_vault.sql`**

```sql
-- ============================================================================
-- Migration 003 — ml_credentials + Supabase Vault para tokens OAuth
-- Refs: ADR-0007, CLAUDE.md (regra: tokens sempre via Vault, nunca texto puro).
-- ============================================================================

create table public.ml_credentials (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  ml_user_id         text not null,           -- ID do vendedor no Meli (não é segredo)
  ml_nickname        text,
  scope              text,
  expires_at         timestamptz not null,
  access_token_secret_id  uuid not null,      -- referência ao segredo em vault.secrets
  refresh_token_secret_id uuid not null,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);

create trigger ml_credentials_set_updated_at
  before update on public.ml_credentials
  for each row execute procedure extensions.moddatetime (atualizado_em);

alter table public.ml_credentials enable row level security;

-- Apenas SELECT pelo dono (operações de escrita são feitas pelas Edge Functions com service role)
create policy "ml_credentials: select own"
  on public.ml_credentials for select
  using ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- Helpers: criar/atualizar/ler tokens via Vault (chamados pelas Edge Functions
-- com service role)
-- ----------------------------------------------------------------------------

create or replace function public.upsert_ml_credentials(
  p_user_id      uuid,
  p_ml_user_id   text,
  p_ml_nickname  text,
  p_access_token text,
  p_refresh_token text,
  p_scope        text,
  p_expires_at   timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_access_id  uuid;
  v_refresh_id uuid;
  v_existing   public.ml_credentials%rowtype;
begin
  select * into v_existing from public.ml_credentials where user_id = p_user_id;

  if v_existing.user_id is null then
    select vault.create_secret(p_access_token,  'ml_access_'  || p_user_id::text) into v_access_id;
    select vault.create_secret(p_refresh_token, 'ml_refresh_' || p_user_id::text) into v_refresh_id;

    insert into public.ml_credentials (
      user_id, ml_user_id, ml_nickname, scope, expires_at,
      access_token_secret_id, refresh_token_secret_id
    ) values (
      p_user_id, p_ml_user_id, p_ml_nickname, p_scope, p_expires_at,
      v_access_id, v_refresh_id
    );
  else
    perform vault.update_secret(v_existing.access_token_secret_id,  p_access_token);
    perform vault.update_secret(v_existing.refresh_token_secret_id, p_refresh_token);

    update public.ml_credentials
       set ml_user_id  = p_ml_user_id,
           ml_nickname = p_ml_nickname,
           scope       = p_scope,
           expires_at  = p_expires_at
     where user_id = p_user_id;
  end if;
end;
$$;

create or replace function public.get_ml_tokens(p_user_id uuid)
returns table (access_token text, refresh_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_creds public.ml_credentials%rowtype;
begin
  select * into v_creds from public.ml_credentials where user_id = p_user_id;
  if v_creds.user_id is null then
    raise exception 'ml_credentials not found for user %', p_user_id;
  end if;

  return query
    select
      (select decrypted_secret from vault.decrypted_secrets where id = v_creds.access_token_secret_id),
      (select decrypted_secret from vault.decrypted_secrets where id = v_creds.refresh_token_secret_id),
      v_creds.expires_at;
end;
$$;

revoke execute on function public.upsert_ml_credentials(uuid, text, text, text, text, text, timestamptz) from public;
revoke execute on function public.get_ml_tokens(uuid) from public;
-- service_role tem acesso por padrão (security definer + grant default em postgres)
```

- [ ] **Step 4.2: Aplicar via MCP**

`apply_migration` com `name: ml_credentials_vault`. Esperado: sucesso.

- [ ] **Step 4.3: Validar**

```sql
select count(*) from public.ml_credentials;          -- 0
select proname from pg_proc where proname in ('upsert_ml_credentials','get_ml_tokens'); -- 2
```

Smoke test (via `execute_sql` com service role):
```sql
select public.upsert_ml_credentials(
  '00000000-0000-0000-0000-000000000001'::uuid,
  '123', 'test_user', 'fake_access_token_123',
  'fake_refresh_token_456', 'read+write',
  now() + interval '6 hours'
);
select * from public.get_ml_tokens('00000000-0000-0000-0000-000000000001'::uuid);
delete from public.ml_credentials where user_id = '00000000-0000-0000-0000-000000000001'::uuid;
```
Esperado: insert OK, select retorna `fake_access_token_123` (descriptografado), delete cascateia e remove a credential. Se algo der erro de FK em `auth.users`, removerl a linha de teste manualmente é o caminho. **Observação:** se o FK em `auth.users` impedir o insert direto, criar um usuário temporário em `auth.users` via dashboard (ou pular este smoke test e validar com usuário real no Task 7).

- [ ] **Step 4.4: Commit**

```bash
git add supabase/migrations/20260527000003_ml_credentials_vault.sql
git commit -m "$(cat <<'EOF'
chore(db): migration 003 — ml_credentials with Vault-backed tokens

- Tabela ml_credentials (metadados; tokens em vault.secrets)
- upsert_ml_credentials(): cria/atualiza segredos
- get_ml_tokens(): retorna access+refresh descriptografados (service role)
- RLS: usuário vê só os próprios metadados; tokens nunca expostos via PostgREST

Refs: ADR-0007. Plano 03 Task 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Gerar tipos TypeScript do schema

**Files:**
- Create: `src/lib/database.types.ts`
- Modify: `src/lib/supabase.ts` (tipar o `createClient`)

- [ ] **Step 5.1: Gerar tipos via MCP**

Chamar `mcp__supabase-mcp-server__generate_typescript_types` com `project_id: txvncrgkoynoxwopfkbp`. O retorno é uma string TypeScript. Salvar exatamente em `src/lib/database.types.ts`.

- [ ] **Step 5.2: Modificar `src/lib/supabase.ts`**

Importar `Database` e parametrizar o `createClient`:

```ts
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url) throw new Error('VITE_SUPABASE_URL não definida');
if (!anon) throw new Error('VITE_SUPABASE_ANON_KEY não definida');

export const supabase = createClient<Database>(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
```

(`detectSessionInUrl: false` porque usamos HashRouter — evita loops com `#access_token=...`.)

- [ ] **Step 5.3: Build + tests**

```bash
pnpm build && pnpm test
```
Esperado: 45+ passed; build OK.

- [ ] **Step 5.4: Commit**

```bash
git add src/lib/database.types.ts src/lib/supabase.ts
git commit -m "feat(types): generated DB types and typed Supabase client

- src/lib/database.types.ts gerado via supabase MCP
- supabase.ts agora é createClient<Database>(...) — autocomplete e
  type-safety em todas as queries
- persistSession on, detectSessionInUrl off (HashRouter)

Plano 03 Task 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Auth — lib, store Zustand, ProtectedRoute

**Files:**
- Create: `src/lib/auth.ts`, `src/stores/auth-store.ts`, `src/hooks/useAuth.ts`, `src/components/protected-route.tsx`
- Test: `tests/lib/auth.test.ts`, `tests/hooks/useAuth.test.ts`

- [ ] **Step 6.1: RED — `tests/lib/auth.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signIn, signUp, signOut, sendPasswordReset } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    },
  },
}));

describe('lib/auth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('signIn calls signInWithPassword and returns user on success', async () => {
    const user = { id: 'u1', email: 'a@b.co' };
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: { user, session: { access_token: 't' } } as any,
      error: null,
    });
    const result = await signIn('a@b.co', 'pw');
    expect(result.user).toEqual(user);
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@b.co',
      password: 'pw',
    });
  });

  it('signIn throws when supabase returns error', async () => {
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: { user: null, session: null } as any,
      error: { message: 'Invalid login', name: 'AuthApiError', status: 400 } as any,
    });
    await expect(signIn('a@b.co', 'wrong')).rejects.toThrow('Invalid login');
  });

  it('signUp passes email/password to supabase', async () => {
    vi.mocked(supabase.auth.signUp).mockResolvedValue({
      data: { user: { id: 'u2' } as any, session: null },
      error: null,
    });
    await signUp('new@b.co', 'pw12345678');
    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: 'new@b.co',
      password: 'pw12345678',
    });
  });

  it('signOut calls supabase signOut', async () => {
    vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null });
    await signOut();
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });

  it('sendPasswordReset calls resetPasswordForEmail', async () => {
    vi.mocked(supabase.auth.resetPasswordForEmail).mockResolvedValue({
      data: {},
      error: null,
    } as any);
    await sendPasswordReset('a@b.co');
    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('a@b.co');
  });
});
```

Run: `pnpm test tests/lib/auth.test.ts`. Esperado: 5 FAIL (`@/lib/auth` not found).

- [ ] **Step 6.2: GREEN — `src/lib/auth.ts`**

```ts
import { supabase } from './supabase';

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function sendPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) throw error;
}
```

Run: 5 PASS.

- [ ] **Step 6.3: Criar `src/stores/auth-store.ts`**

```ts
import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  hydrate: () => Promise<void>;
  setSession: (s: Session | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  loading: true,
  hydrate: async () => {
    const { data } = await supabase.auth.getSession();
    set({ session: data.session, user: data.session?.user ?? null, loading: false });
    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, user: session?.user ?? null });
    });
  },
  setSession: (session) => set({ session, user: session?.user ?? null }),
}));
```

- [ ] **Step 6.4: RED — `tests/hooks/useAuth.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAuth } from '@/hooks/useAuth';

describe('useAuth', () => {
  it('returns user/session/loading from the store', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current).toHaveProperty('user');
    expect(result.current).toHaveProperty('session');
    expect(result.current).toHaveProperty('loading');
  });
});
```

Run: FAIL (`useAuth` not found).

- [ ] **Step 6.5: GREEN — `src/hooks/useAuth.ts`**

```ts
import { useAuthStore } from '@/stores/auth-store';

export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const session = useAuthStore((s) => s.session);
  const loading = useAuthStore((s) => s.loading);
  return { user, session, loading };
}
```

Run: PASS.

- [ ] **Step 6.6: Criar `src/components/protected-route.tsx`**

```tsx
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
```

- [ ] **Step 6.7: Validar**

```bash
pnpm test && pnpm build
```
Esperado: 51+ passed; build OK.

- [ ] **Step 6.8: Commit**

```bash
git add src/lib/auth.ts src/stores/auth-store.ts src/hooks/useAuth.ts src/components/protected-route.tsx tests/lib/auth.test.ts tests/hooks/useAuth.test.ts
git commit -m "$(cat <<'EOF'
feat(auth): lib + Zustand store + useAuth + ProtectedRoute

- lib/auth.ts: signIn/signUp/signOut/sendPasswordReset (5 testes)
- stores/auth-store.ts: hidrata sessão + escuta onAuthStateChange
- hooks/useAuth.ts: seletor compacto do store
- components/protected-route.tsx: gating + redirect /login com state.from

Plano 03 Task 6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Páginas Login, Cadastro, Reset; ligar ProtectedRoute em App.tsx

**Files:**
- Create: `src/pages/Login.tsx`, `src/pages/Cadastro.tsx`, `src/pages/ResetSenha.tsx`
- Modify: `src/App.tsx`, `src/main.tsx`, `src/components/topbar.tsx`

> Smoke tests só. Lógica está em `lib/auth.ts` (já testada).

- [ ] **Step 7.1: Modificar `src/main.tsx`**

Adicionar hidratação da sessão e `QueryClientProvider`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { useAuthStore } from '@/stores/auth-store';
import '@/index.css';

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

useAuthStore.getState().hydrate();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
```

- [ ] **Step 7.2: Criar `src/pages/Login.tsx`**

```tsx
import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { signIn } from '@/lib/auth';

export default function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const dest = (loc.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      await signIn(email, senha);
      nav(dest, { replace: true });
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha no login');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-4 text-xl font-semibold">PubliAI</h1>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Input
            type="email"
            placeholder="email@empresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <Input
            type="password"
            placeholder="Senha"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
            autoComplete="current-password"
          />
          {erro && <div className="text-xs text-destructive">{erro}</div>}
          <Button type="submit" disabled={carregando}>
            {carregando ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
        <div className="mt-4 flex justify-between text-xs text-muted-foreground">
          <Link to="/cadastro" className="hover:underline">Criar conta</Link>
          <Link to="/reset-senha" className="hover:underline">Esqueci a senha</Link>
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 7.3: Criar `src/pages/Cadastro.tsx`**

```tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { signUp } from '@/lib/auth';

export default function Cadastro() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState(false);
  const nav = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      await signUp(email, senha);
      setFeito(true);
      setTimeout(() => nav('/login'), 1500);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha no cadastro');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-4 text-xl font-semibold">Criar conta</h1>
        {feito ? (
          <div className="text-sm">
            Cadastro feito. Verifique seu e-mail para confirmar a conta.
            Redirecionando para o login…
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <Input
              type="email"
              placeholder="email@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              type="password"
              placeholder="Senha (mín. 8 caracteres)"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              minLength={8}
              required
            />
            {erro && <div className="text-xs text-destructive">{erro}</div>}
            <Button type="submit">Cadastrar</Button>
          </form>
        )}
        <div className="mt-4 text-xs text-muted-foreground">
          Já tem conta? <Link to="/login" className="hover:underline">Entrar</Link>
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 7.4: Criar `src/pages/ResetSenha.tsx`**

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { sendPasswordReset } from '@/lib/auth';

export default function ResetSenha() {
  const [email, setEmail] = useState('');
  const [feito, setFeito] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      await sendPasswordReset(email);
      setFeito(true);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao enviar e-mail');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-4 text-xl font-semibold">Recuperar senha</h1>
        {feito ? (
          <div className="text-sm">
            Se a conta existir, você receberá um e-mail com as instruções.
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <Input
              type="email"
              placeholder="email@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            {erro && <div className="text-xs text-destructive">{erro}</div>}
            <Button type="submit">Enviar</Button>
          </form>
        )}
        <div className="mt-4 text-xs text-muted-foreground">
          <Link to="/login" className="hover:underline">Voltar ao login</Link>
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 7.5: Modificar `src/App.tsx`**

Envolver as rotas autenticadas em `<ProtectedRoute>`:

```tsx
import { HashRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from '@/components/app-shell';
import { ProtectedRoute } from '@/components/protected-route';
import Login from '@/pages/Login';
import Cadastro from '@/pages/Cadastro';
import ResetSenha from '@/pages/ResetSenha';
import Dashboard from '@/pages/Dashboard';
import NovoLote from '@/pages/NovoLote';
import Progresso from '@/pages/Progresso';
import Revisao from '@/pages/Revisao';
import Relatorio from '@/pages/Relatorio';
import Configuracoes from '@/pages/Configuracoes';
import NotFound from '@/pages/NotFound';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/cadastro" element={<Cadastro />} />
        <Route path="/reset-senha" element={<ResetSenha />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/novo-lote" element={<NovoLote />} />
            <Route path="/progresso/:loteId" element={<Progresso />} />
            <Route path="/revisao/:loteId" element={<Revisao />} />
            <Route path="/relatorio/:loteId" element={<Relatorio />} />
            <Route path="/configuracoes" element={<Configuracoes />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </HashRouter>
  );
}
```

(`AppShell` precisa virar layout: trocar children por `<Outlet />`.)

- [ ] **Step 7.6: Modificar `src/components/app-shell.tsx`** — usar `<Outlet />`

Substituir o lugar onde renderiza `children` por `<Outlet />`; remover prop `children`. Importar `Outlet` de `react-router-dom`.

- [ ] **Step 7.7: Modificar `src/components/topbar.tsx`** — mostrar email + botão sair

```tsx
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { signOut } from '@/lib/auth';

export function Topbar() {
  const { user } = useAuth();
  return (
    <header className="flex h-11 items-center justify-between border-b bg-background px-4 text-sm">
      <div className="text-muted-foreground">PubliAI</div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">{user?.email}</span>
        <Button size="sm" variant="ghost" onClick={() => signOut()}>
          Sair
        </Button>
      </div>
    </header>
  );
}
```

- [ ] **Step 7.8: Validar manualmente**

```bash
pnpm dev
```

1. Acessar `/#/` sem sessão → redireciona pra `/#/login`.
2. Criar conta em `/#/cadastro` com um e-mail novo → mensagem de confirmação.
3. (No dashboard do Supabase) confirmar o e-mail manualmente (Auth → Users → "..." → Confirm email) **ou** desligar confirmation em Auth → Settings durante o dev.
4. Voltar a `/#/login`, autenticar → cair em `/#/`.
5. Clicar "Sair" → volta pro login.

Encerrar `pnpm dev`.

- [ ] **Step 7.9: Tests + build**

```bash
pnpm test && pnpm build
```
Esperado: 51+ passed; build OK.

- [ ] **Step 7.10: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(auth): páginas Login/Cadastro/ResetSenha + ProtectedRoute em App

- Login com retorno pra rota original via location.state.from
- Cadastro envia confirmação por e-mail (default Supabase)
- ResetSenha dispara link mágico de reset
- AppShell vira layout (<Outlet/>), Topbar mostra email + Sair
- main.tsx: QueryClientProvider + hidratação da sessão antes de render

Plano 03 Task 7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Storage helper (`src/lib/storage.ts`)

**Files:**
- Create: `src/lib/storage.ts`
- Test: `tests/lib/storage.test.ts`

- [ ] **Step 8.1: RED — `tests/lib/storage.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { uploadFile, buildStoragePath, signedUrl } from '@/lib/storage';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ data: { path: 'u1/l1/00000123.jpeg' }, error: null }),
        createSignedUrl: vi.fn().mockResolvedValue({
          data: { signedUrl: 'https://signed.example/x' },
          error: null,
        }),
      })),
    },
  },
}));

describe('lib/storage', () => {
  it('buildStoragePath joins user/lote/filename', () => {
    expect(buildStoragePath('u1', 'l1', '00000123.jpeg')).toBe('u1/l1/00000123.jpeg');
  });

  it('buildStoragePath strips leading slashes from filename', () => {
    expect(buildStoragePath('u1', 'l1', '/sub/00000123.jpeg')).toBe('u1/l1/00000123.jpeg');
  });

  it('uploadFile returns the storage path on success', async () => {
    const file = new File(['x'], '00000123.jpeg', { type: 'image/jpeg' });
    const path = await uploadFile('imagens', 'u1/l1/00000123.jpeg', file);
    expect(path).toBe('u1/l1/00000123.jpeg');
    expect(supabase.storage.from).toHaveBeenCalledWith('imagens');
  });

  it('signedUrl returns the URL', async () => {
    const url = await signedUrl('imagens', 'u1/l1/00000123.jpeg', 60);
    expect(url).toBe('https://signed.example/x');
  });
});
```

Run: 4 FAIL.

- [ ] **Step 8.2: GREEN — `src/lib/storage.ts`**

```ts
import { supabase } from './supabase';

export function buildStoragePath(userId: string, loteId: string, filename: string): string {
  const cleanName = filename.replace(/^[/\\]+/, '').split(/[/\\]/).pop()!;
  return `${userId}/${loteId}/${cleanName}`;
}

export async function uploadFile(bucket: string, path: string, file: File): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: true,
  });
  if (error) throw error;
  return data.path;
}

export async function signedUrl(bucket: string, path: string, expiresIn = 60): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}
```

Run: 4 PASS.

- [ ] **Step 8.3: Commit**

```bash
git add src/lib/storage.ts tests/lib/storage.test.ts
git commit -m "feat(storage): upload + signed URL helpers

- buildStoragePath: monta {user_id}/{lote_id}/{filename} e isola caminho
- uploadFile: upsert true (idempotente em retry); content-type preservado
- signedUrl: TTL default 60s (curto, p/ tela de revisão)

Plano 03 Task 8.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `useUploadLote` + refactor de `NovoLote` pra upload real

**Files:**
- Create: `src/hooks/useUploadLote.ts`, `src/lib/ingest.ts`
- Test: `tests/hooks/useUploadLote.test.ts`
- Modify: `src/pages/NovoLote.tsx`

- [ ] **Step 9.1: Criar `src/lib/ingest.ts`**

Wrapper sobre `fetch` que chama a Edge Function `ingest-lote` com JWT do usuário:

```ts
import { supabase } from './supabase';

export interface IngestResult {
  loteId: string;
  totalFamilias: number;
}

export async function chamarIngest(loteId: string): Promise<IngestResult> {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sessão expirada');

  const resp = await fetch(`${url}/functions/v1/ingest-lote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ lote_id: loteId }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`ingest-lote falhou (${resp.status}): ${txt}`);
  }
  return resp.json();
}
```

- [ ] **Step 9.2: RED — `tests/hooks/useUploadLote.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUploadLote } from '@/hooks/useUploadLote';

vi.mock('@/lib/storage', () => ({
  uploadFile: vi.fn(async () => 'u1/l1/file'),
  buildStoragePath: (u: string, l: string, n: string) => `${u}/${l}/${n}`,
}));

vi.mock('@/lib/ingest', () => ({
  chamarIngest: vi.fn(async () => ({ loteId: 'l1', totalFamilias: 3 })),
}));

vi.mock('@/lib/supabase', () => {
  const single = vi.fn().mockResolvedValue({
    data: { id: 'l1', user_id: 'u1' },
    error: null,
  });
  return {
    supabase: {
      from: vi.fn(() => ({
        insert: vi.fn(() => ({ select: vi.fn(() => ({ single })) })),
        update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
      })),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    },
  };
});

describe('useUploadLote', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts with idle status and 0% progress', () => {
    const { result } = renderHook(() => useUploadLote());
    expect(result.current.status).toBe('idle');
    expect(result.current.progresso).toBe(0);
  });

  it('upload pipeline: cria lote, sobe planilha + imagens, chama ingest', async () => {
    const { result } = renderHook(() => useUploadLote());
    const planilha = new File(['x'], 'lote.xlsx');
    const imagens = [new File(['a'], '00000001.jpeg'), new File(['b'], '00000002.jpeg')];

    await act(async () => {
      await result.current.iniciar(planilha, imagens);
    });

    expect(result.current.status).toBe('concluido');
    expect(result.current.progresso).toBe(100);
    expect(result.current.loteId).toBe('l1');
  });
});
```

Run: 2 FAIL (`useUploadLote` not found).

- [ ] **Step 9.3: GREEN — `src/hooks/useUploadLote.ts`**

```ts
import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { uploadFile, buildStoragePath } from '@/lib/storage';
import { chamarIngest } from '@/lib/ingest';

export type UploadStatus = 'idle' | 'criando' | 'enviando' | 'processando' | 'concluido' | 'erro';

export function useUploadLote() {
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [progresso, setProgresso] = useState(0);
  const [loteId, setLoteId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const iniciar = useCallback(async (planilha: File, imagens: File[]) => {
    setErro(null);
    setProgresso(0);

    try {
      setStatus('criando');
      const { data: ud } = await supabase.auth.getUser();
      const userId = ud.user?.id;
      if (!userId) throw new Error('Sem sessão');

      const { data: lote, error } = await supabase
        .from('lotes')
        .insert({ user_id: userId, status: 'importando' })
        .select()
        .single();
      if (error || !lote) throw error ?? new Error('Falha criando lote');

      setLoteId(lote.id);
      setStatus('enviando');

      const planilhaPath = buildStoragePath(userId, lote.id, planilha.name);
      await uploadFile('imagens', planilhaPath, planilha);
      setProgresso(5);

      const total = imagens.length;
      const imagensPaths: string[] = [];
      const concorrencia = 4;
      let enviadas = 0;

      for (let i = 0; i < imagens.length; i += concorrencia) {
        const batch = imagens.slice(i, i + concorrencia);
        const paths = await Promise.all(
          batch.map(async (img) => {
            const p = buildStoragePath(userId, lote.id, img.name);
            await uploadFile('imagens', p, img);
            enviadas += 1;
            setProgresso(5 + Math.floor((enviadas / total) * 80));
            return p;
          })
        );
        imagensPaths.push(...paths);
      }

      await supabase
        .from('lotes')
        .update({ planilha_path: planilhaPath, imagens_paths: imagensPaths })
        .eq('id', lote.id);

      setStatus('processando');
      setProgresso(90);
      const resultado = await chamarIngest(lote.id);
      setProgresso(100);
      setStatus('concluido');
      return resultado;
    } catch (err) {
      setStatus('erro');
      setErro(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, []);

  return { status, progresso, loteId, erro, iniciar };
}
```

Run: 2 PASS.

- [ ] **Step 9.4: Modificar `src/pages/NovoLote.tsx`** — substituir o mock pelo hook

(Manter o layout/dropzones existentes do M1; trocar apenas a função `onSubmit` para chamar `iniciar(planilha, imagens)` e navegar para `/progresso/${loteId}` quando voltar.)

Patch direcionado:

```tsx
import { useNavigate } from 'react-router-dom';
import { useUploadLote } from '@/hooks/useUploadLote';
// ... resto dos imports do componente atual
const nav = useNavigate();
const { status, progresso, loteId, erro, iniciar } = useUploadLote();

async function publicar() {
  if (!planilha || imagens.length === 0) return;
  try {
    const r = await iniciar(planilha, imagens);
    nav(`/progresso/${r.loteId}`);
  } catch {
    /* erro já exposto pelo hook */
  }
}
```

Atualizar a barra de progresso pra usar `progresso` real e o botão pra desabilitar enquanto `status !== 'idle' && status !== 'erro'`. Exibir `erro` se houver.

- [ ] **Step 9.5: Validar**

```bash
pnpm test && pnpm build
```
Esperado: 53+ passed; build OK.

Não testar fluxo ponta-a-ponta ainda — a edge function `ingest-lote` não existe; a chamada vai 404. Isso é esperado e fica para Task 12.

- [ ] **Step 9.6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(upload): useUploadLote + NovoLote integrado a storage real

- lib/ingest.ts: chama POST /functions/v1/ingest-lote com JWT do user
- useUploadLote: cria lote → sobe planilha → sobe imagens (paralelo 4 por
  vez) → marca paths no lote → chama ingest-lote → progresso 0-100
- NovoLote: usa o hook; barra reflete bytes reais; redireciona pra
  /progresso/:loteId quando ingest retorna

Edge function ingest-lote ainda não existe (Task 12); chamada vai
falhar até lá, esperado.

Plano 03 Task 9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `lib/queue.ts` (wrapper QStash) + secrets na Supabase

**Files:**
- Create: `supabase/functions/_shared/queue.ts`

> Wrapper roda em Deno (Edge Functions), não no frontend. Frontend não precisa enfileirar nada.

- [ ] **Step 10.1: Configurar secrets na Supabase via Bash**

```bash
supabase secrets set \
  QSTASH_TOKEN="$(grep ^QSTASH_TOKEN= .env.local | cut -d= -f2-)" \
  QSTASH_CURRENT_SIGNING_KEY="$(grep ^QSTASH_CURRENT_SIGNING_KEY= .env.local | cut -d= -f2-)" \
  QSTASH_NEXT_SIGNING_KEY="$(grep ^QSTASH_NEXT_SIGNING_KEY= .env.local | cut -d= -f2-)" \
  UPSTASH_REDIS_REST_URL="$(grep ^UPSTASH_REDIS_REST_URL= .env.local | cut -d= -f2-)" \
  UPSTASH_REDIS_REST_TOKEN="$(grep ^UPSTASH_REDIS_REST_TOKEN= .env.local | cut -d= -f2-)" \
  OPENROUTER_API_KEY="$(grep ^OPENROUTER_API_KEY= .env.local | cut -d= -f2-)" \
  --project-ref txvncrgkoynoxwopfkbp
```

Se `supabase` CLI não estiver instalada, alternativa via dashboard: Project Settings → Edge Functions → Secrets → adicionar cada par. Anotar o caminho usado em comentário no commit.

Validar:
```bash
supabase secrets list --project-ref txvncrgkoynoxwopfkbp
```
Esperado: 6 chaves listadas (sem valores).

- [ ] **Step 10.2: Criar `supabase/functions/_shared/queue.ts`**

```ts
import { Client, Receiver } from 'npm:@upstash/qstash@^2';

let cachedClient: Client | null = null;
let cachedReceiver: Receiver | null = null;

export function qstashClient(): Client {
  if (cachedClient) return cachedClient;
  cachedClient = new Client({ token: Deno.env.get('QSTASH_TOKEN')! });
  return cachedClient;
}

export function qstashReceiver(): Receiver {
  if (cachedReceiver) return cachedReceiver;
  cachedReceiver = new Receiver({
    currentSigningKey: Deno.env.get('QSTASH_CURRENT_SIGNING_KEY')!,
    nextSigningKey: Deno.env.get('QSTASH_NEXT_SIGNING_KEY')!,
  });
  return cachedReceiver;
}

export interface ProcessFamiliaJob {
  familia_id: string;
  lote_id: string;
}

export async function enfileirarFamilia(job: ProcessFamiliaJob): Promise<string> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const target = `${url}/functions/v1/process-familia`;
  const { messageId } = await qstashClient().publishJSON({
    url: target,
    body: job,
    retries: 3,
  });
  return messageId;
}

export async function verificarAssinatura(req: Request, body: string): Promise<boolean> {
  const sig = req.headers.get('upstash-signature');
  if (!sig) return false;
  try {
    return await qstashReceiver().verify({ signature: sig, body });
  } catch {
    return false;
  }
}
```

- [ ] **Step 10.3: Commit**

```bash
git add supabase/functions/_shared/queue.ts
git commit -m "$(cat <<'EOF'
feat(edge): shared QStash wrapper

- qstashClient() / qstashReceiver() singletons
- enfileirarFamilia(): publishJSON contra /functions/v1/process-familia
  com retries: 3
- verificarAssinatura(): valida header upstash-signature contra a body
  (current + next signing keys)

Secrets configuradas via `supabase secrets set` (M0 deferido).

Plano 03 Task 10.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Tipos e helpers compartilhados das Edge Functions

**Files:**
- Create: `supabase/functions/_shared/auth.ts`, `supabase/functions/_shared/types.ts`, `supabase/functions/_shared/parser.ts`
- Test: `tests/edge/ingest-lote.test.ts` (unitário das funções puras)

> O parser e o agrupador são funções puras → 100% TDD em ambiente Node (vitest), mesmo sendo executadas no Deno. Reuso é via `import` estático com sintaxe compatível.

- [ ] **Step 11.1: Criar `supabase/functions/_shared/auth.ts`**

```ts
import { adminClient } from './supabase.ts';

export interface AuthedUser {
  id: string;
  email: string | null;
}

export async function requireUser(req: Request): Promise<AuthedUser> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Response('Missing bearer token', { status: 401 });
  }
  const token = authHeader.slice('Bearer '.length);
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) {
    throw new Response('Invalid token', { status: 401 });
  }
  return { id: data.user.id, email: data.user.email ?? null };
}
```

- [ ] **Step 11.2: Criar `supabase/functions/_shared/types.ts`**

```ts
export interface PlanilhaRow {
  CODIGO: string;
  PAI: string;
  NOME: string;
  UNIDADE: string;
  GTIN: string | null;
  PRECO: number;
  ESTOQUE: number;
  DESCRICAO_DETALHADO: string;
  PESO_GRAMAS: number;
  ALTURA_CM: number;
  LARGURA_CM: number;
  COMPRIMENTO_CM: number;
}

export interface FamiliaAgrupada {
  codigo_pai: string;
  nome_pai: string;
  descricao_pai: string;
  unidade: string;
  variacoes: PlanilhaRow[];
}

export const COLUNAS_OBRIGATORIAS = [
  'CODIGO', 'PAI', 'NOME', 'UNIDADE', 'GTIN', 'PRECO', 'ESTOQUE',
  'DESCRICAO_DETALHADO', 'PESO_GRAMAS', 'ALTURA_CM', 'LARGURA_CM', 'COMPRIMENTO_CM',
] as const;
```

- [ ] **Step 11.3: RED — `tests/edge/ingest-lote.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  validarColunas,
  agruparPorPai,
  normalizarCodigo,
  matchImagem,
} from '../../supabase/functions/_shared/parser';
import type { PlanilhaRow } from '../../supabase/functions/_shared/types';

const baseRow = (over: Partial<PlanilhaRow>): PlanilhaRow => ({
  CODIGO: '00000000', PAI: '0', NOME: '', UNIDADE: 'PC',
  GTIN: null, PRECO: 0, ESTOQUE: 0, DESCRICAO_DETALHADO: '',
  PESO_GRAMAS: 0, ALTURA_CM: 0, LARGURA_CM: 0, COMPRIMENTO_CM: 0,
  ...over,
});

describe('validarColunas', () => {
  it('aceita quando todas as colunas obrigatórias estão presentes', () => {
    const cols = ['CODIGO','PAI','NOME','UNIDADE','GTIN','PRECO','ESTOQUE','DESCRICAO_DETALHADO','PESO_GRAMAS','ALTURA_CM','LARGURA_CM','COMPRIMENTO_CM'];
    expect(() => validarColunas(cols)).not.toThrow();
  });
  it('lança quando falta coluna', () => {
    const cols = ['CODIGO','PAI','NOME'];
    expect(() => validarColunas(cols)).toThrow(/UNIDADE|GTIN|PRECO/);
  });
});

describe('normalizarCodigo', () => {
  it('zero-pad para 8 dígitos', () => {
    expect(normalizarCodigo(123)).toBe('00000123');
    expect(normalizarCodigo('123')).toBe('00000123');
    expect(normalizarCodigo('00000123')).toBe('00000123');
  });
});

describe('agruparPorPai', () => {
  it('PAI=0 vira chave; filhos têm PAI = codigo do pai', () => {
    const rows: PlanilhaRow[] = [
      baseRow({ CODIGO: '100', PAI: '0', NOME: 'Linha Azul - Família', DESCRICAO_DETALHADO: 'Pai' }),
      baseRow({ CODIGO: '101', PAI: '100', NOME: 'Linha Azul Royal', PRECO: 5 }),
      baseRow({ CODIGO: '102', PAI: '100', NOME: 'Linha Azul Marinho', PRECO: 5 }),
    ];
    const grupos = agruparPorPai(rows);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].codigo_pai).toBe('00000100');
    expect(grupos[0].variacoes).toHaveLength(2);
  });

  it('linha órfã (PAI aponta pra código que não existe) é ignorada e reportada', () => {
    const rows = [baseRow({ CODIGO: '999', PAI: '888', NOME: 'Órfã' })];
    expect(() => agruparPorPai(rows)).toThrow(/órfã|orfã|999/i);
  });

  it('PAI sem filhos vira família com 0 variações (anúncio só-pai não é vendável; vai pra erro)', () => {
    const rows = [baseRow({ CODIGO: '500', PAI: '0', NOME: 'Pai Solitário' })];
    expect(() => agruparPorPai(rows)).toThrow(/sem variações|solitário/i);
  });
});

describe('matchImagem', () => {
  it('encontra imagem por nome 00CODIGO.jpeg', () => {
    const paths = ['u1/l1/00000100.jpeg', 'u1/l1/00000101.jpeg', 'u1/l1/00000102.jpeg'];
    expect(matchImagem('100', paths)).toBe('u1/l1/00000100.jpeg');
    expect(matchImagem('101', paths)).toBe('u1/l1/00000101.jpeg');
  });
  it('aceita PNG, JPG, JPEG', () => {
    const paths = ['u1/l1/00000200.png'];
    expect(matchImagem('200', paths)).toBe('u1/l1/00000200.png');
  });
  it('retorna undefined se não houver match', () => {
    expect(matchImagem('999', ['u1/l1/00000100.jpeg'])).toBeUndefined();
  });
});
```

Run: 9 FAIL (`parser` not found).

- [ ] **Step 11.4: GREEN — `supabase/functions/_shared/parser.ts`**

```ts
import type { PlanilhaRow, FamiliaAgrupada } from './types.ts';
import { COLUNAS_OBRIGATORIAS } from './types.ts';

export function validarColunas(cols: string[]): void {
  const set = new Set(cols.map((c) => c.toUpperCase().trim()));
  const faltando = COLUNAS_OBRIGATORIAS.filter((c) => !set.has(c));
  if (faltando.length) {
    throw new Error(`Colunas obrigatórias ausentes: ${faltando.join(', ')}`);
  }
}

export function normalizarCodigo(codigo: string | number): string {
  const s = String(codigo).trim();
  return s.padStart(8, '0');
}

export function agruparPorPai(rows: PlanilhaRow[]): FamiliaAgrupada[] {
  const pais = new Map<string, PlanilhaRow>();
  const filhos = new Map<string, PlanilhaRow[]>();

  for (const r of rows) {
    const codigo = normalizarCodigo(r.CODIGO);
    const paiCampo = String(r.PAI).trim();
    if (paiCampo === '0' || paiCampo === '') {
      pais.set(codigo, r);
    } else {
      const pai = normalizarCodigo(paiCampo);
      const lista = filhos.get(pai) ?? [];
      lista.push(r);
      filhos.set(pai, lista);
    }
  }

  for (const [codigoFilho, lista] of filhos.entries()) {
    for (const f of lista) {
      const paiNorm = normalizarCodigo(String(f.PAI).trim());
      if (!pais.has(paiNorm)) {
        throw new Error(`Linha órfã: filho ${normalizarCodigo(f.CODIGO)} aponta pra PAI ${paiNorm} que não existe na planilha`);
      }
    }
    void codigoFilho;
  }

  const grupos: FamiliaAgrupada[] = [];
  for (const [codigo, pai] of pais.entries()) {
    const variacoes = filhos.get(codigo) ?? [];
    if (variacoes.length === 0) {
      throw new Error(`PAI ${codigo} (${pai.NOME}) sem variações — anúncio só-pai não é vendável`);
    }
    grupos.push({
      codigo_pai: codigo,
      nome_pai: pai.NOME,
      descricao_pai: pai.DESCRICAO_DETALHADO,
      unidade: pai.UNIDADE,
      variacoes,
    });
  }
  return grupos;
}

const EXT_VALIDAS = /\.(jpe?g|png)$/i;

export function matchImagem(codigo: string | number, paths: string[]): string | undefined {
  const alvo = normalizarCodigo(codigo);
  return paths.find((p) => {
    if (!EXT_VALIDAS.test(p)) return false;
    const filename = p.split('/').pop() ?? '';
    const base = filename.replace(EXT_VALIDAS, '');
    return base === alvo;
  });
}
```

Run: 9 PASS.

- [ ] **Step 11.5: Build + tests**

```bash
pnpm test && pnpm build
```
Esperado: 62+ passed; build OK (TS aceita `.ts` extension nos imports relativos das funções, mas só pra Deno; o vitest no Node precisa do `.ts` também — confirmar nos imports do teste).

- [ ] **Step 11.6: Commit**

```bash
git add supabase/functions/_shared/auth.ts supabase/functions/_shared/types.ts supabase/functions/_shared/parser.ts tests/edge/ingest-lote.test.ts
git commit -m "$(cat <<'EOF'
feat(edge): shared types, JWT verify, planilha parser (TDD)

- _shared/auth.ts: requireUser(req) → 401 ou AuthedUser
- _shared/types.ts: PlanilhaRow, FamiliaAgrupada, COLUNAS_OBRIGATORIAS
- _shared/parser.ts: validarColunas, normalizarCodigo (zero-pad 8),
  agruparPorPai (detecta órfão e pai-sem-filhos), matchImagem (jpeg|jpg|png)
- 9 testes unitários cobrem parsers

Plano 03 Task 11.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Edge Function `ingest-lote` (skeleton + auth + leitura do Storage)

**Files:**
- Create: `supabase/functions/ingest-lote/index.ts`

- [ ] **Step 12.1: Criar `supabase/functions/ingest-lote/index.ts`**

```ts
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { validarColunas, agruparPorPai, matchImagem, normalizarCodigo } from '../_shared/parser.ts';
import type { PlanilhaRow } from '../_shared/types.ts';
import { enfileirarFamilia } from '../_shared/queue.ts';
import * as XLSX from 'npm:xlsx@^0.20';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  let user;
  try {
    user = await requireUser(req);
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const { lote_id } = await req.json().catch(() => ({}));
  if (!lote_id || typeof lote_id !== 'string') {
    return new Response('lote_id obrigatório', { status: 400, headers: corsHeaders });
  }

  const admin = adminClient();

  // 1. Idempotência: ler lote, verificar status
  const { data: lote, error: loteErr } = await admin
    .from('lotes')
    .select('*')
    .eq('id', lote_id)
    .eq('user_id', user.id)
    .single();
  if (loteErr || !lote) {
    return new Response(`Lote ${lote_id} não encontrado`, { status: 404, headers: corsHeaders });
  }
  if (lote.status !== 'importando') {
    return new Response(
      JSON.stringify({ loteId: lote.id, totalFamilias: lote.total_familias, jaProcessado: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  if (!lote.planilha_path) {
    return new Response('Lote sem planilha_path', { status: 400, headers: corsHeaders });
  }

  try {
    // 2. Baixar planilha do Storage
    const { data: blob, error: dlErr } = await admin.storage
      .from('imagens')
      .download(lote.planilha_path);
    if (dlErr || !blob) throw new Error(`Falha baixando planilha: ${dlErr?.message ?? 'sem blob'}`);

    const buffer = new Uint8Array(await blob.arrayBuffer());
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rowsRaw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    if (rowsRaw.length === 0) throw new Error('Planilha vazia');

    validarColunas(Object.keys(rowsRaw[0]));

    const rows: PlanilhaRow[] = rowsRaw.map((r) => ({
      CODIGO: String(r.CODIGO ?? ''),
      PAI: String(r.PAI ?? '0'),
      NOME: String(r.NOME ?? ''),
      UNIDADE: String(r.UNIDADE ?? ''),
      GTIN: r.GTIN ? String(r.GTIN) : null,
      PRECO: Number(r.PRECO ?? 0),
      ESTOQUE: Number(r.ESTOQUE ?? 0),
      DESCRICAO_DETALHADO: String(r.DESCRICAO_DETALHADO ?? ''),
      PESO_GRAMAS: Number(r.PESO_GRAMAS ?? 0),
      ALTURA_CM: Number(r.ALTURA_CM ?? 0),
      LARGURA_CM: Number(r.LARGURA_CM ?? 0),
      COMPRIMENTO_CM: Number(r.COMPRIMENTO_CM ?? 0),
    }));

    // 3. Agrupar por PAI
    const grupos = agruparPorPai(rows);

    // 4. Detectar CREATE vs UPDATE (ADR-0005)
    const codigosPai = grupos.map((g) => g.codigo_pai);
    const { data: existentes } = await admin
      .from('familias')
      .select('codigo_pai, ml_item_id')
      .eq('user_id', user.id)
      .in('codigo_pai', codigosPai)
      .not('ml_item_id', 'is', null);
    const publicadosSet = new Set((existentes ?? []).map((e) => e.codigo_pai));

    // 5. Persistir famílias + variações
    const familiasInsert = grupos.map((g) => ({
      lote_id: lote.id,
      user_id: user.id,
      codigo_pai: g.codigo_pai,
      nome_pai: g.nome_pai,
      descricao_pai: g.descricao_pai,
      unidade: g.unidade,
      operacao: publicadosSet.has(g.codigo_pai) ? 'UPDATE' : 'CREATE',
      status: 'pendente',
    }));
    const { data: familiasCriadas, error: famErr } = await admin
      .from('familias')
      .insert(familiasInsert)
      .select('id, codigo_pai');
    if (famErr || !familiasCriadas) throw new Error(`Insert famílias: ${famErr?.message}`);

    const familiaPorCodigo = new Map(familiasCriadas.map((f) => [f.codigo_pai, f.id]));

    const variacoesInsert = grupos.flatMap((g) =>
      g.variacoes.map((v) => ({
        familia_id: familiaPorCodigo.get(g.codigo_pai)!,
        user_id: user.id,
        codigo: normalizarCodigo(v.CODIGO),
        nome: v.NOME,
        gtin: v.GTIN,
        estoque: v.ESTOQUE,
        preco: v.PRECO,
        peso_gramas: v.PESO_GRAMAS,
        altura_cm: v.ALTURA_CM,
        largura_cm: v.LARGURA_CM,
        comprimento_cm: v.COMPRIMENTO_CM,
        imagem_path: matchImagem(v.CODIGO, lote.imagens_paths) ?? null,
      }))
    );
    const { error: varErr } = await admin.from('variacoes').insert(variacoesInsert);
    if (varErr) throw new Error(`Insert variações: ${varErr.message}`);

    // 6. Enfileirar 1 job por família
    for (const f of familiasCriadas) {
      const messageId = await enfileirarFamilia({ familia_id: f.id, lote_id: lote.id });
      await admin.from('familias').update({ qstash_message_id: messageId }).eq('id', f.id);
    }

    // 7. Marcar lote como processando
    await admin
      .from('lotes')
      .update({ status: 'processando' })
      .eq('id', lote.id);

    return new Response(
      JSON.stringify({ loteId: lote.id, totalFamilias: grupos.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin
      .from('lotes')
      .update({ status: 'erro', erro_mensagem: msg })
      .eq('id', lote.id);
    return new Response(`Falha no ingest: ${msg}`, { status: 500, headers: corsHeaders });
  }
});
```

- [ ] **Step 12.2: Deploy via MCP**

Chamar `mcp__supabase-mcp-server__deploy_edge_function` com:
- `project_id`: `txvncrgkoynoxwopfkbp`
- `name`: `ingest-lote`
- `files`: incluir o `index.ts` + todos os arquivos referenciados em `_shared/`

(O MCP `deploy_edge_function` aceita um array de arquivos. Garantir que ele veja `_shared/cors.ts`, `_shared/supabase.ts`, `_shared/auth.ts`, `_shared/parser.ts`, `_shared/types.ts`, `_shared/queue.ts`.)

Esperado: `success: true` + URL `https://txvncrgkoynoxwopfkbp.supabase.co/functions/v1/ingest-lote`.

- [ ] **Step 12.3: Smoke test via curl**

Pegar um JWT de usuário pelo dashboard (ou via `supabase.auth.signInWithPassword` no console do browser, e copiar `access_token`). Criar manualmente um lote pelo SQL:

```sql
insert into public.lotes (user_id, status, planilha_path, imagens_paths)
values ('<user_id>', 'importando', '<user_id>/<lote_id>/lote.xlsx', array[]::text[])
returning id;
```

E:

```bash
curl -X POST https://txvncrgkoynoxwopfkbp.supabase.co/functions/v1/ingest-lote \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -H "apikey: <ANON_KEY>" \
  -d '{"lote_id":"<lote_id>"}'
```

Esperado: 500 com "Falha baixando planilha" (porque a planilha ainda não foi feita upload de verdade). Aceitável — a função está respondendo, validando auth e detectando o lote.

Limpar:
```sql
delete from public.lotes where id = '<lote_id>';
```

- [ ] **Step 12.4: Commit**

```bash
git add supabase/functions/ingest-lote/index.ts
git commit -m "$(cat <<'EOF'
feat(edge): ingest-lote function

- requireUser via JWT → 401 se inválido
- Idempotente: lote em status != 'importando' retorna early com OK
- Baixa planilha do Storage, parseia xlsx (SheetJS via npm:)
- Valida colunas obrigatórias
- Agrupa por PAI, detecta órfãos
- Query familias.ml_item_id pra CREATE vs UPDATE (ADR-0005)
- Insert família + variações em batch
- Match imagem por 00CODIGO.{jpe?g,png}
- Enfileira 1 job QStash por família (process-familia)
- Marca lote → 'processando'; em erro → 'erro' + mensagem

Refs: ADR-0005, ADR-0006, ADR-0007. Plano 03 Task 12.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Edge Function `process-familia` (stub idempotente do M2)

**Files:**
- Create: `supabase/functions/process-familia/index.ts`

> No M2 esta função é apenas um **stub** que valida assinatura QStash, faz o lock idempotente (status `pendente → processando → pronto`) e responde 200. A lógica real (IA, concorrência) entra no M3 — mas o pipeline ponta-a-ponta (ingest → enqueue → handler → status atualizado → realtime no frontend) precisa estar fechado já no M2 pra validar tudo.

- [ ] **Step 13.1: Criar `supabase/functions/process-familia/index.ts`**

```ts
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';

interface Job { familia_id: string; lote_id: string; }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const body = await req.text();
  const ok = await verificarAssinatura(req, body);
  if (!ok) return new Response('Invalid signature', { status: 401, headers: corsHeaders });

  let job: Job;
  try {
    job = JSON.parse(body);
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: corsHeaders });
  }
  if (!job.familia_id || !job.lote_id) {
    return new Response('familia_id e lote_id obrigatórios', { status: 400, headers: corsHeaders });
  }

  const admin = adminClient();

  // Idempotência (ADR-0006): UPDATE atômico pendente → processando
  const { data: claimed, error: claimErr } = await admin
    .from('familias')
    .update({ status: 'processando' })
    .eq('id', job.familia_id)
    .eq('status', 'pendente')
    .select('id')
    .maybeSingle();
  if (claimErr) {
    return new Response(`Erro no claim: ${claimErr.message}`, { status: 500, headers: corsHeaders });
  }
  if (!claimed) {
    // já foi processada ou está em outro estado; retorno 200 pra QStash não retentar
    return new Response('Already processed', { status: 200, headers: corsHeaders });
  }

  try {
    // === STUB DO M2 ===
    // Real logic (IA, concorrência) entra em M3/M4. Por ora, só marca 'pronto'.
    await admin
      .from('familias')
      .update({ status: 'pronto' })
      .eq('id', job.familia_id);
    // ==================

    return new Response('OK', { status: 200, headers: corsHeaders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin
      .from('familias')
      .update({ status: 'erro', erro_mensagem: msg })
      .eq('id', job.familia_id);
    return new Response(`Erro: ${msg}`, { status: 500, headers: corsHeaders });
  }
});
```

- [ ] **Step 13.2: Deploy via MCP**

`deploy_edge_function` com `name: process-familia`, mesmos arquivos `_shared/*`.

- [ ] **Step 13.3: Smoke test ponta-a-ponta**

1. Logar no app (`pnpm dev` + `/#/login`).
2. Em `/#/novo-lote`, subir uma planilha real (ou de teste, ver Task 16) + algumas imagens.
3. Após o redirect para `/#/progresso/<id>`, abrir o dashboard do QStash e ver as mensagens enfileiradas + entregues 200.
4. No SQL: `select status, count(*) from familias group by 1` — esperado todas em `pronto`.
5. No SQL: `select status, total_familias, total_publicadas from lotes order by criado_em desc limit 1` — esperado `processando` e o contador correto.

- [ ] **Step 13.4: Commit**

```bash
git add supabase/functions/process-familia/index.ts
git commit -m "$(cat <<'EOF'
feat(edge): process-familia stub with QStash signature + idempotency

- Valida upstash-signature contra o body bruto
- Lock atômico: pendente → processando (UPDATE com WHERE status='pendente')
- Stub do M2: marca como 'pronto' direto; IA real entra em M3
- Erros marcam família como 'erro' + erro_mensagem

Pipeline ingest → QStash → process-familia → realtime agora fecha
end-to-end (mesmo sem IA real).

Refs: ADR-0006. Plano 03 Task 13.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Refactor `useLotes` e `useFamilias` para TanStack Query real

**Files:**
- Modify: `src/hooks/useLotes.ts`, `src/hooks/useFamilias.ts`
- Create: `src/lib/queries.ts`
- Modify: `src/pages/Dashboard.tsx`, `src/pages/Revisao.tsx`
- Remove (no Step final): `src/lib/mocks/*`

> Mantém a **mesma assinatura** que as telas do M1 já usam — só troca a fonte (mocks → supabase). Telas não precisam de mudança maior.

- [ ] **Step 14.1: Criar `src/lib/queries.ts`**

```ts
import { supabase } from './supabase';
import type { Database } from './database.types';

export const QK = {
  lotes: (userId: string) => ['lotes', userId] as const,
  lote: (loteId: string) => ['lote', loteId] as const,
  familias: (loteId: string) => ['familias', loteId] as const,
};

export type LoteRow = Database['public']['Tables']['lotes']['Row'];
export type FamiliaRow = Database['public']['Tables']['familias']['Row'];
export type VariacaoRow = Database['public']['Tables']['variacoes']['Row'];

export async function fetchLotes(): Promise<LoteRow[]> {
  const { data, error } = await supabase
    .from('lotes')
    .select('*')
    .order('criado_em', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchLote(id: string): Promise<LoteRow | null> {
  const { data, error } = await supabase.from('lotes').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchFamilias(loteId: string): Promise<(FamiliaRow & { variacoes: VariacaoRow[] })[]> {
  const { data, error } = await supabase
    .from('familias')
    .select('*, variacoes(*)')
    .eq('lote_id', loteId)
    .order('codigo_pai');
  if (error) throw error;
  return (data ?? []) as (FamiliaRow & { variacoes: VariacaoRow[] })[];
}
```

- [ ] **Step 14.2: Modificar `src/hooks/useLotes.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { QK, fetchLotes, loteFromRow } from '@/lib/queries';
import type { Lote } from '@/lib/tipos-dominio';
import { useAuth } from './useAuth';

export function useLotes() {
  const { user } = useAuth();
  return useQuery<Lote[]>({
    queryKey: QK.lotes(user?.id ?? 'anon'),
    queryFn: async () => (await fetchLotes()).map(loteFromRow),
    enabled: !!user,
  });
}
```

- [ ] **Step 14.3: Modificar `src/hooks/useFamilias.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { QK, fetchFamilias, familiaFromRow } from '@/lib/queries';
import type { Familia } from '@/lib/tipos-dominio';

export function useFamilias(loteId: string | undefined) {
  return useQuery<Familia[]>({
    queryKey: QK.familias(loteId ?? ''),
    queryFn: async () => (await fetchFamilias(loteId!)).map(familiaFromRow),
    enabled: !!loteId,
  });
}
```

- [ ] **Step 14.4: Criar adapters DB → tipos do M1 (evita refactor invasivo)**

Os componentes do M1 (`familia-row`, `familia-expanded`, `lote-card`, `variacao-card`, `status-badge`) e o `Revisao.tsx` importam `Lote`/`Familia`/`Variacao` de `@/lib/mocks/types` em camelCase. Como o schema do DB usa snake_case, faça um adapter em `lib/queries.ts` para minimizar mudanças nas telas:

```ts
import type { Lote, Familia, Variacao, LoteStatus, OperacaoML } from './tipos-dominio';

export function loteFromRow(r: LoteRow): Lote {
  return {
    id: r.id,
    numero: r.numero,
    criadoEm: r.criado_em,
    status: r.status as LoteStatus,
    totalFamilias: r.total_familias,
    totalPublicadas: r.total_publicadas,
    totalErros: r.total_erros,
  };
}

export function variacaoFromRow(r: VariacaoRow): Variacao {
  return {
    codigo: r.codigo,
    cor: r.cor ?? '',
    corHex: r.cor_hex ?? '#cccccc',
    preco: Number(r.preco),
    estoque: r.estoque,
    // ... campos restantes conforme a interface Variacao do M1
  };
}

export function familiaFromRow(
  r: FamiliaRow & { variacoes: VariacaoRow[] }
): Familia {
  return {
    id: r.id,
    codigoPai: r.codigo_pai,
    titulo: r.titulo_ml ?? r.nome_pai,
    descricao: r.descricao_ml ?? r.descricao_pai ?? '',
    operacao: r.operacao as OperacaoML,
    // ... mapear estrategiaPreco, concorrencia, precoMin/Max, etc.
    variacoes: r.variacoes.map(variacaoFromRow),
  };
}
```

Mover a interface `Lote/Familia/Variacao` de `src/lib/mocks/types.ts` para um novo `src/lib/tipos-dominio.ts` antes de apagar os mocks (Step 14.6). Atualizar os 8 imports já mapeados:

- `src/components/familia-row.tsx`
- `src/components/familia-expanded.tsx`
- `src/components/lote-card.tsx`
- `src/components/variacao-card.tsx`
- `src/components/status-badge.tsx`
- `src/hooks/useLotes.ts` (já vai mudar nesta task)
- `src/hooks/useFamilias.ts` (já vai mudar nesta task)
- `src/pages/Revisao.tsx`

Trocar `from '@/lib/mocks/types'` por `from '@/lib/tipos-dominio'`.

- [ ] **Step 14.4b: Adaptar `src/pages/Dashboard.tsx`**

Trocar `const lotes = useLotes()` (array direto) por `const { data: lotes = [], isLoading } = useLotes()`. Adicionar loading skeleton e empty state ("Nenhum lote ainda — crie um"). Os componentes continuam recebendo `Lote` (adapter já cuidou da conversão).

- [ ] **Step 14.5: Adaptar `src/pages/Revisao.tsx`**

Idem: trocar `useFamilias(loteId)` array direto por `const { data: familias = [], isLoading } = useFamilias(loteId)`. Estado de loading + empty state. Variações vêm dentro de `familia.variacoes` (já no formato esperado pelos componentes do M1, se houver adapter).

**Importante:** mutations (aprovar, editar) **não entram nesta task** — viram disabled placeholders no M2. Mutations reais entram no M3.

- [ ] **Step 14.6: Remover mocks**

```bash
rm -rf src/lib/mocks
rm -rf tests/mocks
```

Atualizar quaisquer imports remanescentes. Esperado: `pnpm test` reclama de imports quebrados; corrigir os componentes pra usar tipos de `lib/queries.ts`.

- [ ] **Step 14.7: Validar**

```bash
pnpm test && pnpm build
```
Esperado: 60+ passed (alguns testes de mocks foram apagados, novos não foram criados pra TanStack — aceitável); build OK.

- [ ] **Step 14.8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor: lotes/familias hooks usam TanStack Query contra Supabase

- lib/queries.ts: queryKeys (QK) + fetchLotes/fetchLote/fetchFamilias
- useLotes/useFamilias: useQuery; enabled by user
- Dashboard e Revisão: data/isLoading/empty states
- mocks/* removidos (sem mais código morto)

Mutations de revisão (aprovar/editar) ficam desabilitadas neste commit;
implementação real entra no M3.

Plano 03 Task 14.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Realtime — `useLoteRealtime` + tela Progresso

**Files:**
- Create: `src/hooks/useLoteRealtime.ts`
- Modify: `src/pages/Progresso.tsx`

- [ ] **Step 15.1: Criar `src/hooks/useLoteRealtime.ts`**

```ts
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { QK } from '@/lib/queries';

export function useLoteRealtime(loteId: string | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!loteId) return;
    const channel = supabase
      .channel(`lote-${loteId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'familias', filter: `lote_id=eq.${loteId}` },
        () => {
          qc.invalidateQueries({ queryKey: QK.familias(loteId) });
          qc.invalidateQueries({ queryKey: QK.lote(loteId) });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lotes', filter: `id=eq.${loteId}` },
        () => qc.invalidateQueries({ queryKey: QK.lote(loteId) })
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loteId, qc]);
}
```

- [ ] **Step 15.2: Habilitar publication de Realtime nas tabelas**

Via MCP `execute_sql`:
```sql
alter publication supabase_realtime add table public.lotes;
alter publication supabase_realtime add table public.familias;
```

Validar:
```sql
select pubname, schemaname, tablename
  from pg_publication_tables
 where pubname = 'supabase_realtime';
```
Esperado: ver `lotes` e `familias` na lista.

- [ ] **Step 15.3: Modificar `src/pages/Progresso.tsx`**

Substituir os dados mockados por:

```tsx
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { QK, fetchLote } from '@/lib/queries';
import { useFamilias } from '@/hooks/useFamilias';
import { useLoteRealtime } from '@/hooks/useLoteRealtime';
import { Progress } from '@/components/ui/progress';
// ... outros imports do componente atual

export default function Progresso() {
  const { loteId } = useParams<{ loteId: string }>();
  const nav = useNavigate();
  useLoteRealtime(loteId);

  const { data: lote } = useQuery({
    queryKey: QK.lote(loteId ?? ''),
    queryFn: () => fetchLote(loteId!),
    enabled: !!loteId,
  });
  const { data: familias = [] } = useFamilias(loteId);

  useEffect(() => {
    if (lote?.status === 'revisao' || lote?.status === 'processando') {
      const prontas = familias.filter((f) => f.status === 'pronto').length;
      if (prontas > 0 && prontas === familias.length) {
        nav(`/revisao/${loteId}`);
      }
    }
  }, [lote, familias, loteId, nav]);

  if (!lote) return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;

  const total = lote.total_familias;
  const prontas = familias.filter((f) => f.status === 'pronto' || f.status === 'publicado').length;
  const erradas = familias.filter((f) => f.status === 'erro').length;
  const pct = total > 0 ? Math.round((prontas / total) * 100) : 0;

  return (
    <div className="p-6">
      <h1 className="mb-2 text-2xl font-semibold">Lote #{lote.numero}</h1>
      <div className="mb-4 text-sm text-muted-foreground">
        Status: <span className="font-medium">{lote.status}</span> · {prontas} de {total} prontas
        {erradas > 0 && <> · {erradas} com erro</>}
      </div>
      <Progress value={pct} className="h-2" />
      <ul className="mt-6 space-y-1 text-sm">
        {familias.map((f) => (
          <li key={f.id} className="flex justify-between border-b py-1">
            <span>{f.codigo_pai} — {f.nome_pai}</span>
            <span className="text-xs text-muted-foreground">{f.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 15.4: Validar manualmente**

```bash
pnpm dev
```

1. Subir um lote real em `/#/novo-lote`.
2. Esperar redirect pra `/#/progresso/<id>`.
3. Observar a barra subir conforme as famílias mudam de `pendente → processando → pronto` (cada msg QStash → handler → UPDATE → Realtime → React Query refetch).
4. Quando todas chegarem em `pronto`, redireciona pra `/#/revisao/<id>`.
5. Conferir no SQL: `select status, count(*) from familias group by 1`.

Encerrar `pnpm dev`.

- [ ] **Step 15.5: Tests + build**

```bash
pnpm test && pnpm build
```
Esperado: 60+ passed; build OK.

- [ ] **Step 15.6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(realtime): useLoteRealtime + Progresso reflete progresso ao vivo

- Hook ouve postgres_changes em lotes (id=eq.loteId) e familias
  (lote_id=eq.loteId); invalida queries do TanStack
- Publication supabase_realtime habilitada em lotes e familias
- Progresso: barra real, lista de famílias com status individual,
  redirect automático para /revisao quando todas chegam em 'pronto'

Plano 03 Task 15.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Bug bash — planilha real do Diego + ajustes finos

**Files:**
- Modify: `docs/TASKS.md`, `docs/ROADMAP.md` (no Step final)

> Esta task **descobre** problemas; cada problema vira um patch + commit próprio. O plano não pode listar fixes antes de ver os erros — então o que está aqui são checkpoints e o protocolo.

- [ ] **Step 16.1: Push do que está antes do bug bash**

```bash
git push
```

Aguardar deploy do Render (~40s). Validar `https://publiai-frontend.onrender.com/` carrega.

- [ ] **Step 16.2: Importar planilha real**

Diego escolhe uma planilha **representativa** (lote pequeno: 5-15 famílias, 30-80 variações) do sistema interno e a pasta de imagens correspondente. Subir via `https://publiai-frontend.onrender.com/#/novo-lote`.

- [ ] **Step 16.3: Checklist de observação**

Marcar OK ou anotar incidente:

- [ ] Login funcionou na primeira tentativa
- [ ] Upload de planilha não travou; barra refletiu progresso
- [ ] Upload de imagens (todas) chegou a 100%
- [ ] Redirect para `/progresso/<id>` foi automático
- [ ] QStash dashboard mostra N mensagens entregues 200 (N = número de famílias)
- [ ] Famílias terminaram em `pronto` no Postgres
- [ ] Redirect para `/revisao/<id>` foi automático
- [ ] Tela de revisão mostra famílias reais + variações + imagens (signed URL via `lib/storage.signedUrl`)
- [ ] Imagem da capa = PAI quando existir, senão primeira variação
- [ ] Operação CREATE/UPDATE detectada corretamente (testar re-importação: 2ª importação da mesma planilha deve marcar tudo como UPDATE)
- [ ] Nenhuma família "órfã" silenciosa (todas correspondem a uma linha real)
- [ ] Nenhuma imagem órfã silenciosa (toda imagem subida cobre uma variação ou está visivelmente marcada como sem-match no log do lote)
- [ ] Custo: olhar dashboard Upstash e Supabase para garantir que ficou nos limites do free tier

- [ ] **Step 16.4: Para CADA incidente**

1. Abrir issue mental ou anotar em `docs/TASKS.md` na seção "Notas livres" com timestamp + sintoma + reprodução
2. Tentar fix isolado (1 commit por fix)
3. Atualizar testes — se foi bug de parser ou de hook, escrever teste de regressão antes do fix
4. Push e re-testar

- [ ] **Step 16.5: Atualizar `docs/TASKS.md`**

Trocar todos os `- [ ]` da seção `## 🏁 M2 — Backend core` para `- [x]`. Atualizar header da seção "Última atualização" e "Próximo passo recomendado" pra apontar para Plano 04 (M3 IA copywriting). Adicionar uma nota com a lista de incidentes corrigidos no bug bash (se houver).

- [ ] **Step 16.6: Atualizar `docs/ROADMAP.md`**

- "Estado geral" → `🟢 M2 concluído (data); aguardando início do M3`
- Card do M2 → status `✅ Concluído (YYYY-MM-DD, em X sessões)`
- Adicionar seção "Desvios documentados ao concluir" com qualquer mudança vs spec original
- Adicionar entrada no histórico

- [ ] **Step 16.7: Commit final**

```bash
git add docs/TASKS.md docs/ROADMAP.md
git commit -m "$(cat <<'EOF'
docs: marca M2 como concluído após bug bash com planilha real

Plano 03 fechado: schema (3 migrations), auth, upload, ingest (parse +
agrupamento + match + persist + enqueue), Realtime, process-familia
stub. Pipeline ponta-a-ponta validado com planilha real do Diego em
<DATA>.

Pronto para iniciar Plano 04 (M3 IA copywriting + Vision).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

## Critérios de saída do M2

- [ ] `pnpm test` passa todos os testes (≥ 60 testes)
- [ ] `pnpm build` completa sem erros
- [ ] Schema do banco implementado: 4 tabelas (`lotes`, `familias`, `variacoes`, `ml_credentials`), 6 enums, RLS habilitado e testado, Vault armazena tokens criptografados
- [ ] Auth funciona ponta-a-ponta (cadastro → confirmação e-mail → login → ProtectedRoute → logout)
- [ ] Upload de planilha + imagens vai direto pro Storage com paths `{user_id}/{lote_id}/...` e RLS por user_id
- [ ] Edge Function `ingest-lote` parseia .xlsx, agrupa por PAI, faz match de imagens, detecta CREATE/UPDATE, persiste, enfileira
- [ ] Edge Function `process-familia` é idempotente (re-entrega QStash não duplica trabalho)
- [ ] Tela de Progresso atualiza ao vivo via Realtime conforme famílias mudam de status
- [ ] Tela de Revisão lista famílias reais (com variações + imagens via signed URL) — mutations ficam disabled (M3)
- [ ] Lote real do Diego é importado sem erros (ou com incidentes documentados e corrigidos)
- [ ] TASKS.md e ROADMAP.md atualizados

---

## Notas para quem executa este plano

**Comandos prontos pra copiar:**

```bash
# Status do projeto Supabase
# (via MCP supabase-mcp-server: list_projects, get_project)

# Aplicar uma migration nova (após editar o .sql)
# MCP apply_migration(project_id="txvncrgkoynoxwopfkbp", name="<descritivo>", query="<sql>")

# Deploy de uma edge function
# MCP deploy_edge_function(project_id="txvncrgkoynoxwopfkbp", name="<fn>", files=[...])

# Olhar logs em produção
# MCP get_logs(project_id="...", service="edge-function") — quando algo der errado

# Listar secrets (sem valores)
supabase secrets list --project-ref txvncrgkoynoxwopfkbp
```

**Erros comuns esperados:**

- **`supabase_vault` não descriptografa:** confirmar que `supabase_vault` está `installed_version: 0.3.1` (ou superior) via `list_extensions`. Nada de pgsodium — o Supabase removeu a extensão de projetos managed em 2024 e o Vault virou standalone.
- **Edge Function `npm:xlsx` lenta no cold start:** primeira execução pode passar 5-10s (compila o módulo); subsequente fica < 1s. Aceitável.
- **JWT do frontend não chega na Edge Function:** confirmar que o `Authorization: Bearer <token>` está nos headers do `fetch` e que `apikey: <ANON_KEY>` também está (Supabase exige ambos).
- **Realtime não dispara:** verificar `pg_publication_tables` (Task 15 Step 2). Se a tabela não está na publication, `INSERT`/`UPDATE` não viram eventos.
- **QStash entrega 401 "Invalid signature":** confirmar que o body é lido como `text()` antes do `verify` (não `json()` — destruir o stream invalida a assinatura).
- **Upload pra Storage falha 403:** o path tem que começar com `auth.uid()` — confirmar que `buildStoragePath` usa `user.id` do `auth.getUser()`, não um ID hardcoded.

**O que NÃO está neste plano (entra no M3):**

- Geração real de copy via OpenRouter (`process-familia` substitui o stub)
- Vision pra cor das variações
- Cache Redis (cor TTL 30d)
- Edição inline na tela de revisão (mutations)
- Detecção determinística de `tipo_aviamento` (regex + IA classificadora) — ADR-0009

**O que NÃO está neste plano (entra no M4):**

- OAuth Mercado Livre + tokens via Vault (estrutura está pronta — só plugar)
- Busca de concorrência + estratégia de preço
- Publicação real CREATE/UPDATE

**Estimativa:** 8-12 dias úteis concentrados (16 tasks, com algumas envolvendo deploy e validação manual). Tasks 2-4 (migrations) e 11-13 (edge functions) são as mais críticas — fazer com cuidado. Tasks 6-9 (auth + upload) e 14-15 (refactor + realtime) são mecânicas — rápidas com TDD.
