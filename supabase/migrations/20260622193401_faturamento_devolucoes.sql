-- Módulo Faturamento — Fase 3: devoluções/reclamações (claims, ADR-0037, post-purchase).
create table public.ml_devolucoes (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  claim_id            bigint not null,
  order_id            bigint,
  stage               text,
  status              text,
  type                text,
  reason_id           text,
  reason_texto        text,
  valor_em_jogo       numeric,
  return_status       text,
  return_status_money text,
  acoes_pendentes     jsonb,
  aberto_em           timestamptz,
  raw                 jsonb,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

create unique index ml_devolucoes_uniq on public.ml_devolucoes (user_id, claim_id);
create index ml_devolucoes_user_idx on public.ml_devolucoes (user_id, aberto_em desc);

alter table public.ml_devolucoes enable row level security;

create policy "ml_devolucoes: select own" on public.ml_devolucoes
  for select using ((select auth.uid()) = user_id);
