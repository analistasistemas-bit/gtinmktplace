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
  ('90000000-0000-0000-0000-000000000002', 'Org B', 'org-b'),
  ('90000000-0000-0000-0000-000000000011', 'Org C', 'org-c'),
  ('90000000-0000-0000-0000-000000000012', 'Org D', 'org-d');
insert into public.profiles (id, is_super_admin, is_active) values
  ('80000000-0000-0000-0000-000000000001', true, true),
  ('80000000-0000-0000-0000-000000000002', false, true);

do $$
declare
  v_current date := date_trunc('month', now() at time zone 'America/Fortaleza')::date;
  v_next date := (v_current + interval '1 month')::date;
  v_input jsonb;
begin
  perform public.platform_save_terms(
    '80000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'org_id', '90000000-0000-0000-0000-000000000011',
      'starts_on', v_current, 'modality', 2, 'monthly_fee_cents', 60000,
      'revenue_bps', 700, 'sonar_unit_cents', 0, 'setup_fee_cents', 0,
      'setup_due_month', null, 'reason', 'primeiro contrato mês corrente'
    )
  );

  begin
    perform public.platform_save_terms(
      '80000000-0000-0000-0000-000000000001',
      jsonb_build_object(
        'org_id', '90000000-0000-0000-0000-000000000012',
        'starts_on', (v_current - interval '1 month')::date, 'modality', 2, 'monthly_fee_cents', 60000,
        'revenue_bps', 700, 'sonar_unit_cents', 0, 'setup_fee_cents', 0,
        'setup_due_month', null, 'reason', 'primeiro contrato retroativo'
      )
    );
    raise exception 'first contract in past month was accepted';
  exception when sqlstate '22023' then null;
  end;

  foreach v_input in array array[
    jsonb_build_object(
      'org_id', '90000000-0000-0000-0000-000000000001', 'starts_on', v_next,
      'modality', 2, 'revenue_bps', 700, 'sonar_unit_cents', 0, 'setup_fee_cents', 0,
      'setup_due_month', null, 'reason', 'centavos ausentes'
    ),
    jsonb_build_object(
      'org_id', '90000000-0000-0000-0000-000000000001', 'starts_on', v_next,
      'modality', 2, 'monthly_fee_cents', 1.5, 'revenue_bps', 700, 'sonar_unit_cents', 0,
      'setup_fee_cents', 0, 'setup_due_month', null, 'reason', 'centavos decimais'
    ),
    jsonb_build_object(
      'org_id', '90000000-0000-0000-0000-000000000001', 'starts_on', v_next,
      'modality', 2, 'monthly_fee_cents', 9007199254740992, 'revenue_bps', 700, 'sonar_unit_cents', 0,
      'setup_fee_cents', 0, 'setup_due_month', null, 'reason', 'centavos inseguros'
    ),
    jsonb_build_object(
      'org_id', '90000000-0000-0000-0000-000000000001', 'starts_on', v_next,
      'modality', 1.5, 'monthly_fee_cents', 0, 'revenue_bps', 700, 'sonar_unit_cents', 0,
      'setup_fee_cents', 0, 'setup_due_month', null, 'reason', 'modalidade decimal'
    ),
    jsonb_build_object(
      'org_id', '90000000-0000-0000-0000-000000000001', 'starts_on', v_next,
      'modality', 2, 'monthly_fee_cents', 0, 'revenue_bps', 0.5, 'sonar_unit_cents', 0,
      'setup_fee_cents', 0, 'setup_due_month', null, 'reason', 'percentual decimal'
    ),
    jsonb_build_object(
      'org_id', '90000000-0000-0000-0000-000000000001', 'starts_on', v_next,
      'modality', 2, 'monthly_fee_cents', 0, 'revenue_bps', 0, 'sonar_unit_cents', 0,
      'setup_fee_cents', 1, 'reason', 'setup sem competência'
    ),
    jsonb_build_object(
      'org_id', '90000000-0000-0000-0000-000000000001', 'starts_on', v_next,
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
declare
  v_next date := (date_trunc('month', now() at time zone 'America/Fortaleza') + interval '1 month')::date;
begin
  begin
    insert into public.platform_commercial_terms (
      org_id, starts_on, modality, monthly_fee_cents, revenue_bps,
      sonar_unit_cents, setup_fee_cents, setup_due_month, reason, created_by, version
    ) values (
      '90000000-0000-0000-0000-000000000001', v_next, 2, 9007199254740992, 0,
      0, 0, null, 'centavos inseguros direto', '80000000-0000-0000-0000-000000000001', 1
    );
    raise exception 'unsafe direct cents were allowed';
  exception when check_violation then null;
  end;
end $$;

do $$
declare
  v_next date := (date_trunc('month', now() at time zone 'America/Fortaleza') + interval '1 month')::date;
begin
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.platform_commercial_terms (
      org_id, starts_on, modality, monthly_fee_cents, revenue_bps,
      sonar_unit_cents, setup_fee_cents, setup_due_month, reason, created_by, version
    ) values (
      '90000000-0000-0000-0000-000000000001', v_next, 2, 0, 0, 0, 0, null,
      'browser write', '80000000-0000-0000-0000-000000000001', 1
    );
    raise exception 'authenticated direct DML was allowed';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'none', true);
end $$;

do $$
declare
  v_next date := (date_trunc('month', now() at time zone 'America/Fortaleza') + interval '1 month')::date;
begin
  perform set_config('role', 'service_role', true);
  begin
    perform public.platform_save_terms(
      '80000000-0000-0000-0000-000000000002',
      jsonb_build_object(
        'org_id', '90000000-0000-0000-0000-000000000001',
        'starts_on', v_next, 'modality', 2, 'monthly_fee_cents', 60000,
        'revenue_bps', 700, 'sonar_unit_cents', 0, 'setup_fee_cents', 0,
        'setup_due_month', null, 'reason', 'actor comum'
      )
    );
    raise exception 'non-super-admin actor was allowed';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'none', true);
