-- Módulo Faturamento — Fase 2: perguntas de compradores (ADR-0037).
create table public.ml_perguntas (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  question_id   bigint not null,
  item_id       text,
  item_titulo   text,
  texto         text not null default '',
  status        text not null,
  resposta      text,
  respondida_em timestamptz,
  comprador_id  bigint,
  criada_em     timestamptz,
  raw           jsonb,
  atualizado_em timestamptz not null default now()
);

create unique index ml_perguntas_uniq on public.ml_perguntas (user_id, question_id);
create index ml_perguntas_user_status_idx on public.ml_perguntas (user_id, status, criada_em desc);

alter table public.ml_perguntas enable row level security;

-- Leitura própria; escrita só do worker (service role).
create policy "ml_perguntas: select own" on public.ml_perguntas
  for select using ((select auth.uid()) = user_id);
