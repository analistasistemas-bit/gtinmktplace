-- ============================================================================
-- Migration: e7_marketplace_connections
-- Refs: ADR-0027 (D-E7.4). Fase 5 do E7 — credenciais por organização.
-- Substitui ml_credentials (por user_id) por marketplace_connections (por org+canal),
-- migrando os MESMOS secret_ids do Vault (zero re-criptografia). RPCs espelham
-- get_ml_tokens/upsert_ml_credentials/delete_ml_credentials trocando user_id → connection.
-- ml_credentials fica congelada como fonte até o cutover de código (Task 11); drop na Task 17.
-- ============================================================================

create table public.marketplace_connections (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organizations(id),
  canal                   public.canal_externo not null,
  conta_externa_id        text,          -- ml_user_id do vendedor no canal (não é segredo)
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

create trigger marketplace_connections_set_updated_at
  before update on public.marketplace_connections
  for each row execute procedure extensions.moddatetime (atualizado_em);

-- Leitura: membro da org vê a conexão da própria org. Escrita: só RPCs service_role.
create policy "marketplace_connections: select org" on public.marketplace_connections
  for select to authenticated using (org_id = (select public.current_org_id()));

-- Migra a conexão da Avil reusando os MESMOS secret_ids (nada é re-criptografado).
insert into public.marketplace_connections
  (org_id, canal, conta_externa_id, conta_label, scope, expires_at,
   access_token_secret_id, refresh_token_secret_id, criado_por)
select c.org_id, 'mercado_livre', c.ml_user_id, c.ml_nickname, c.scope, c.expires_at,
       c.access_token_secret_id, c.refresh_token_secret_id, c.user_id
from public.ml_credentials c;

-- ----------------------------------------------------------------------------
-- RPCs Vault (SECURITY DEFINER, service_role-only) — espelham as de ml_credentials.
-- ----------------------------------------------------------------------------

create or replace function public.upsert_marketplace_connection(
  p_org_id          uuid,
  p_canal           public.canal_externo,
  p_conta_externa_id text,
  p_conta_label     text,
  p_access_token    text,
  p_refresh_token   text,
  p_scope           text,
  p_expires_at      timestamptz,
  p_criado_por      uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_existing public.marketplace_connections%rowtype;
  v_access_id  uuid;
  v_refresh_id uuid;
begin
  select * into v_existing from public.marketplace_connections
   where org_id = p_org_id and canal = p_canal;

  if v_existing.id is null then
    select vault.create_secret(p_access_token,  'mkt_' || p_canal || '_access_'  || p_org_id::text) into v_access_id;
    select vault.create_secret(p_refresh_token, 'mkt_' || p_canal || '_refresh_' || p_org_id::text) into v_refresh_id;
    insert into public.marketplace_connections (
      org_id, canal, conta_externa_id, conta_label, scope, expires_at,
      access_token_secret_id, refresh_token_secret_id, criado_por
    ) values (
      p_org_id, p_canal, p_conta_externa_id, p_conta_label, p_scope, p_expires_at,
      v_access_id, v_refresh_id, p_criado_por
    ) returning id into v_existing.id;
  else
    perform vault.update_secret(v_existing.access_token_secret_id,  p_access_token);
    perform vault.update_secret(v_existing.refresh_token_secret_id, p_refresh_token);
    update public.marketplace_connections
       set conta_externa_id = p_conta_externa_id,
           conta_label      = p_conta_label,
           scope            = p_scope,
           expires_at       = p_expires_at
     where id = v_existing.id;
  end if;
  return v_existing.id;
end;
$$;

create or replace function public.get_connection_tokens(p_connection_id uuid)
returns table (access_token text, refresh_token text, expires_at timestamptz, conta_externa_id text)
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_cx public.marketplace_connections%rowtype;
begin
  select * into v_cx from public.marketplace_connections where id = p_connection_id;
  if v_cx.id is null then
    raise exception 'marketplace_connection not found: %', p_connection_id;
  end if;
  return query
    select
      (select decrypted_secret from vault.decrypted_secrets where id = v_cx.access_token_secret_id),
      (select decrypted_secret from vault.decrypted_secrets where id = v_cx.refresh_token_secret_id),
      v_cx.expires_at,
      v_cx.conta_externa_id;
end;
$$;

create or replace function public.delete_marketplace_connection(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_cx public.marketplace_connections%rowtype;
begin
  select * into v_cx from public.marketplace_connections where id = p_connection_id;
  if v_cx.id is null then
    return; -- idempotente
  end if;
  delete from vault.secrets where id = v_cx.access_token_secret_id;
  delete from vault.secrets where id = v_cx.refresh_token_secret_id;
  delete from public.marketplace_connections where id = p_connection_id;
end;
$$;

revoke execute on function public.upsert_marketplace_connection(uuid, public.canal_externo, text, text, text, text, text, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public.get_connection_tokens(uuid) from public, anon, authenticated;
revoke execute on function public.delete_marketplace_connection(uuid) from public, anon, authenticated;