end $$;

do $$
declare
  v_current date := date_trunc('month', now() at time zone 'America/Fortaleza')::date;
  v_next date := (v_current + interval '1 month')::date;
begin
  perform public.platform_save_terms(
    '80000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'org_id', '90000000-0000-0000-0000-000000000001',
      'starts_on', v_next, 'modality', 2, 'monthly_fee_cents', 60000,
      'revenue_bps', 700, 'sonar_unit_cents', 0, 'setup_fee_cents', 0,
      'setup_due_month', null, 'reason', 'primeira proposta'
    )
  );

  begin
    perform public.platform_save_terms(
      '80000000-0000-0000-0000-000000000001',
      jsonb_build_object(
        'org_id', '90000000-0000-0000-0000-000000000001',
        'starts_on', v_current, 'modality', 2, 'monthly_fee_cents', 65000,
        'revenue_bps', 700, 'sonar_unit_cents', 0, 'setup_fee_cents', 0,
        'setup_due_month', null, 'reason', 'renegociação mês corrente'
      )
    );
    raise exception 'renegotiation in current month was accepted';
  exception when sqlstate '22023' then null;
  end;

  perform public.platform_save_terms(
    '80000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'org_id', '90000000-0000-0000-0000-000000000002',
      'starts_on', v_next, 'modality', 1, 'monthly_fee_cents', 0,
      'revenue_bps', 0, 'sonar_unit_cents', 0, 'setup_fee_cents', 0,
      'setup_due_month', null, 'reason', 'zero é válido'
    )
  );
  perform public.platform_save_terms(
    '80000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'org_id', '90000000-0000-0000-0000-000000000001',
      'starts_on', v_next, 'modality', 2, 'monthly_fee_cents', 70000,
      'revenue_bps', 700, 'sonar_unit_cents', 0, 'setup_fee_cents', 0,
      'setup_due_month', null, 'reason', 'renegociação'
    )
  );
end $$;

do $$
declare
  v_next date := (date_trunc('month', now() at time zone 'America/Fortaleza') + interval '1 month')::date;
begin
  if (select count(*) from public.platform_commercial_terms where org_id = '90000000-0000-0000-0000-000000000001') <> 2 then
    raise exception 'history was not preserved';
  end if;
  if (select version from public.platform_commercial_terms where org_id = '90000000-0000-0000-0000-000000000001' and starts_on = v_next order by version desc limit 1) <> 2 then
    raise exception 'latest version did not win';
  end if;
  begin
    update public.platform_commercial_terms set monthly_fee_cents = 1
      where org_id = '90000000-0000-0000-0000-000000000001' and version = 1;
    raise exception 'commercial term was mutable';
  exception when check_violation then null;
  end;
