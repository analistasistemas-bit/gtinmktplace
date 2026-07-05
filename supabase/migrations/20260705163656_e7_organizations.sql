-- ============================================================================
-- Migration: e7_organizations
-- Refs: ADR-0027 (multi-tenancy). Fase 1 do E7 — aditivo: nenhuma policy
-- existente muda aqui; comportamento do app permanece idêntico (RLS antiga
-- por is_membro_operacao() continua valendo).
-- ============================================================================

-- Organizações (tenants). Todos os dados atuais são de uma única org (Avil).
create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  slug          text not null unique,
  marca_padrao  text,                       -- resolve a dívida 'Avil' hard-coded (atributos.ts)
  lote_seq      integer not null default 0, -- numeração de lote por org (Fase 6)
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

-- handle_new_user passa a semear org_id do metadata do convite. Corpo replicado
-- EXATAMENTE de 20260629030908_profiles_e_helpers.sql (array(select ...), on
-- conflict do nothing), adicionando apenas a coluna/valor org_id.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, nome, allowed_menus, org_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    coalesce(
      array(select jsonb_array_elements_text(new.raw_user_meta_data->'allowed_menus')),
      '{}'::text[]
    ),
    (new.raw_user_meta_data->>'org_id')::uuid
  )
  on conflict (id) do nothing;
  return new;
end; $$;
