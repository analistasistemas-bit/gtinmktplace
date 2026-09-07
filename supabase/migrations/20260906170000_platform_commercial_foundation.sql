create extension if not exists pgcrypto;

create function public.platform_jwt_role()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )
$$;

create table public.platform_commercial_terms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  starts_on date not null check (starts_on = date_trunc('month', starts_on)::date),
  modality smallint not null check (modality in (1, 2)),
  monthly_fee_cents bigint not null check (monthly_fee_cents between 0 and 9007199254740991),
  revenue_bps integer not null check (revenue_bps between 0 and 10000),
  sonar_unit_cents bigint not null check (sonar_unit_cents between 0 and 9007199254740991),
  setup_fee_cents bigint not null check (setup_fee_cents between 0 and 9007199254740991),
  setup_due_month date,
  reason text not null check (length(btrim(reason)) > 0),
  timezone text not null default 'America/Fortaleza' check (timezone = 'America/Fortaleza'),
  created_at timestamptz not null default now(),
  created_by uuid not null,
  version integer not null check (version > 0),
  constraint platform_commercial_terms_setup_once check (
    (setup_fee_cents = 0 and setup_due_month is null)
    or (setup_fee_cents > 0 and setup_due_month is not null and setup_due_month = date_trunc('month', setup_due_month)::date and setup_due_month >= starts_on)
  ),
  unique (org_id, starts_on, version)
);

create table public.platform_audit_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid,
  occurred_at timestamptz not null default now(),
  category text not null check (category in ('admin', 'billing', 'pulse', 'support')),
  action text not null,
  result text not null,
  target text,
  reason text,
  details jsonb not null default '{}'::jsonb
);

alter table public.platform_commercial_terms enable row level security;
alter table public.platform_audit_events enable row level security;
revoke all on public.platform_commercial_terms from anon, authenticated;
revoke all on public.platform_audit_events from anon, authenticated;

create function public.platform_commercial_terms_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Commercial terms are append-only' using errcode = '23514';
end;
$$;

create trigger platform_commercial_terms_no_mutation
before update or delete on public.platform_commercial_terms
for each row execute function public.platform_commercial_terms_immutable();

create function public.platform_resolve_terms(p_org_id uuid, p_on date)
returns public.platform_commercial_terms
language sql
stable
security definer
set search_path = ''
as $$
  select t.*
  from public.platform_commercial_terms t
  where t.org_id = p_org_id and t.starts_on <= date_trunc('month', p_on)::date
  order by t.starts_on desc, t.version desc
  limit 1
$$;