end $$;

do $$
declare
  v_next date := (date_trunc('month', now() at time zone 'America/Fortaleza') + interval '1 month')::date;
  v_query_one text;
  v_query_two text;
begin
  v_query_one := format($q$
    select public.platform_save_terms(
      '80000000-0000-0000-0000-000000000001',
      jsonb_build_object(
        'org_id', '90000000-0000-0000-0000-000000000001', 'starts_on', %L,
        'modality', 2, 'monthly_fee_cents', 71000, 'revenue_bps', 700,
        'sonar_unit_cents', 0, 'setup_fee_cents', 0, 'setup_due_month', null, 'reason', 'concorrência um'
      )
    )
  $q$, v_next);
  v_query_two := format($q$
    select public.platform_save_terms(
      '80000000-0000-0000-0000-000000000001',
      jsonb_build_object(
        'org_id', '90000000-0000-0000-0000-000000000001', 'starts_on', %L,
        'modality', 2, 'monthly_fee_cents', 72000, 'revenue_bps', 700,
        'sonar_unit_cents', 0, 'setup_fee_cents', 0, 'setup_due_month', null, 'reason', 'concorrência dois'
      )
    )
  $q$, v_next);

  perform dblink_connect('terms_1', format('dbname=%L user=supabase_admin', current_database()));
  perform dblink_connect('terms_2', format('dbname=%L user=supabase_admin', current_database()));
  perform dblink_send_query('terms_1', v_query_one);
  perform dblink_send_query('terms_2', v_query_two);
  perform (
    select 1 from dblink_get_result('terms_1') as result(payload jsonb) limit 1
  );
  perform (
    select 1 from dblink_get_result('terms_2') as result(payload jsonb) limit 1
  );
  perform dblink_disconnect('terms_1');
  perform dblink_disconnect('terms_2');
end $$;

do $$
declare
  v_next date := (date_trunc('month', now() at time zone 'America/Fortaleza') + interval '1 month')::date;
begin
  if (select count(distinct version) from public.platform_commercial_terms where org_id = '90000000-0000-0000-0000-000000000001' and starts_on = v_next) <> 4 then
    raise exception 'concurrent renegotiations did not append distinct versions';
  end if;
  if (select count(*) from public.platform_audit_events where org_id = '90000000-0000-0000-0000-000000000001' and action = 'platform_terms_saved') <> 4 then
    raise exception 'audit event missing';
  end if;
end $$;

-- ADR-0158 §5: catalogo de custo por RPC (platform_org_cost_catalog).
-- Fixtures minimas de catalogo/vendas. Os tipos abaixo sao os reais de producao, conferidos em
-- information_schema.columns em 2026-09-07: variacoes.ml_variation_id text, ml_vendas_itens.
-- variation_id bigint, familias.origem enum public.origem_produto, custo/peso_gramas numeric.
create type public.origem_produto as enum ('nacional', 'importado');

create table public.familias (
  id uuid primary key,
  org_id uuid not null,
  ml_item_id text,
  origem public.origem_produto
);
create table public.variacoes (
  id uuid primary key,
  org_id uuid not null,
  familia_id uuid not null references public.familias(id),
  custo numeric,
  peso_gramas numeric,
  ml_variation_id text,
  gtin text,
  codigo text,
  atualizado_em timestamptz
);
create table public.ml_vendas (
  id uuid primary key,
  org_id uuid not null,
  date_closed timestamptz
);
create table public.ml_vendas_itens (
  id uuid primary key,
  venda_id uuid not null references public.ml_vendas(id),
  ml_item_id text,
  variation_id bigint,
  ean text,
  codigo text
);

-- Migrations novas que tocam o catalogo de custo entram ABAIXO, em ordem de timestamp.
-- Fora de ordem (ou ausentes) o teste roda contra a versao antiga da funcao e passa em falso.
\ir ../migrations/20260907103422_platform_org_cost_catalog.sql

