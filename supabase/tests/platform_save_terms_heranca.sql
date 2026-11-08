\set ON_ERROR_STOP on
-- Emenda 2026-11-08 ao ADR-0164: platform_save_terms herda a implantação do termo que vigora no mês gravado
-- e calcula o mês mínimo pelo relógio depois do lock.
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/platform_save_terms_heranca.sql \
--          supabase/migrations/20261108141425_platform_precos_unidade_vigencia_atual.sql \
--          supabase/migrations/20261108144858_platform_save_terms_heranca_resolvida.sql
-- Só toca dados do próprio fixture (orgs is_test, usuário, termos); tudo some no rollback.
begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97800000-0000-0000-0000-000000000001', 'Herança setup', 'heranca-setup-teste', array['pulse'], true),
  ('97800000-0000-0000-0000-000000000002', 'Herança normal', 'heranca-normal-teste', array['pulse'], true);
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('97800000-0000-0000-0000-000000000101', 'admin-heranca@teste.local', '{}'::jsonb,
   '{"org_id":"97800000-0000-0000-0000-000000000001"}'::jsonb);
update public.profiles set is_super_admin = true, org_id = null, is_active = true where id = '97800000-0000-0000-0000-000000000101';

create or replace function pg_temp.afirmar(c boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(c, false) then raise exception 'FALHA: %', msg; end if; end $$;

create or replace function pg_temp.reneg(o uuid, inicio date) returns jsonb language sql as $$
  select public.platform_save_terms('97800000-0000-0000-0000-000000000101', jsonb_build_object(
    'org_id', o, 'starts_on', inicio, 'modality', 2, 'monthly_fee_cents', 0,
    'revenue_bps_t1', 700, 'revenue_bps_t2', 600, 'revenue_bps_t3', 550, 'revenue_bps_t4', 500,
    'sonar_unit_cents', 120, 'image_unit_cents', 0, 'setup_fee_cents', 0, 'setup_due_month', null, 'reason', 'reneg'))
$$;

create or replace function pg_temp.setup_na_previa(o uuid, mes date) returns bigint language sql as $$
  select coalesce((select (l->>'amount_cents')::bigint
    from jsonb_array_elements(public.platform_billing_preview('97800000-0000-0000-0000-000000000101', o, mes)->'lines') l
    where l->>'key' = 'setup'), 0)
$$;

do $$
declare
  ator uuid := '97800000-0000-0000-0000-000000000101';
  o uuid := '97800000-0000-0000-0000-000000000001';
  n uuid := '97800000-0000-0000-0000-000000000002';
  mes date := date_trunc('month', now() at time zone 'America/Fortaleza')::date;
  m1 date := (date_trunc('month', now() at time zone 'America/Fortaleza') + interval '1 month')::date;
  m2 date := (date_trunc('month', now() at time zone 'America/Fortaleza') + interval '2 month')::date;
  t jsonb;
begin
  -- Primeiro contrato no mês corrente, implantação devida no mês seguinte (m1).
  t := public.platform_save_terms(ator, jsonb_build_object(
    'org_id', o, 'starts_on', mes, 'modality', 2, 'monthly_fee_cents', 0,
    'revenue_bps_t1', 700, 'revenue_bps_t2', 600, 'revenue_bps_t3', 550, 'revenue_bps_t4', 500,
    'sonar_unit_cents', 120, 'image_unit_cents', 0, 'setup_fee_cents', 300000, 'setup_due_month', to_char(m1, 'YYYY-MM'),
    'reason', 'primeiro contrato'));
  perform pg_temp.afirmar(pg_temp.setup_na_previa(o, m1) = 300000, 'fixture: implantação fora da prévia de m1');

  -- Renegociação para m2: vencimento (m1) anterior a ela → 0/null (regra do ADR-0164, inalterada).
  t := pg_temp.reneg(o, m2);
  perform pg_temp.afirmar((t->>'setup_fee_cents')::bigint = 0 and t->'setup_due_month' = 'null'::jsonb, 'm2 deveria zerar: ' || t::text);

  -- Troca de preço por unidade no mês corrente (versão nova de mes, copia a implantação).
  t := public.platform_save_unit_prices(ator, jsonb_build_object('org_id', o,
    'expected_terms_id', (public.platform_resolve_terms(o, mes)).id, 'sonar_unit_cents', 150, 'image_unit_cents', 0));
  perform pg_temp.afirmar((t->>'setup_fee_cents')::bigint = 300000, 'troca de preço perdeu a implantação: ' || t::text);

  -- Renegociação para m1 DEPOIS da de m2: herda do termo que vigora em m1 (o de mes), não do de m2 (zerado).
  t := pg_temp.reneg(o, m1);
  perform pg_temp.afirmar((t->>'setup_fee_cents')::bigint = 300000 and (t->>'setup_due_month')::date = m1,
    'renegociação de m1 herdou do termo futuro zerado: ' || t::text);
  perform pg_temp.afirmar(pg_temp.setup_na_previa(o, m1) = 300000, 'implantação sumiu da prévia de m1 (ADR-0164)');
  perform pg_temp.afirmar(pg_temp.setup_na_previa(o, m2) = 0, 'implantação duplicada em m2');

  -- Regressão: trava de reaplicar a implantação continua.
  begin
    perform public.platform_save_terms(ator, jsonb_build_object(
      'org_id', o, 'starts_on', m1, 'modality', 2, 'monthly_fee_cents', 0,
      'revenue_bps_t1', 700, 'revenue_bps_t2', 600, 'revenue_bps_t3', 550, 'revenue_bps_t4', 500,
      'sonar_unit_cents', 120, 'setup_fee_cents', 1, 'setup_due_month', to_char(m1, 'YYYY-MM'), 'reason', 'x'));
    raise exception 'FALHA: implantação reaplicada';
  exception when invalid_parameter_value then null;
  end;

  -- Regressão: caso comum (contrato com implantação no mês seguinte, uma renegociação para ele) herda igual.
  perform public.platform_save_terms(ator, jsonb_build_object(
    'org_id', n, 'starts_on', mes, 'modality', 2, 'monthly_fee_cents', 0,
    'revenue_bps_t1', 700, 'revenue_bps_t2', 600, 'revenue_bps_t3', 550, 'revenue_bps_t4', 500,
    'sonar_unit_cents', 120, 'setup_fee_cents', 300000, 'setup_due_month', to_char(m1, 'YYYY-MM'), 'reason', 'contrato'));
  t := pg_temp.reneg(n, m1);
  perform pg_temp.afirmar((t->>'setup_fee_cents')::bigint = 300000, 'caso comum deixou de herdar: ' || t::text);
  -- Renegociação no mês corrente continua recusada (só a partir do mês seguinte).
  begin
    perform pg_temp.reneg(n, mes);
    raise exception 'FALHA: renegociação no mês corrente aceita';
  exception when invalid_parameter_value then null;
  end;

  -- Mês mínimo pelo relógio depois do lock (a virada não dá para simular numa transação: guarda estrutural).
  perform pg_temp.afirmar((select prosrc from pg_proc where oid = 'public.platform_save_terms(uuid,jsonb)'::regprocedure)
    like '%clock_timestamp() at time zone%' and (select prosrc from pg_proc where oid = 'public.platform_save_terms(uuid,jsonb)'::regprocedure)
    not like '%now() at time zone%', 'platform_save_terms ainda calcula o mês com now()');
end $$;

rollback;
