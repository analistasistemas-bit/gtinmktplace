\set ON_ERROR_STOP on
begin;
insert into public.organizations (id, nome, slug) values
  ('97000000-0000-0000-0000-000000000001', 'Agente test', 'agente-test');
insert into auth.users (id, email, raw_user_meta_data) values
  ('97000000-0000-0000-0000-000000000101', 'agente@test.local', '{"org_id":"97000000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('97000000-0000-0000-0000-000000000101', '97000000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;

-- Escrita como service_role (o papel real das edges), não como dono do banco.
set local role service_role;
insert into public.agente_conexoes (id, org_id, nome, prefixo, hash, criada_por, expira_em) values
  ('97000000-0000-0000-0000-000000000201', '97000000-0000-0000-0000-000000000001', 'Claude', 'pai_abc',
   'hash-teste-1', '97000000-0000-0000-0000-000000000101', now() + interval '90 days');
insert into public.agente_chamadas (org_id, conexao_id, ferramenta, alvo, resultado) values
  ('97000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000201', 'margem_anuncio', 'MLB1', 'ok');

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
end $$;
reset role;

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
