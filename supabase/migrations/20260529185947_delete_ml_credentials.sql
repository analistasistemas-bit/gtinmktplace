-- ============================================================================
-- Migration — delete_ml_credentials (suporte ao disconnect do OAuth ML)
-- Ref: spec docs/superpowers/specs/2026-05-29-m4-oauth-ml-design.md (M4 bloco OAuth)
-- Apaga os dois segredos do Vault referenciados + a linha de ml_credentials.
-- ============================================================================

create or replace function public.delete_ml_credentials(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_creds public.ml_credentials%rowtype;
begin
  select * into v_creds from public.ml_credentials where user_id = p_user_id;
  if v_creds.user_id is null then
    return; -- idempotente: nada a apagar
  end if;

  delete from vault.secrets where id = v_creds.access_token_secret_id;
  delete from vault.secrets where id = v_creds.refresh_token_secret_id;
  delete from public.ml_credentials where user_id = p_user_id;
end;
$$;

revoke execute on function public.delete_ml_credentials(uuid) from public, anon, authenticated;
