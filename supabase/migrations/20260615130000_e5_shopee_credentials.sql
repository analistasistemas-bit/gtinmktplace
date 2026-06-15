-- ============================================================================
-- E5 — shopee_credentials + Supabase Vault para tokens OAuth da loja Shopee
-- Refs: ADR-0024 (abstração de canais), ADR-0025 (anuncios_externos multicanal),
--       ADR-0012 (refresh OAuth com lock), CLAUDE.md (tokens sempre via Vault).
-- Espelha 20260527000003_ml_credentials_vault.sql: tokens NUNCA em colunas planas;
-- são segredos no Vault, referenciados por uuid. RLS por user_id (só SELECT do dono;
-- escrita é via Edge Functions com service role). Migration ADITIVA — não toca dados
-- existentes; o caminho ML é inalterado.
-- ============================================================================

-- 1) Novo valor no enum de canais (aditivo; o ML continua funcionando).
--    Precisa rodar fora de bloco transacional de DDL que crie objetos que dependam
--    do valor no mesmo statement; aqui é standalone.
alter type public.canal_externo add value if not exists 'shopee';

-- 2) Tabela de credenciais da loja Shopee.
create table public.shopee_credentials (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  shop_id            text not null,              -- ID da loja na Shopee (não é segredo)
  scope              text,
  expires_at         timestamptz not null,
  access_token_secret_id  uuid not null,         -- referência ao segredo em vault.secrets
  refresh_token_secret_id uuid not null,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);

create trigger shopee_credentials_set_updated_at
  before update on public.shopee_credentials
  for each row execute procedure extensions.moddatetime (atualizado_em);

alter table public.shopee_credentials enable row level security;

-- Apenas SELECT pelo dono (escrita é feita pelas Edge Functions com service role).
create policy "shopee_credentials: select own"
  on public.shopee_credentials for select
  using ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- Helpers: criar/atualizar/ler tokens via Vault (chamados pelas Edge Functions
-- com service role). Assinaturas espelham upsert_ml_credentials/get_ml_tokens,
-- mas get_shopee_tokens TAMBÉM retorna shop_id (canal shop-scoped: o refresh e a
-- assinatura HMAC precisam do shop_id — ver _shared/shopee/token.ts).
-- ----------------------------------------------------------------------------

create or replace function public.upsert_shopee_credentials(
  p_user_id      uuid,
  p_shop_id      text,
  p_access_token text,
  p_refresh_token text,
  p_expires_at   timestamptz,
  p_scope        text default null
)
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_access_id  uuid;
  v_refresh_id uuid;
  v_existing   public.shopee_credentials%rowtype;
begin
  select * into v_existing from public.shopee_credentials where user_id = p_user_id;

  if v_existing.user_id is null then
    select vault.create_secret(p_access_token,  'shopee_access_'  || p_user_id::text) into v_access_id;
    select vault.create_secret(p_refresh_token, 'shopee_refresh_' || p_user_id::text) into v_refresh_id;

    insert into public.shopee_credentials (
      user_id, shop_id, scope, expires_at,
      access_token_secret_id, refresh_token_secret_id
    ) values (
      p_user_id, p_shop_id, p_scope, p_expires_at,
      v_access_id, v_refresh_id
    );
  else
    perform vault.update_secret(v_existing.access_token_secret_id,  p_access_token);
    perform vault.update_secret(v_existing.refresh_token_secret_id, p_refresh_token);

    update public.shopee_credentials
       set shop_id    = p_shop_id,
           expires_at = p_expires_at,
           -- p_scope null no refresh → preserva o scope existente.
           scope      = coalesce(p_scope, scope)
     where user_id = p_user_id;
  end if;
end;
$$;

create or replace function public.get_shopee_tokens(p_user_id uuid)
returns table (access_token text, refresh_token text, shop_id text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_creds public.shopee_credentials%rowtype;
begin
  select * into v_creds from public.shopee_credentials where user_id = p_user_id;
  if v_creds.user_id is null then
    raise exception 'shopee_credentials not found for user %', p_user_id;
  end if;

  return query
    select
      (select decrypted_secret from vault.decrypted_secrets where id = v_creds.access_token_secret_id),
      (select decrypted_secret from vault.decrypted_secrets where id = v_creds.refresh_token_secret_id),
      v_creds.shop_id,
      v_creds.expires_at;
end;
$$;

-- Helpers só podem ser chamados pelo service_role (Edge Functions com SERVICE_ROLE_KEY).
-- Bloqueamos public, anon e authenticated pra evitar exposição via /rest/v1/rpc/.
revoke execute on function public.upsert_shopee_credentials(uuid, text, text, text, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.get_shopee_tokens(uuid) from public, anon, authenticated;
