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

-- Helpers só podem ser chamados pelo service_role (Edge Functions com SERVICE_ROLE_KEY).
-- Bloqueamos public, anon e authenticated pra evitar exposição via /rest/v1/rpc/.
revoke execute on function public.upsert_ml_credentials(uuid, text, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.get_ml_tokens(uuid) from public, anon, authenticated;
