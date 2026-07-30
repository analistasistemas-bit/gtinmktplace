-- ============================================================================
-- Migration: marketplace_connections_mercadoenvios
-- Guarda se a conta ML conectada tem Mercado Envios (me2) habilitado.
-- Sem me2, buscarFreteVendedor (_shared/ml/frete.ts) falha silenciosamente e o
-- frete sai como 0 na Viabilidade — achado ao vivo na conta DSA/9757132 (conta
-- NEWBIE sem vendas). `GET /users/{id}` (`status.mercadoenvios`) fica DESATUALIZADO
-- por um tempo após a adesão (confirmado ao vivo: dizia "not_accepted" com o frete
-- já funcionando) — a fonte confiável em tempo real é
-- `GET /users/{id}/shipping_preferences` → `"me2" em modes`. Guardar esse booleano
-- permite avisar o operador na tela de Canais em vez de deixar a divergência muda.
-- ============================================================================

alter table public.marketplace_connections
  add column me2_habilitado boolean;

drop function if exists public.upsert_marketplace_connection(
  uuid, public.canal_externo, text, text, text, text, text, timestamptz, uuid
);

create or replace function public.upsert_marketplace_connection(
  p_org_id               uuid,
  p_canal                public.canal_externo,
  p_conta_externa_id     text,
  p_conta_label          text,
  p_access_token         text,
  p_refresh_token        text,
  p_scope                text,
  p_expires_at           timestamptz,
  p_criado_por           uuid,
  p_me2_habilitado       boolean default null
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
      access_token_secret_id, refresh_token_secret_id, criado_por, me2_habilitado
    ) values (
      p_org_id, p_canal, p_conta_externa_id, p_conta_label, p_scope, p_expires_at,
      v_access_id, v_refresh_id, p_criado_por, p_me2_habilitado
    ) returning id into v_existing.id;
  else
    perform vault.update_secret(v_existing.access_token_secret_id,  p_access_token);
    perform vault.update_secret(v_existing.refresh_token_secret_id, p_refresh_token);
    update public.marketplace_connections
       set conta_externa_id = p_conta_externa_id,
           conta_label      = p_conta_label,
           scope            = p_scope,
           expires_at       = p_expires_at,
           me2_habilitado   = p_me2_habilitado
     where id = v_existing.id;
  end if;
  return v_existing.id;
end;
$$;

revoke execute on function public.upsert_marketplace_connection(
  uuid, public.canal_externo, text, text, text, text, text, timestamptz, uuid, boolean
) from public, anon, authenticated;
