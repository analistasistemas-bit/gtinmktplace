-- ADR-0175: arquivar organização (soft delete). Arquivar desconecta os canais e marca
-- arquivada_em numa única transação; sem conexão, as rotinas que partem de
-- marketplace_connections e o webhook do ML deixam de enxergar a org.

alter table public.organizations add column if not exists arquivada_em timestamptz;

create or replace function public.arquivar_organizacao(p_org_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_org public.organizations%rowtype;
  v_cx_id uuid;
  v_agora timestamptz := now();
begin
  -- Lock da org primeiro: serializa com upsert_marketplace_connection (FOR SHARE abaixo).
  select * into v_org from public.organizations where id = p_org_id for update;
  if v_org.id is null then
    raise exception 'Organização não encontrada.' using errcode = 'P0002';
  end if;
  if v_org.arquivada_em is not null then
    return v_org.arquivada_em; -- idempotente
  end if;
  if exists (select 1 from public.profiles where org_id = p_org_id and is_active) then
    raise exception 'A organização ainda possui membros ativos.' using errcode = '55000';
  end if;
  -- Reusa a RPC do "Desconectar" (ordem Vault → conexão): travar a conexão aqui e o Vault depois
  -- formaria ciclo de deadlock com uma desconexão concorrente. A RPC é idempotente.
  for v_cx_id in select id from public.marketplace_connections where org_id = p_org_id loop
    perform public.delete_marketplace_connection(v_cx_id);
  end loop;
  update public.organizations set arquivada_em = v_agora where id = p_org_id;
  return v_agora;
end;
$$;

create or replace function public.desarquivar_organizacao(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Só limpa a marca: a conexão NÃO volta — reconectar o ML em Canais (OAuth) é obrigatório.
  update public.organizations set arquivada_em = null where id = p_org_id;
  if not found then
    raise exception 'Organização não encontrada.' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.arquivar_organizacao(uuid) from public, anon, authenticated;
revoke execute on function public.desarquivar_organizacao(uuid) from public, anon, authenticated;
grant execute on function public.arquivar_organizacao(uuid) to service_role;
grant execute on function public.desarquivar_organizacao(uuid) to service_role;

-- Um refresh de token ou callback OAuth que termine DEPOIS do arquivamento recriaria a conexão.
-- O upsert passa a travar a org (FOR SHARE) e recusar arquivada — mesma ordem de lock do
-- arquivamento (org → conexão/Vault), então os dois serializam. Corpo idêntico ao de
-- 20260730185835_marketplace_connections_mercadoenvios.sql, salvo a trava no início.
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
  perform 1 from public.organizations where id = p_org_id and arquivada_em is null for share;
  if not found then
    raise exception 'Organização arquivada ou inexistente: reconexão bloqueada.' using errcode = '55000';
  end if;

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