create function public.platform_save_terms(p_actor uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_starts_on date;
  v_modality smallint;
  v_monthly_fee bigint;
  v_revenue_bps integer;
  v_sonar_unit bigint;
  v_setup_fee bigint;
  v_setup_due date;
  v_reason text;
  v_modality_text text;
  v_monthly_fee_text text;
  v_revenue_bps_text text;
  v_sonar_unit_text text;
  v_setup_fee_text text;
  v_version integer;
  v_term public.platform_commercial_terms%rowtype;
  v_next_month date := (date_trunc('month', now() at time zone 'America/Fortaleza') + interval '1 month')::date;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor and p.is_super_admin and p.is_active
  ) then
    raise exception 'Active super-admin actor required' using errcode = '42501';
  end if;

  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'Commercial terms input is required' using errcode = '22023';
  end if;

  begin
    v_org_id := (p_input->>'org_id')::uuid;
    v_starts_on := (p_input->>'starts_on')::date;
  exception when others then
    raise exception 'Invalid commercial terms input' using errcode = '22023';
  end;

  v_modality_text := p_input->>'modality';
  v_monthly_fee_text := p_input->>'monthly_fee_cents';
  v_revenue_bps_text := p_input->>'revenue_bps';
  v_sonar_unit_text := p_input->>'sonar_unit_cents';
  v_setup_fee_text := p_input->>'setup_fee_cents';

  if v_org_id is null or v_starts_on is null
    or jsonb_typeof(p_input->'modality') is distinct from 'number'
    or v_modality_text !~ '^(0|[1-9][0-9]*)$'
    or v_modality_text not in ('1', '2')
    or jsonb_typeof(p_input->'revenue_bps') is distinct from 'number'
    or v_revenue_bps_text !~ '^(0|[1-9][0-9]*)$'
    or length(v_revenue_bps_text) > 5
    or jsonb_typeof(p_input->'monthly_fee_cents') is distinct from 'number'
    or v_monthly_fee_text !~ '^(0|[1-9][0-9]*)$'
    or length(v_monthly_fee_text) > 16
    or (length(v_monthly_fee_text) = 16 and v_monthly_fee_text > '9007199254740991')
    or jsonb_typeof(p_input->'sonar_unit_cents') is distinct from 'number'
    or v_sonar_unit_text !~ '^(0|[1-9][0-9]*)$'
    or length(v_sonar_unit_text) > 16
    or (length(v_sonar_unit_text) = 16 and v_sonar_unit_text > '9007199254740991')
    or jsonb_typeof(p_input->'setup_fee_cents') is distinct from 'number'
    or v_setup_fee_text !~ '^(0|[1-9][0-9]*)$'
    or length(v_setup_fee_text) > 16
    or (length(v_setup_fee_text) = 16 and v_setup_fee_text > '9007199254740991')
    or jsonb_typeof(p_input->'reason') is distinct from 'string' then
    raise exception 'Invalid commercial terms input' using errcode = '22023';
  end if;

  v_modality := v_modality_text::smallint;
  v_monthly_fee := v_monthly_fee_text::bigint;
  v_revenue_bps := v_revenue_bps_text::integer;
  v_sonar_unit := v_sonar_unit_text::bigint;
  v_setup_fee := v_setup_fee_text::bigint;
  v_reason := btrim(p_input->>'reason');

  if v_starts_on <> date_trunc('month', v_starts_on)::date or v_starts_on < v_next_month
    or v_revenue_bps not between 0 and 10000
    or v_reason is null or v_reason = '' then
    raise exception 'Invalid commercial terms input' using errcode = '22023';
  end if;

  if v_setup_fee = 0 then
    if p_input->>'setup_due_month' is not null then
      raise exception 'setup_due_month is invalid without setup fee' using errcode = '22023';
    end if;
    v_setup_due := null;
  else
    if jsonb_typeof(p_input->'setup_due_month') is distinct from 'string'
      or (p_input->>'setup_due_month') !~ '^\\d{4}-(0[1-9]|1[0-2])$' then
      raise exception 'setup_due_month must be YYYY-MM' using errcode = '22023';
    end if;
    v_setup_due := ((p_input->>'setup_due_month') || '-01')::date;
    if v_setup_due < v_starts_on then
      raise exception 'setup_due_month cannot precede starts_on' using errcode = '22023';
    end if;
  end if;

  perform 1 from public.organizations o where o.id = v_org_id for update;
  if not found then
    raise exception 'Organization not found' using errcode = '23503';
  end if;

  select coalesce(max(t.version), 0) + 1 into v_version
  from public.platform_commercial_terms t
  where t.org_id = v_org_id and t.starts_on = v_starts_on;

  if v_setup_fee > 0 and exists (
    select 1 from public.platform_commercial_terms t where t.org_id = v_org_id
  ) then
    raise exception 'Setup fee cannot be reapplied on renegotiation' using errcode = '22023';
  end if;

  insert into public.platform_commercial_terms (
    org_id, starts_on, modality, monthly_fee_cents, revenue_bps, sonar_unit_cents,
    setup_fee_cents, setup_due_month, reason, created_by, version
  ) values (
    v_org_id, v_starts_on, v_modality, v_monthly_fee, v_revenue_bps, v_sonar_unit,
    v_setup_fee, v_setup_due, v_reason, p_actor, v_version
  ) returning * into v_term;

  insert into public.platform_audit_events (
    org_id, actor_id, category, action, result, target, reason, details
  ) values (
    v_org_id, p_actor, 'admin', 'platform_terms_saved', 'success', v_term.id::text, v_reason,
    jsonb_build_object('starts_on', v_starts_on, 'version', v_version)
  );

  return to_jsonb(v_term);
end;
$$;

revoke all on function public.platform_resolve_terms(uuid, date) from public, anon, authenticated;
revoke all on function public.platform_save_terms(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.platform_resolve_terms(uuid, date) to service_role;
grant execute on function public.platform_save_terms(uuid, jsonb) to service_role;
