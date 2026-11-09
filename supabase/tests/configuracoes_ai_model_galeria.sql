\set ON_ERROR_STOP on
-- Galeria da cor por IA (Task 5): coluna configuracoes.ai_model_galeria, check dos 3 slugs e escrita só do
-- admin da plataforma (super-admin em sessão de suporte full) ou do servidor.
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/configuracoes_ai_model_galeria.sql \
--   supabase/migrations/20261109122959_configuracoes_ai_model_galeria.sql
begin;
insert into public.organizations (id, nome, slug) values
  ('97500000-0000-0000-0000-000000000001', 'Galeria test', 'galeria-test');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('97500000-0000-0000-0000-000000000101', 'galeria-admin@test.local', '{}'::jsonb,
   '{"org_id":"97500000-0000-0000-0000-000000000001"}'::jsonb),
  ('97500000-0000-0000-0000-000000000102', 'galeria-super@test.local', '{"is_super_admin":true}'::jsonb, '{}'::jsonb);
update public.profiles set is_admin = true where id = '97500000-0000-0000-0000-000000000101';
insert into public.support_requests (
  id, requester_id, org_id, scope, reason, status, decided_by, approved_at, approval_expires_at, started_at, expires_at
) values (
  '97500000-0000-0000-0000-000000000201', '97500000-0000-0000-0000-000000000102',
  '97500000-0000-0000-0000-000000000001', 'full', 'teste galeria', 'active', '97500000-0000-0000-0000-000000000101',
  now(), now() + interval '1 hour', now(), now() + interval '1 hour'
);

-- Coluna existe e nasce nula.
insert into public.configuracoes (org_id) values ('97500000-0000-0000-0000-000000000001') on conflict (org_id) do nothing;
do $$ begin
  if (select ai_model_galeria from public.configuracoes where org_id = '97500000-0000-0000-0000-000000000001') is not null
    then raise exception 'ai_model_galeria deveria nascer nulo'; end if;
end $$;

-- Servidor (service_role) grava os 3 slugs e volta a nulo; slug desconhecido é recusado pelo check.
set local role service_role;
do $$ declare s text; begin
  foreach s in array array['xai/grok-imagine-image-2.0', 'alibaba/qwen-image-3/edit', 'google/gemini-nano-banana-2.1'] loop
    update public.configuracoes set ai_model_galeria = s where org_id = '97500000-0000-0000-0000-000000000001';
    if not found then raise exception 'update sem linha'; end if;
  end loop;
  update public.configuracoes set ai_model_galeria = null where org_id = '97500000-0000-0000-0000-000000000001';
  begin
    update public.configuracoes set ai_model_galeria = 'foo/bar' where org_id = '97500000-0000-0000-0000-000000000001';
    raise exception 'slug desconhecido foi aceito';
  exception when check_violation then null;
  end;
end $$;
reset role;

-- Admin da org: lê a coluna, troca outros campos, mas não troca o modelo da galeria.
set local role authenticated;
set local request.jwt.claims = '{"sub":"97500000-0000-0000-0000-000000000101","role":"authenticated"}';
do $$ begin
  perform ai_model_galeria from public.configuracoes;
  update public.configuracoes set ai_model_texto = 'openai/gpt-4.1-mini' where org_id = '97500000-0000-0000-0000-000000000001';
  if not found then raise exception 'admin da org não alcançou a linha (RLS)'; end if;
  begin
    update public.configuracoes set ai_model_galeria = 'alibaba/qwen-image-3/edit'
      where org_id = '97500000-0000-0000-0000-000000000001';
    raise exception 'admin da org trocou o modelo da galeria';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Super-admin em sessão de suporte full: troca.
set local role authenticated;
set local request.jwt.claims = '{"sub":"97500000-0000-0000-0000-000000000102","role":"authenticated"}';
do $$ begin
  update public.configuracoes set ai_model_galeria = 'alibaba/qwen-image-3/edit'
    where org_id = '97500000-0000-0000-0000-000000000001';
  if not found then raise exception 'super-admin não alcançou a linha (RLS/suporte)'; end if;
end $$;
reset role;
do $$ begin
  if (select ai_model_galeria from public.configuracoes where org_id = '97500000-0000-0000-0000-000000000001')
     is distinct from 'alibaba/qwen-image-3/edit' then raise exception 'super-admin não gravou'; end if;
end $$;
rollback;
