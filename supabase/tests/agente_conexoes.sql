\set ON_ERROR_STOP on
begin;
insert into public.organizations (id, nome, slug) values
  ('97000000-0000-0000-0000-000000000001', 'Agente test', 'agente-test'),
  ('97000000-0000-0000-0000-000000000002', 'Outra org agente', 'outra-org-agente');
insert into auth.users (id, email, raw_user_meta_data) values
  ('97000000-0000-0000-0000-000000000101', 'agente@test.local', '{"org_id":"97000000-0000-0000-0000-000000000001"}'::jsonb),
  ('97000000-0000-0000-0000-000000000102', 'outra-agente@test.local', '{"org_id":"97000000-0000-0000-0000-000000000002"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('97000000-0000-0000-0000-000000000101', '97000000-0000-0000-0000-000000000001', true),
  ('97000000-0000-0000-0000-000000000102', '97000000-0000-0000-0000-000000000002', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;

-- Escrita como service_role (o papel real das edges), não como dono do banco.
set local role service_role;
insert into public.agente_conexoes (id, org_id, nome, prefixo, hash, criada_por, expira_em) values
  ('97000000-0000-0000-0000-000000000201', '97000000-0000-0000-0000-000000000001', 'Claude', 'pai_abc',
   'hash-teste-1', '97000000-0000-0000-0000-000000000101', now() + interval '90 days'),
  ('97000000-0000-0000-0000-000000000202', '97000000-0000-0000-0000-000000000002', 'Claude B', 'pai_xyz',
   'hash-teste-b', '97000000-0000-0000-0000-000000000102', now() + interval '90 days');
insert into public.agente_chamadas (org_id, conexao_id, ferramenta, alvo, resultado) values
  ('97000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000201', 'margem_anuncio', 'MLB1', 'ok'),
  ('97000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000202', 'margem_anuncio', 'MLB2', 'ok');

do $$ begin
  begin
    insert into public.agente_conexoes (org_id, nome, prefixo, hash, criada_por, expira_em) values
      ('97000000-0000-0000-0000-000000000001', 'Longa', 'pai_def', 'hash-teste-2',
       '97000000-0000-0000-0000-000000000101', now() + interval '400 days');
    raise exception 'aceitou expira_em 400 dias à frente';
  exception when check_violation then null;
  end;
  begin
    insert into public.agente_conexoes (org_id, nome, prefixo, hash, criada_por, expira_em) values
      ('97000000-0000-0000-0000-000000000001', 'Duplicada', 'pai_ghi', 'hash-teste-1',
       '97000000-0000-0000-0000-000000000101', now() + interval '30 days');
    raise exception 'aceitou hash duplicado';
  exception when unique_violation then null;
  end;
  -- Auditoria com org_id de uma loja e conexão de outra: FK composta recusa.
  begin
    insert into public.agente_chamadas (org_id, conexao_id, ferramenta, resultado) values
      ('97000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000201', 'margem_anuncio', 'ok');
    raise exception 'aceitou chamada com org_id de outra org';
  exception when foreign_key_violation then null;
  end;
  -- Apagar a conexão apaga as chamadas dela (e só dela).
  delete from public.agente_conexoes where id = '97000000-0000-0000-0000-000000000202';
  if exists (select 1 from public.agente_chamadas where conexao_id = '97000000-0000-0000-0000-000000000202')
     then raise exception 'cascade não apagou as chamadas da conexão'; end if;
  if not exists (select 1 from public.agente_chamadas where conexao_id = '97000000-0000-0000-0000-000000000201')
     then raise exception 'cascade apagou chamada de outra conexão'; end if;
end $$;
reset role;

-- Privilégios efetivos: anon e authenticated não têm nenhum (RLS não cobre TRUNCATE).
do $$
declare papel text; tabela text; priv text;
begin
  foreach papel in array array['anon','authenticated'] loop
    foreach tabela in array array['public.agente_conexoes','public.agente_chamadas'] loop
      foreach priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] loop
        if has_table_privilege(papel, tabela, priv)
           then raise exception 'privilégio indevido: % tem % em %', papel, priv, tabela; end if;
      end loop;
    end loop;
  end loop;
end $$;

-- authenticated (mesmo da própria org) não lê nada: só as edges acessam (ADR-0210).
set local role authenticated;
set local request.jwt.claims = '{"sub":"97000000-0000-0000-0000-000000000101","role":"authenticated"}';
do $$ begin
  begin
    perform 1 from public.agente_conexoes;
    raise exception 'authenticated leu agente_conexoes';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.agente_chamadas;
    raise exception 'authenticated leu agente_chamadas';
  exception when insufficient_privilege then null;
  end;
  raise notice 'TESTE_OK';
end $$;
rollback;
