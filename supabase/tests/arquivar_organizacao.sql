-- ADR-0175: arquivar/desarquivar organização e a trava de reconexão no upsert.
-- Rodar contra o Postgres local:
--   docker exec -i supabase_db_<project-ref> psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/arquivar_organizacao.sql
\set ON_ERROR_STOP on
begin;

insert into public.organizations (id, nome, slug) values
  ('92000000-0000-0000-0000-000000000001', 'Arq Teste', 'arq-teste'),
  ('92000000-0000-0000-0000-000000000002', 'Arq Membro', 'arq-membro');

do $$
declare a uuid; r uuid;
begin
  a := vault.create_secret('tok-a1'); r := vault.create_secret('tok-r1');
  insert into public.marketplace_connections (org_id, canal, conta_externa_id, access_token_secret_id, refresh_token_secret_id, expires_at)
  values ('92000000-0000-0000-0000-000000000001', 'mercado_livre', '920001', a, r, now() + interval '6 hours');
  a := vault.create_secret('tok-a2'); r := vault.create_secret('tok-r2');
  insert into public.marketplace_connections (org_id, canal, conta_externa_id, access_token_secret_id, refresh_token_secret_id, expires_at)
  values ('92000000-0000-0000-0000-000000000002', 'mercado_livre', '920002', a, r, now() + interval '6 hours');
end $$;

-- Membro ativo na org 2 (o trigger handle_new_user cria o profile a partir do metadata).
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('92000000-0000-0000-0000-000000000102', 'membro-arq@teste.local',
   '{}'::jsonb, '{"org_id":"92000000-0000-0000-0000-000000000002"}'::jsonb);
do $$
begin
  if not exists (select 1 from public.profiles where id = '92000000-0000-0000-0000-000000000102'
                 and org_id = '92000000-0000-0000-0000-000000000002' and is_active)
    then raise exception 'fixture: profile ativo não criado'; end if;
end $$;

-- 1) Arquivar org sem membros: apaga conexão + segredos e grava a data.
set local role service_role;
do $$
declare d timestamptz;
begin
  d := public.arquivar_organizacao('92000000-0000-0000-0000-000000000001');
  if d is null then raise exception 'arquivada_em não retornada'; end if;
  if (select arquivada_em from public.organizations where id = '92000000-0000-0000-0000-000000000001') is distinct from d
    then raise exception 'arquivada_em persistida diverge do retorno'; end if;
  if exists (select 1 from public.marketplace_connections where org_id = '92000000-0000-0000-0000-000000000001')
    then raise exception 'conexão não apagada'; end if;
end $$;
reset role;
do $$
begin
  if (select count(*) from vault.decrypted_secrets where decrypted_secret in ('tok-a1', 'tok-r1')) <> 0
    then raise exception 'segredos não apagados'; end if;
  if (select count(*) from vault.decrypted_secrets where decrypted_secret in ('tok-a2', 'tok-r2')) <> 2
    then raise exception 'segredos de outra org foram apagados'; end if;
end $$;

-- 2) Idempotente: data antiga conhecida não é regravada.
update public.organizations set arquivada_em = '2020-01-01T00:00:00Z' where id = '92000000-0000-0000-0000-000000000001';
set local role service_role;
do $$
declare d2 timestamptz;
begin
  d2 := public.arquivar_organizacao('92000000-0000-0000-0000-000000000001');
  if d2 is distinct from '2020-01-01T00:00:00Z'::timestamptz then raise exception 'idempotência quebrada: %', d2; end if;
end $$;
reset role;

-- 2b) Org arquivada não ganha conexão (refresh/OAuth tardio).
do $$
begin
  perform public.upsert_marketplace_connection('92000000-0000-0000-0000-000000000001', 'mercado_livre',
    '920001', 'x', 'a', 'r', 'scope', now() + interval '6 hours', null);
  raise exception 'upsert recriou conexão em org arquivada';
exception when sqlstate '55000' then null;
end $$;

-- 2c) Upsert continua funcionando em org ativa (refresh normal da org 2).
do $$
begin
  perform public.upsert_marketplace_connection('92000000-0000-0000-0000-000000000002', 'mercado_livre',
    '920002', 'x', 'a2-novo', 'r2-novo', 'scope', now() + interval '6 hours', null);
  if (select count(*) from vault.decrypted_secrets where decrypted_secret in ('a2-novo', 'r2-novo')) <> 2
    then raise exception 'upsert em org ativa não atualizou os segredos'; end if;
end $$;

-- 3) Membro ativo → 55000 e nada apagado (atomicidade).
set local role service_role;
do $$
begin
  perform public.arquivar_organizacao('92000000-0000-0000-0000-000000000002');
  raise exception 'arquivou org com membro ativo';
exception when sqlstate '55000' then null;
end $$;
reset role;
do $$
begin
  if not exists (select 1 from public.marketplace_connections where org_id = '92000000-0000-0000-0000-000000000002')
    then raise exception 'conexão apagada apesar da recusa'; end if;
  if (select arquivada_em from public.organizations where id = '92000000-0000-0000-0000-000000000002') is not null
    then raise exception 'marcou arquivada apesar da recusa'; end if;
end $$;

-- 4) Inexistente → P0002 (arquivar e desarquivar).
set local role service_role;
do $$
begin
  perform public.arquivar_organizacao('92000000-0000-0000-0000-0000000000ff');
  raise exception 'arquivar aceitou org inexistente';
exception when sqlstate 'P0002' then null;
end $$;
do $$
begin
  perform public.desarquivar_organizacao('92000000-0000-0000-0000-0000000000ff');
  raise exception 'desarquivar aceitou org inexistente';
exception when sqlstate 'P0002' then null;
end $$;

-- 5) Desarquivar.
do $$
begin
  perform public.desarquivar_organizacao('92000000-0000-0000-0000-000000000001');
  if (select arquivada_em from public.organizations where id = '92000000-0000-0000-0000-000000000001') is not null
    then raise exception 'não desarquivou'; end if;
end $$;
reset role;

-- 5b) Desarquivada volta a aceitar upsert (reconexão via OAuth).
do $$
begin
  perform public.upsert_marketplace_connection('92000000-0000-0000-0000-000000000001', 'mercado_livre',
    '920001', 'x', 'a', 'r', 'scope', now() + interval '6 hours', null);
  if not exists (select 1 from public.marketplace_connections where org_id = '92000000-0000-0000-0000-000000000001')
    then raise exception 'upsert não reconectou após desarquivar'; end if;
end $$;

-- 6) anon e authenticated não executam as funções novas.
set local role authenticated;
do $$
begin
  perform public.arquivar_organizacao('92000000-0000-0000-0000-000000000001');
  raise exception 'authenticated executou arquivar';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform public.desarquivar_organizacao('92000000-0000-0000-0000-000000000001');
  raise exception 'authenticated executou desarquivar';
exception when insufficient_privilege then null;
end $$;
reset role;
set local role anon;
do $$
begin
  perform public.arquivar_organizacao('92000000-0000-0000-0000-000000000001');
  raise exception 'anon executou arquivar';
exception when insufficient_privilege then null;
end $$;
reset role;

rollback;
\echo 'arquivar_organizacao: OK'
