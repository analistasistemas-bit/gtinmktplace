-- Emenda 2026-11-08 ao ADR-0164 (platform_save_terms):
-- 1. Herança da implantação a partir de platform_resolve_terms(org, starts_on) — o termo que vigoraria no mês
--    gravado —, não do termo de maior starts_on (que podia ser futuro, já zerado, e apagar a taxa).
-- 2. Mês mínimo calculado com clock_timestamp() depois do lock da org, não now().
-- O resto é igual à versão de 20261108094500. Sem backfill (ver a emenda).
--
-- Sem begin/commit: o db push já envolve a migration numa transação.

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
  v_image_unit bigint;
  v_setup_fee bigint;
  v_setup_due date;
  v_due_day smallint;
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

  -- Task 16 (kit com variação): preço por imagem IA, opcional no input (ausente = 0, como due_day).
  if p_input ? 'image_unit_cents' then
    if jsonb_typeof(p_input->'image_unit_cents') is distinct from 'number'
      or (p_input->>'image_unit_cents') !~ '^(0|[1-9][0-9]*)$'
      or length(p_input->>'image_unit_cents') > 16
      or (length(p_input->>'image_unit_cents') = 16 and (p_input->>'image_unit_cents') > '9007199254740991') then
      raise exception 'Invalid commercial terms input' using errcode = '22023';
    end if;
    v_image_unit := (p_input->>'image_unit_cents')::bigint;
  else
    v_image_unit := 0;
  end if;

  -- ADR-0193 D-9: vencimento opcional no input (ausente = dia 05, o padrão da coluna).
  if p_input ? 'due_day' then
    if jsonb_typeof(p_input->'due_day') is distinct from 'number'
      or (p_input->>'due_day') !~ '^([1-9]|1[0-9]|2[0-8])$' then
      raise exception 'Invalid commercial terms input' using errcode = '22023';
    end if;
    v_due_day := (p_input->>'due_day')::smallint;
  else
    v_due_day := 5;
  end if;

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

  -- Emenda 2026-11-08 ao ADR-0164: relógio atual depois do lock, não o início da transação. Uma gravação
  -- liberada pelo lock já no mês seguinte não pode renegociar a competência que acabou de começar.
  v_current_month := date_trunc('month', clock_timestamp() at time zone 'America/Fortaleza')::date;
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

  -- ADR-0164: a implantacao e obrigacao do contrato, nao da versao. platform_resolve_terms devolve
  -- so a linha mais nova do mes e platform_billing_preview le setup_fee_cents apenas dela -- entao
  -- uma renegociacao gravada com setup zerado no mesmo starts_on apagava a taxa da cobranca em
  -- silencio. Herdar do termo mais recente mantem a taxa viva sem afrouxar a trava acima (que
  -- continua avaliando o input) e sem risco de cobranca dupla (o preview exige
  -- setup_due_month = p_month e nenhum demonstrativo fechado com linha 'setup').
  -- So em renegociacao: `select into` sem linha grava NULL nas variaveis, e no primeiro contrato
  -- isso apagaria a implantacao que o operador acabou de informar.
  if exists (select 1 from public.platform_commercial_terms t where t.org_id = v_org_id) then
    -- Emenda 2026-11-08: herda do termo que vigoraria no mês gravado (a linha que esta versão substitui na
    -- resolução), não do de maior starts_on. Um termo futuro já zerado (vencimento anterior a ele) apagava
    -- a implantação de um mês anterior renegociado depois. Sem termo resolvido: nada a herdar.
    select t.setup_fee_cents, t.setup_due_month into v_setup_fee, v_setup_due
    from public.platform_resolve_terms(v_org_id, v_starts_on) t;
    v_setup_fee := coalesce(v_setup_fee, 0);

    -- A versao nova comeca depois do mes da implantacao: herdar violaria
    -- platform_commercial_terms_setup_once (setup_due_month >= starts_on) e recusaria toda
    -- renegociacao a partir dali. Nao perde a taxa: platform_resolve_terms filtra
    -- starts_on <= p_on, entao o mes da implantacao continua resolvendo para o termo anterior.
    if v_setup_due < v_starts_on then
      v_setup_fee := 0;
      v_setup_due := null;
    end if;
  end if;

  insert into public.platform_commercial_terms (
    org_id, starts_on, modality, monthly_fee_cents,
    revenue_bps_t1, revenue_bps_t2, revenue_bps_t3, revenue_bps_t4,
    sonar_unit_cents, setup_fee_cents, setup_due_month, reason, created_by, version, due_day, image_unit_cents
  ) values (
    v_org_id, v_starts_on, v_modality, v_monthly_fee,
    v_revenue_bps_t1, v_revenue_bps_t2, v_revenue_bps_t3, v_revenue_bps_t4,
    v_sonar_unit, v_setup_fee, v_setup_due, v_reason, p_actor, v_version, v_due_day, v_image_unit
  ) returning * into v_term;

  insert into public.platform_audit_events (
    org_id, actor_id, category, action, result, target, reason, details
  ) values (
    v_org_id, p_actor, 'admin', 'platform_terms_saved', 'success', v_term.id::text, v_reason,
    jsonb_build_object('starts_on', v_starts_on, 'version', v_version, 'due_day', v_due_day,
      'image_unit_cents', v_image_unit)
  );

  return to_jsonb(v_term);
end;
$$;

revoke all on function public.platform_save_terms(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.platform_save_terms(uuid, jsonb) to service_role;