insert into public.familias (id, org_id, ml_item_id, origem) values
  ('a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'MLA1', 'nacional'),
  ('a0000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', 'MLA2', 'importado'),
  ('a0000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000002', 'MLB1', 'nacional'),
  ('a0000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000001', 'MLA4', 'nacional');

insert into public.variacoes (id, org_id, familia_id, custo, peso_gramas, ml_variation_id, gtin, codigo, atualizado_em) values
  ('b0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 10.50, 100, '111', 'EANA1', 'SKUA1', '2026-08-01T00:00:00Z'),
  ('b0000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 20.00, 200, '222', 'EANA2', 'SKUA2', '2026-08-01T00:00:00Z'),
  ('b0000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', 30.00, 300, '333', 'EANB1', 'SKUB1', '2026-08-01T00:00:00Z'),
  -- GTIN com zero a esquerda: so casa com o ean da venda depois da normalizacao `normGtin`.
  ('b0000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004', 40.00, 400, '444', '0999', 'SKUA4', '2026-08-01T00:00:00Z');

insert into public.ml_vendas (id, org_id, date_closed) values
  ('c0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', '2026-08-10T12:00:00Z'),
  ('c0000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000002', '2026-08-10T12:00:00Z'),
  ('c0000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000001', '2026-01-10T12:00:00Z'),
  ('c0000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000001', '2026-08-11T12:00:00Z');

insert into public.ml_vendas_itens (id, venda_id, ml_item_id, variation_id, ean, codigo) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'MLA1', 111, null, null),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'MLB1', 333, null, null),
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'MLA2', 222, 'EANA2', 'SKUA2'),
  -- Nenhuma chave casa cru: ml_item_id/variation_id/codigo sao outros e o ean so bate sem o zero.
  ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 'MLA4X', 4440, '999', 'ZZZ');

do $$
declare
  v_since timestamptz := '2026-04-01T00:00:00-03:00';
  v_a jsonb;
  v_b jsonb;
begin
  v_a := public.platform_org_cost_catalog('90000000-0000-0000-0000-000000000001', v_since);
  v_b := public.platform_org_cost_catalog('90000000-0000-0000-0000-000000000002', v_since);

  -- So variacao vendida no periodo entra: a b...0002 so aparece em venda de janeiro (< p_since).
  -- A b...0004 entra apenas pela normalizacao do GTIN ('0999' da variacao x '999' do ean da venda),
  -- que e a mesma que `normGtin` aplica em `sales-costs.ts`. Comparacao crua a deixaria de fora e o
  -- item venderia sem custo, com markup errado e sem erro nenhum.
  if jsonb_array_length(v_a) <> 2 then
    raise exception 'catalog for org A returned % rows, expected the two sold variations', jsonb_array_length(v_a);
  end if;
  if v_a->0->>'id' <> 'b0000000-0000-0000-0000-000000000001'
     or v_a->1->>'id' <> 'b0000000-0000-0000-0000-000000000004' then
    raise exception 'catalog for org A returned the wrong variations: %', v_a;
  end if;
  if v_a->0->>'ml_item_id' <> 'MLA1' or v_a->0->>'origem' <> 'nacional' then
    raise exception 'catalog did not embed familias.ml_item_id/origem: %', v_a->0;
  end if;
  if (v_a->0->>'custo')::numeric <> 10.50 or (v_a->0->>'peso_gramas')::numeric <> 100 then
    raise exception 'catalog lost custo/peso: %', v_a->0;
  end if;
  if v_a->0->>'ml_variation_id' <> '111' or v_a->0->>'gtin' <> 'EANA1' or v_a->0->>'codigo' <> 'SKUA1' then
    raise exception 'catalog lost resolution keys: %', v_a->0;
  end if;
  if v_a->0->>'atualizado_em' is null then
    raise exception 'catalog lost atualizado_em (tie-break do ADR-0108)';
  end if;

  -- Organizacao B nunca ve variacao de A e vice-versa.
  if jsonb_array_length(v_b) <> 1 or v_b->0->>'id' <> 'b0000000-0000-0000-0000-000000000003' then
    raise exception 'catalog leaked across organizations: %', v_b;
  end if;

  -- Organizacao sem venda no periodo devolve array vazio (nunca null).
  if public.platform_org_cost_catalog('90000000-0000-0000-0000-000000000011', v_since) <> '[]'::jsonb then
    raise exception 'catalog without sales did not return an empty array';
  end if;
end $$;

do $$
declare
  v_ignored jsonb;
begin
  perform set_config('role', 'authenticated', true);
  begin
    v_ignored := public.platform_org_cost_catalog('90000000-0000-0000-0000-000000000001', '2026-04-01T00:00:00-03:00');
    raise exception 'authenticated was allowed to read the cost catalog';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'none', true);
end $$;
