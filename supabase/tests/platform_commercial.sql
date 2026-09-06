\set ON_ERROR_STOP on

do $$
begin
  if current_database() <> 'codex_platform_admin_test_20260906' then
    raise exception 'platform_commercial.sql only runs in the dedicated test database';
  end if;
  if inet_server_addr() is not null and not (inet_server_addr() <<= inet '127.0.0.0/8') then
    raise exception 'platform_commercial.sql requires a local PostgreSQL server';
  end if;
end $$;

drop schema if exists public cascade;
create schema public;
grant all on schema public to postgres, supabase_admin;
create extension if not exists pgcrypto;
create extension if not exists dblink;
create schema if not exists auth;
create table public.organizations (
  id uuid primary key,
  nome text not null,
  slug text not null unique
);
create table public.profiles (
  id uuid primary key,
  is_super_admin boolean not null default false,
  is_active boolean not null default true
);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

\ir ../migrations/20260906170000_platform_commercial_foundation.sql

insert into public.organizations (id, nome, slug) values
  ('90000000-0000-0000-0000-000000000001', 'Org A', 'org-a'),
  ('90000000-0000-0000-0000-000000000002', 'Org B', 'org-b');
insert into public.profiles (id, is_super_admin, is_active) values
  ('80000000-0000-0000-0000-000000000001', true, true),
  ('80000000-0000-0000-0000-000000000002', false, true);

do $$
declare
  v_input jsonb;
begin
  foreach v_input in array array[
    jsonb_build_object(
      'org_id', '90000000-0000-0000-0000-000000000001', 'starts_on', '2026-10-01',
      'modality', 2, 'revenue_bps', 700, 'sonar_unit_cents', 0, 'setup_fee_cents', 0,
      'setup_due_month', null, 'reason', 'centavos ausentes'
    ),
    jsonb_build_object(
      'org_id', '90000000-0000-0000-0000-000000000001', 'starts_on', '2026-10-01',
      'modality', 2, 'monthly_fee_cents', 1.5, 'revenue_bps', 700, 'sonar_unit_cents', 0,
      'setup_fee_cents', 0, 'setup_due_month', null, 'reason', 'centavos decimais'
    ),
    jsonb_build_object(
      'org_id', '90000000-0000-0000-0000-000000000001', 'starts_on', '2026-10-01',
      'modality', 2, 'monthly_fee_cents', 9007199254740992, 'revenue_bps', 700, 'sonar_unit_cents', 0,
      'setup_fee_cents', 0, 'setup_due_month', null, 'reason', 'centavos inseguros'
    ),
    jsonb_build_object(
      'org_id', '90000000-0000-0000-0000-000000000001', 'starts_on', '2026-10-01',
      'modality', 1.5, 'monthly_fee_cents', 0, 'revenue_bps', 700, 'sonar_unit_cents', 0,
      'setup_fee_cents', 0, 'setup_due_month', null, 'reason', 'modalidade decimal'
    ),
    jsonb_build_object(
      'org_id', '90000000-0000-0000-0000-000000000001', 'starts_on', '2026-10-01',
      'modality', 2, 'monthly_fee_cents', 0, 'revenue_bps', 0.5, 'sonar_unit_cents', 0,
      'setup_fee_cents', 0, 'setup_due_month', null, 'reason', 'percentual decimal'
    ),
    jsonb_build_object(
      'org_id', '90000000-0000-0000-0000-000000000001', 'starts_on', '2026-10-01',
      'modality', 2, 'monthly_fee_cents', 0, 'revenue_bps', 0, 'sonar_unit_cents', 0,
      'setup_fee_cents', 1, 'reason', 'setup sem competência'
    ),
    jsonb_build_object(
      'org_id', '90000000-0000-0000-0000-000000000001', 'starts_on', '2026-10-01',
      'modality', 2, 'monthly_fee_cents', 0, 'revenue_bps', 0, 'sonar_unit_cents', 0,
      'setup_fee_cents', 1, 'setup_due_month', '2026-13', 'reason', 'setup inválido'
    )
  ] loop
    begin
      perform public.platform_save_terms('80000000-0000-0000-0000-000000000001', v_input);
      raise exception 'invalid numeric input was accepted: %', v_input;
    exception when sqlstate '22023' then null;
    end;
  end loop;
end $$;

do $$
begin
  begin
    insert into public.platform_commercial_terms (
      org_id, starts_on, modality, monthly_fee_cents, revenue_bps,
      sonar_unit_cents, setup_fee_cents, setup_due_month, reason, created_by, version
    ) values (
      '90000000-0000-0000-0000-000000000001', '2026-10-01', 2, 9007199254740992, 0,
      0, 0, null, 'centavos inseguros direto', '80000000-0000-0000-0000-000000000001', 1
    );
    raise exception 'unsafe direct cents were allowed';
  exception when check_violation then null;
  end;
end $$;

