-- ADR-0210 — Acesso de agentes (fatia 1): conexões por chave e auditoria das chamadas.
--
-- Sem policy de propósito: só as edges (service_role, que ignora RLS) leem e gravam estas tabelas.
-- RLS ligada + revoke de anon/authenticated = nenhum acesso pelo PostgREST com JWT de usuário.
-- `db push` não roda em transação: cada bloco é re-executável (if not exists).

-- 1. Conexões (a chave é guardada só como hash; o prefixo identifica a chave na tela) -----------------------------
create table if not exists public.agente_conexoes (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  nome           text not null check (char_length(nome) between 1 and 60),
  prefixo        text not null,
  hash           text not null unique,
  criada_por     uuid not null references auth.users(id),
  criada_em      timestamptz not null default now(),
  expira_em      timestamptz not null,
  revogada_em    timestamptz,
  ultimo_uso_em  timestamptz,
  constraint agente_conexoes_expira_check
    check (expira_em > criada_em and expira_em <= criada_em + interval '366 days')
);
create index if not exists agente_conexoes_org_criada on public.agente_conexoes (org_id, criada_em desc);

-- 2. Auditoria: uma linha por chamada de ferramenta -----------------------------------------------------------------
create table if not exists public.agente_chamadas (
  id          bigint generated always as identity primary key,
  org_id      uuid not null,
  conexao_id  uuid not null references public.agente_conexoes(id) on delete cascade,
  ferramenta  text not null,
  alvo        text,
  resultado   text not null,
  criado_em   timestamptz not null default now()
);
create index if not exists agente_chamadas_org_criado on public.agente_chamadas (org_id, criado_em desc);

-- 3. RLS sem policy; default privileges do Supabase dão ALL (inclui TRUNCATE, que RLS não cobre) -------------------
alter table public.agente_conexoes enable row level security;
alter table public.agente_chamadas enable row level security;
revoke all on public.agente_conexoes from anon, authenticated;
revoke all on public.agente_chamadas from anon, authenticated;
