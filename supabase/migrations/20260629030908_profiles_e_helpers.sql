-- ============================================================================
-- Migration: profiles_e_helpers
-- Refs: ADR-0047 (operação compartilhada + RBAC de menu).
-- ============================================================================

-- Espelho de usuário da operação.
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  nome          text not null default '',
  is_admin      boolean not null default false,
  is_active     boolean not null default true,
  allowed_menus text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Helper: o chamador é admin? (security definer p/ não recursar nas policies de profiles)
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = '' as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;
revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Helper: o chamador é membro autenticado da operação?
-- ÚNICO ponto de troca para o E7: aqui vira is_member_of(org_id).
create or replace function public.is_membro_operacao()
returns boolean language sql security definer stable set search_path = '' as $$
  select (select auth.role()) = 'authenticated';
$$;
revoke execute on function public.is_membro_operacao() from public;
grant execute on function public.is_membro_operacao() to authenticated;

-- Policies de profiles.
create policy "profiles: select self or admin" on public.profiles
  for select using (id = (select auth.uid()) or public.is_admin());
create policy "profiles: admin insert" on public.profiles
  for insert with check (public.is_admin());
create policy "profiles: admin update" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());
create policy "profiles: admin delete" on public.profiles
  for delete using (public.is_admin());

-- Trigger: cria o perfil no signup, semeando nome/menus do convite (raw_user_meta_data).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, nome, allowed_menus)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    coalesce(
      array(select jsonb_array_elements_text(new.raw_user_meta_data->'allowed_menus')),
      '{}'::text[]
    )
  )
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: usuários já existentes (só o Diego hoje) viram admin com todos os menus.
insert into public.profiles (id, email, nome, is_admin, is_active, allowed_menus)
select u.id, u.email, '', true, true,
  array['dashboard','lotes','revisao','publicados','faturamento','financeiro','viabilidade','configuracoes']
from auth.users u
on conflict (id) do nothing;
