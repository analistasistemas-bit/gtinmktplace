-- ADR-0165: percentual de gestao por faixa regressiva de faturamento, por organizacao.
--
-- platform_commercial_terms grava hoje um unico revenue_bps por contrato. A pagina publica anuncia
-- percentual regressivo por faixa de faturamento mensal (ate 100K / 100-300K / 300-500K / +500K)
-- nas duas modalidades, e nada trava que modalidade 1 nao deveria cobrar Sonar do cliente nem que
-- modalidade 2 nao deveria ter infra separada. Medido em 2026-09-18: Daludi Shop e DSA sao
-- modalidade 1 com sonar_unit_cents = 120 (violam a regra que este ADR passa a travar).
--
-- Troca revenue_bps por 4 colunas fixas (revenue_bps_t1..t4, uma por faixa; os cortes sao fixos e
-- vivem em platform_terms_tier, migration seguinte). O backfill das 3 organizacoes existentes copia
-- o revenue_bps atual para as 4 faixas (comportamento identico ao de hoje ate a proxima
-- renegociacao real) e corrige o Sonar de Daludi Shop/DSA (zera).
--
-- O trigger platform_commercial_terms_no_mutation bloqueia qualquer UPDATE incondicionalmente. E
-- desabilitado so durante os dois UPDATEs de backfill, dentro desta transacao, e reabilitado antes
-- do commit -- com asserção LOUD (raise exception) se o backfill ficar incompleto ou se o numero de
-- organizacoes corrigidas nao bater com o medido, para nunca silenciar uma divergencia entre o dado
-- real e o que esta migration espera.

begin;

alter table public.platform_commercial_terms
  add column revenue_bps_t1 integer,
  add column revenue_bps_t2 integer,
  add column revenue_bps_t3 integer,
  add column revenue_bps_t4 integer;

alter table public.platform_commercial_terms disable trigger platform_commercial_terms_no_mutation;

update public.platform_commercial_terms
  set revenue_bps_t1 = revenue_bps, revenue_bps_t2 = revenue_bps,
      revenue_bps_t3 = revenue_bps, revenue_bps_t4 = revenue_bps;

do $$
declare
  v_corrigidas integer;
begin
  with corrigidos as (
    update public.platform_commercial_terms
      set sonar_unit_cents = 0
      where modality = 1 and sonar_unit_cents <> 0
      returning id, org_id
  )
  insert into public.platform_audit_events (org_id, actor_id, category, action, result, target, reason, details)
  select org_id, null, 'admin', 'platform_terms_sonar_corrected', 'success', id::text,
    'ADR-0165: modalidade 1 nao cobra Sonar do cliente', jsonb_build_object('sonar_unit_cents_after', 0)
  from corrigidos;

  get diagnostics v_corrigidas = row_count;
  if v_corrigidas <> 2 then
    raise exception 'esperava corrigir 2 organizacoes modalidade 1 com Sonar cobrado, corrigiu %', v_corrigidas
      using errcode = '23514';
  end if;
end $$;

alter table public.platform_commercial_terms enable trigger platform_commercial_terms_no_mutation;

do $$
begin
  if exists (
    select 1 from public.platform_commercial_terms
    where revenue_bps_t1 is null or revenue_bps_t2 is null
       or revenue_bps_t3 is null or revenue_bps_t4 is null
  ) then
    raise exception 'backfill de faixas incompleto' using errcode = '23514';
  end if;
end $$;

alter table public.platform_commercial_terms
  alter column revenue_bps_t1 set not null,
  alter column revenue_bps_t2 set not null,
  alter column revenue_bps_t3 set not null,
  alter column revenue_bps_t4 set not null,
  add constraint platform_commercial_terms_tiers_range check (
    revenue_bps_t1 between 0 and 10000 and revenue_bps_t2 between 0 and 10000
    and revenue_bps_t3 between 0 and 10000 and revenue_bps_t4 between 0 and 10000
  ),
  add constraint platform_commercial_terms_modality_shape check (
    (modality <> 1 or sonar_unit_cents = 0)
    and (modality <> 2 or monthly_fee_cents = 0)
  ),
  drop column revenue_bps;

