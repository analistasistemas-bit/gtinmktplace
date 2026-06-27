create table if not exists public.configuracoes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  desconto_pct numeric(5,2) not null default 15,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.configuracoes enable row level security;

create policy "configuracoes_select_own" on public.configuracoes
  for select using (auth.uid() = user_id);
create policy "configuracoes_insert_own" on public.configuracoes
  for insert with check (auth.uid() = user_id);
create policy "configuracoes_update_own" on public.configuracoes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.familias
  add column if not exists exibir_com_desconto boolean not null default false,
  add column if not exists desconto_pct numeric(5,2);;