do $$
begin
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.platform_commercial_terms (
      org_id, starts_on, modality, monthly_fee_cents, revenue_bps,
      sonar_unit_cents, setup_fee_cents, setup_due_month, reason, created_by, version
    ) values (
      '90000000-0000-0000-0000-000000000001', '2026-10-01', 2, 0, 0, 0, 0, null,
      'browser write', '80000000-0000-0000-0000-000000000001', 1
    );
    raise exception 'authenticated direct DML was allowed';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'none', true);
end $$;

do $$
begin
  perform set_config('role', 'service_role', true);
  begin
    perform public.platform_save_terms(
      '80000000-0000-0000-0000-000000000002',
      jsonb_build_object(
        'org_id', '90000000-0000-0000-0000-000000000001',
        'starts_on', '2026-10-01', 'modality', 2, 'monthly_fee_cents', 60000,
        'revenue_bps', 700, 'sonar_unit_cents', 0, 'setup_fee_cents', 0,
        'setup_due_month', null, 'reason', 'actor comum'
      )
    );
    raise exception 'non-super-admin actor was allowed';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'none', true);
end $$;

select public.platform_save_terms(
  '80000000-0000-0000-0000-000000000001',
  jsonb_build_object(
    'org_id', '90000000-0000-0000-0000-000000000001',
    'starts_on', '2026-10-01', 'modality', 2, 'monthly_fee_cents', 60000,
    'revenue_bps', 700, 'sonar_unit_cents', 0, 'setup_fee_cents', 0,
    'setup_due_month', null, 'reason', 'primeira proposta'
  )
);
select public.platform_save_terms(
  '80000000-0000-0000-0000-000000000001',
  jsonb_build_object(
    'org_id', '90000000-0000-0000-0000-000000000002',
    'starts_on', '2026-10-01', 'modality', 1, 'monthly_fee_cents', 0,
    'revenue_bps', 0, 'sonar_unit_cents', 0, 'setup_fee_cents', 0,
    'setup_due_month', null, 'reason', 'zero é válido'
  )
);
select public.platform_save_terms(
  '80000000-0000-0000-0000-000000000001',
  jsonb_build_object(
    'org_id', '90000000-0000-0000-0000-000000000001',
    'starts_on', '2026-10-01', 'modality', 2, 'monthly_fee_cents', 70000,
    'revenue_bps', 700, 'sonar_unit_cents', 0, 'setup_fee_cents', 0,
    'setup_due_month', null, 'reason', 'renegociação'
  )
);

do $$
begin
  if (select count(*) from public.platform_commercial_terms where org_id = '90000000-0000-0000-0000-000000000001') <> 2 then
    raise exception 'history was not preserved';
  end if;
  if (select version from public.platform_commercial_terms where org_id = '90000000-0000-0000-0000-000000000001' and starts_on = '2026-10-01' order by version desc limit 1) <> 2 then
    raise exception 'latest version did not win';
  end if;
  begin
    update public.platform_commercial_terms set monthly_fee_cents = 1
      where org_id = '90000000-0000-0000-0000-000000000001' and version = 1;
    raise exception 'commercial term was mutable';
  exception when check_violation then null;
  end;
end $$;

select dblink_connect('terms_1', format('dbname=%L user=supabase_admin', current_database()));
select dblink_connect('terms_2', format('dbname=%L user=supabase_admin', current_database()));
select dblink_send_query('terms_1', $$
  select public.platform_save_terms(
    '80000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'org_id', '90000000-0000-0000-0000-000000000001', 'starts_on', '2026-10-01',
      'modality', 2, 'monthly_fee_cents', 71000, 'revenue_bps', 700,
      'sonar_unit_cents', 0, 'setup_fee_cents', 0, 'setup_due_month', null, 'reason', 'concorrência um'
    )
  )
$$);
select dblink_send_query('terms_2', $$
  select public.platform_save_terms(
    '80000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'org_id', '90000000-0000-0000-0000-000000000001', 'starts_on', '2026-10-01',
      'modality', 2, 'monthly_fee_cents', 72000, 'revenue_bps', 700,
      'sonar_unit_cents', 0, 'setup_fee_cents', 0, 'setup_due_month', null, 'reason', 'concorrência dois'
    )
  )
$$);
select * from dblink_get_result('terms_1') as result(payload jsonb);
select * from dblink_get_result('terms_2') as result(payload jsonb);
select dblink_disconnect('terms_1');
select dblink_disconnect('terms_2');

do $$
begin
  if (select count(distinct version) from public.platform_commercial_terms where org_id = '90000000-0000-0000-0000-000000000001' and starts_on = '2026-10-01') <> 4 then
    raise exception 'concurrent renegotiations did not append distinct versions';
  end if;
  if (select count(*) from public.platform_audit_events where org_id = '90000000-0000-0000-0000-000000000001' and action = 'platform_terms_saved') <> 4 then
    raise exception 'audit event missing';
  end if;
end $$;