create or replace function public.platform_save_terms(p_actor uuid, p_input jsonb)
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
  v_revenue_bps_t1 integer;
  v_revenue_bps_t2 integer;
  v_revenue_bps_t3 integer;
  v_revenue_bps_t4 integer;
  v_sonar_unit bigint;
  v_setup_fee bigint;
  v_setup_due date;
  v_reason text;
  v_modality_text text;
  v_monthly_fee_text text;
  v_revenue_bps_t1_text text;
  v_revenue_bps_t2_text text;
  v_revenue_bps_t3_text text;
  v_revenue_bps_t4_text text;
  v_sonar_unit_text text;
  v_setup_fee_text text;
  v_version integer;
  v_term public.platform_commercial_terms%rowtype;
  v_current_month date;
  v_next_month date;
  v_min_starts date;
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
  v_revenue_bps_t1_text := p_input->>'revenue_bps_t1';
  v_revenue_bps_t2_text := p_input->>'revenue_bps_t2';
  v_revenue_bps_t3_text := p_input->>'revenue_bps_t3';
  v_revenue_bps_t4_text := p_input->>'revenue_bps_t4';
  v_sonar_unit_text := p_input->>'sonar_unit_cents';
  v_setup_fee_text := p_input->>'setup_fee_cents';

  if v_org_id is null or v_starts_on is null
    or jsonb_typeof(p_input->'modality') is distinct from 'number'
    or v_modality_text !~ '^(0|[1-9][0-9]*)$'
    or v_modality_text not in ('1', '2')
    or jsonb_typeof(p_input->'revenue_bps_t1') is distinct from 'number'
    or v_revenue_bps_t1_text !~ '^(0|[1-9][0-9]*)$'
    or length(v_revenue_bps_t1_text) > 5
    or jsonb_typeof(p_input->'revenue_bps_t2') is distinct from 'number'
    or v_revenue_bps_t2_text !~ '^(0|[1-9][0-9]*)$'
    or length(v_revenue_bps_t2_text) > 5
    or jsonb_typeof(p_input->'revenue_bps_t3') is distinct from 'number'
    or v_revenue_bps_t3_text !~ '^(0|[1-9][0-9]*)$'
    or length(v_revenue_bps_t3_text) > 5
    or jsonb_typeof(p_input->'revenue_bps_t4') is distinct from 'number'
    or v_revenue_bps_t4_text !~ '^(0|[1-9][0-9]*)$'
    or length(v_revenue_bps_t4_text) > 5
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
  v_revenue_bps_t1 := v_revenue_bps_t1_text::integer;
  v_revenue_bps_t2 := v_revenue_bps_t2_text::integer;
  v_revenue_bps_t3 := v_revenue_bps_t3_text::integer;
  v_revenue_bps_t4 := v_revenue_bps_t4_text::integer;
  v_sonar_unit := v_sonar_unit_text::bigint;
  v_setup_fee := v_setup_fee_text::bigint;
  v_reason := btrim(p_input->>'reason');

  if v_starts_on <> date_trunc('month', v_starts_on)::date
    or v_revenue_bps_t1 not between 0 and 10000
    or v_revenue_bps_t2 not between 0 and 10000
    or v_revenue_bps_t3 not between 0 and 10000
    or v_revenue_bps_t4 not between 0 and 10000
    or v_reason is null or v_reason = '' then
    raise exception 'Invalid commercial terms input' using errcode = '22023';
  end if;

  if v_modality = 1 and v_sonar_unit <> 0 then
    raise exception 'Modalidade 1 não cobra Sonar do cliente: informe 0,00' using errcode = '22023';
  end if;
  if v_modality = 2 and v_monthly_fee <> 0 then
    raise exception 'Modalidade 2 não tem infraestrutura separada: informe 0,00' using errcode = '22023';
  end if;

  if v_setup_fee = 0 then
    if p_input->>'setup_due_month' is not null then
      raise exception 'setup_due_month is invalid without setup fee' using errcode = '22023';
    end if;
    v_setup_due := null;
  else
    if jsonb_typeof(p_input->'setup_due_month') is distinct from 'string'
      or (p_input->>'setup_due_month') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
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

  v_current_month := date_trunc('month', now() at time zone 'America/Fortaleza')::date;
  v_next_month := (v_current_month + interval '1 month')::date;
  v_min_starts := case
    when exists (select 1 from public.platform_commercial_terms t where t.org_id = v_org_id)
    then v_next_month
    else v_current_month
  end;

  if v_starts_on < v_min_starts then
    raise exception 'Invalid commercial terms input' using errcode = '22023';
  end if;

  select coalesce(max(t.version), 0) + 1 into v_version
  from public.platform_commercial_terms t
  where t.org_id = v_org_id and t.starts_on = v_starts_on;

  if v_setup_fee > 0 and exists (
    select 1 from public.platform_commercial_terms t where t.org_id = v_org_id
  ) then
    raise exception 'Setup fee cannot be reapplied on renegotiation' using errcode = '22023';
  end if;

  if exists (select 1 from public.platform_commercial_terms t where t.org_id = v_org_id) then
    select t.setup_fee_cents, t.setup_due_month into v_setup_fee, v_setup_due
    from public.platform_commercial_terms t
    where t.org_id = v_org_id
    order by t.starts_on desc, t.version desc
    limit 1;
    v_setup_fee := coalesce(v_setup_fee, 0);

    if v_setup_due < v_starts_on then
      v_setup_fee := 0;
      v_setup_due := null;
    end if;
  end if;

  insert into public.platform_commercial_terms (
    org_id, starts_on, modality, monthly_fee_cents,
    revenue_bps_t1, revenue_bps_t2, revenue_bps_t3, revenue_bps_t4,
    sonar_unit_cents, setup_fee_cents, setup_due_month, reason, created_by, version
  ) values (
    v_org_id, v_starts_on, v_modality, v_monthly_fee,
    v_revenue_bps_t1, v_revenue_bps_t2, v_revenue_bps_t3, v_revenue_bps_t4,
    v_sonar_unit, v_setup_fee, v_setup_due, v_reason, p_actor, v_version
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

revoke all on function public.platform_save_terms(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.platform_save_terms(uuid, jsonb) to service_role;

commit;
