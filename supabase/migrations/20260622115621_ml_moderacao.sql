-- Estado de moderação dos anúncios no ML, para diff e dedup do alerta (ADR-0035).
-- 1 linha "aberta" (resolvido_em null) por (user_id, ml_item_id) em estado moderado.
create table public.ml_moderacao (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  ml_item_id    text not null,
  status        text not null,
  motivo        text,
  detectado_em  timestamptz not null default now(),
  alertado_em   timestamptz,
  resolvido_em  timestamptz,
  atualizado_em timestamptz not null default now()
);

-- No máximo 1 registro aberto por item/usuário (evita alerta duplicado).
create unique index ml_moderacao_aberto_uniq
  on public.ml_moderacao (user_id, ml_item_id)
  where resolvido_em is null;

create index ml_moderacao_user_idx on public.ml_moderacao (user_id);

alter table public.ml_moderacao enable row level security;

-- Operador vê os próprios registros; escrita é só do worker (service role, ignora RLS).
create policy "ml_moderacao: select own" on public.ml_moderacao
  for select using ((select auth.uid()) = user_id);
