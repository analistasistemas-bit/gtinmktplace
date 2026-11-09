\set ON_ERROR_STOP on
-- Galeria da cor por IA (Task 6b): galeria_leituras_etiqueta — uma leitura por (org, anúncio, família),
-- leitura só pela própria org, escrita só service_role.
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/galeria_leitura_etiqueta.sql \
--   supabase/migrations/20261109144013_galeria_leitura_etiqueta.sql
begin;
set local lock_timeout = '5s';
insert into public.organizations (id, nome, slug) values
  ('97600000-0000-0000-0000-000000000001', 'Etiqueta A', 'etiqueta-a'),
  ('97600000-0000-0000-0000-000000000002', 'Etiqueta B', 'etiqueta-b');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('97600000-0000-0000-0000-000000000101', 'etq-a@test.local', '{}'::jsonb, '{"org_id":"97600000-0000-0000-0000-000000000001"}'::jsonb),
  ('97600000-0000-0000-0000-000000000102', 'etq-b@test.local', '{}'::jsonb, '{"org_id":"97600000-0000-0000-0000-000000000002"}'::jsonb);

-- Servidor grava; leitura não-objeto recusada; mesma (org, anúncio, família) → unique.
set local role service_role;
insert into public.galeria_leituras_etiqueta (org_id, anuncio_externo_id, familia_id, chave, leitura, parcial)
  values ('97600000-0000-0000-0000-000000000001', null, '97600000-0000-0000-0000-0000000000f1', 'k1',
          '{"marca":{"estado":"consistente"}}', true);
do $$ begin
  begin
    insert into public.galeria_leituras_etiqueta (org_id, familia_id, leitura)
      values ('97600000-0000-0000-0000-000000000001', gen_random_uuid(), '[]');
    raise exception 'leitura não-objeto aceita';
  exception when check_violation then null;
  end;
  if (select falhou or pulou_por_erro or not parcial from public.galeria_leituras_etiqueta where chave = 'k1') then
    raise exception 'defaults/parcial errados';
  end if;
end $$;
reset role;

-- Org A lê a sua; não grava nem altera.
set local role authenticated;
set local request.jwt.claims = '{"sub":"97600000-0000-0000-0000-000000000101","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.galeria_leituras_etiqueta) <> 1 then raise exception 'org A deveria ver 1 leitura'; end if;
  begin
    insert into public.galeria_leituras_etiqueta (org_id, familia_id) values ('97600000-0000-0000-0000-000000000001', gen_random_uuid());
    raise exception 'authenticated gravou leitura';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.galeria_leituras_etiqueta set falhou = true;
    raise exception 'authenticated alterou leitura';
  exception when insufficient_privilege then null;
  end;
end $$;
-- Org B não vê a leitura da A.
set local request.jwt.claims = '{"sub":"97600000-0000-0000-0000-000000000102","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.galeria_leituras_etiqueta) <> 0 then raise exception 'org B viu leitura da A'; end if;
end $$;
reset role;
-- anon não lê.
set local role anon;
do $$ begin
  begin
    perform 1 from public.galeria_leituras_etiqueta;
    raise exception 'anon leu leitura';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
