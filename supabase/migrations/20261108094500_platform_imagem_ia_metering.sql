-- Task 16 (kit com variação, ADR-0197): cobrança por imagem IA na fatura, igual ao Sonar.
--
-- 1. platform_commercial_terms.image_unit_cents (padrão 0): preço por imagem na condição comercial da org.
-- 2. platform_image_deliveries: uma entrega por (org_id, request_id), append-only, só service_role. Congela
--    termo, mês (Fortaleza, no momento da geração), preço unitário e o custo real (US$) para a Daludi.
-- 3. Gatilho em kit_variacao_imagens: a linha que vira status = 'gerada' (insert ou update) grava a entrega,
--    na mesma transação, com `on conflict do nothing` (repetir o request_id não cobra de novo). pendente,
--    pendente_upload e recusada nunca cobram; a imagem descartada pelo operador continua 'gerada' e cobra.
--    Org sem o módulo imagem_ia ou sem condição comercial: entrega com units = 0 (registrada, não cobrada).
--    Virada do mês: o gatilho toma o MESMO lock da org que platform_billing_close (antes de ler módulo,
--    competência e termo), calcula a competência com clock_timestamp() depois do lock e, se ela já estiver
--    fechada, grava na competência aberta seguinte. A imagem nunca se perde nem cobra mês fechado.
-- 4. platform_save_terms aceita image_unit_cents (opcional; ausente = 0).
-- 5. platform_billing_preview soma as imagens no total, no crédito e em v_sources (revisão), e mostra a
--    linha "Imagens IA" só com preço > 0 ou uso no mês. Efeito colateral aceito (o mesmo da 20261103004908):
--    a coluna nova muda to_jsonb(v_terms) e v_sources ganha chaves, então a revisão de toda prévia ABERTA muda
--    uma vez (409 e recarrega). Mês fechado não muda: platform_billing_close devolve o snapshot gravado.
--
-- platform_billing_close não é redefinido: o lock da org (passo 3) já serializa entrega e fechamento nas
-- duas ordens (supabase/tests/platform_imagem_ia_concorrencia.sh).
--
-- Sem begin/commit: o db push já envolve a migration numa transação.

alter table public.platform_commercial_terms
  add column image_unit_cents bigint not null default 0
  constraint platform_commercial_terms_image_unit_range check (image_unit_cents between 0 and 9007199254740991);

create table public.platform_image_deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  request_id uuid not null,
  terms_id uuid references public.platform_commercial_terms(id) on delete restrict,
  month date not null check (month = date_trunc('month', month)::date),
  timezone text not null default 'America/Fortaleza' check (timezone = 'America/Fortaleza'),
  unit_cents bigint not null check (unit_cents between 0 and 9007199254740991),
  units smallint not null check (units in (0, 1)),
  total_cents bigint not null check (total_cents between 0 and 9007199254740991),
  -- Custo real do provedor para a Daludi (kit_variacao_imagens.custo_usd), não é o valor cobrado.
  cost_usd numeric(12, 6) not null check (cost_usd >= 0),
  reason text,
  delivered_at timestamptz not null default now(),
  unique (org_id, request_id),
  check (total_cents = unit_cents * units)
);
create index platform_image_deliveries_org_month_idx on public.platform_image_deliveries (org_id, month, delivered_at desc);
alter table public.platform_image_deliveries enable row level security;
revoke all on public.platform_image_deliveries from public, anon, authenticated;
create trigger platform_image_deliveries_append_only before update or delete on public.platform_image_deliveries
  for each row execute function public.platform_append_only();

create function public.platform_image_delivery_on_generated() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_month date;
declare v_terms public.platform_commercial_terms%rowtype;
declare v_modulo boolean;
declare v_units smallint;
begin
  -- Mesmo lock da org que platform_billing_close toma (`for update`); `no key update` conflita com ele e
  -- não trava os FKs (key share) das demais tabelas da org. Depois do lock, cada comando enxerga o que
  -- o fechamento concorrente commitou (read committed).
  select 'imagem_ia' = any(o.modulos_habilitados) into v_modulo
    from public.organizations o where o.id = new.org_id for no key update;
  -- Relógio atual (não o início da transação) e nunca uma competência já fechada: vai para a seguinte aberta.
  v_month := date_trunc('month', clock_timestamp() at time zone 'America/Fortaleza')::date;
  while exists (select 1 from public.platform_billing_statements s where s.org_id = new.org_id and s.month = v_month) loop
    v_month := (v_month + interval '1 month')::date;
  end loop;
  select * into v_terms from public.platform_resolve_terms(new.org_id, v_month);
  v_units := case when coalesce(v_modulo, false) and v_terms.id is not null then 1 else 0 end;
  insert into public.platform_image_deliveries (org_id, request_id, terms_id, month, unit_cents, units, total_cents, cost_usd, reason)
  values (new.org_id, new.request_id, v_terms.id, v_month, coalesce(v_terms.image_unit_cents, 0), v_units,
    coalesce(v_terms.image_unit_cents, 0) * v_units, new.custo_usd,
    case when not coalesce(v_modulo, false) then 'modulo_desligado'
      when v_terms.id is null then 'sem_condicao_comercial' end)
  on conflict (org_id, request_id) do nothing;
  return null;
end;
$$;
revoke all on function public.platform_image_delivery_on_generated() from public, anon, authenticated;
create trigger kit_variacao_imagens_cobranca
  after insert or update of status on public.kit_variacao_imagens
  for each row when (new.status = 'gerada')
  execute function public.platform_image_delivery_on_generated();

-- platform_save_terms: igual à versão de 20261103004908 + image_unit_cents.
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

  -- ADR-0164: a implantacao e obrigacao do contrato, nao da versao. platform_resolve_terms devolve
  -- so a linha mais nova do mes e platform_billing_preview le setup_fee_cents apenas dela -- entao
  -- uma renegociacao gravada com setup zerado no mesmo starts_on apagava a taxa da cobranca em
  -- silencio. Herdar do termo mais recente mantem a taxa viva sem afrouxar a trava acima (que
  -- continua avaliando o input) e sem risco de cobranca dupla (o preview exige
  -- setup_due_month = p_month e nenhum demonstrativo fechado com linha 'setup').
  -- So em renegociacao: `select into` sem linha grava NULL nas variaveis, e no primeiro contrato
  -- isso apagaria a implantacao que o operador acabou de informar.
  if exists (select 1 from public.platform_commercial_terms t where t.org_id = v_org_id) then
    select t.setup_fee_cents, t.setup_due_month into v_setup_fee, v_setup_due
    from public.platform_commercial_terms t
    where t.org_id = v_org_id
    order by t.starts_on desc, t.version desc
    limit 1;
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

-- platform_billing_preview: igual à versão de 20261103004908 + imagens IA (linha, total, crédito e revisão).
create or replace function public.platform_billing_preview(p_actor uuid,p_org uuid,p_month date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_org public.organizations%rowtype;
declare v_terms public.platform_commercial_terms%rowtype;
declare v_start timestamptz;
declare v_end timestamptz;
declare v_sales jsonb := '[]'::jsonb;
declare v_blockers jsonb := '[]'::jsonb;
declare v_adjustments jsonb := '[]'::jsonb;
declare v_gross bigint := 0;
declare v_refund bigint := 0;
declare v_coupon bigint := 0;
declare v_base bigint := 0;
declare v_fee bigint := 0;
declare v_applied_bps integer;
declare v_applied_tier smallint;
declare v_sonar_units integer := 0;
declare v_sonar bigint := 0;
declare v_image_units integer := 0;
declare v_image bigint := 0;
declare v_infra bigint := 0;
declare v_setup bigint := 0;
declare v_late_credit bigint := 0;
declare v_carry bigint := 0;
declare v_credit_pool bigint := 0;
declare v_credit_applied bigint := 0;
declare v_total bigint := 0;
declare v_sources jsonb;
declare v_revision text;
declare v_lines jsonb;
begin
  perform public.platform_assert_admin_actor(p_actor);
  if p_month is null or p_month<>date_trunc('month',p_month)::date then raise exception 'invalid month' using errcode='22023'; end if;
  select * into v_org from public.organizations where id=p_org;
  if not found then raise exception 'organization not found' using errcode='23503'; end if;
  select * into v_terms from public.platform_resolve_terms(p_org,p_month);
  if v_terms.id is null then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','commercial_terms_required','message','Condição comercial ausente'));
  else
    v_infra:=v_terms.monthly_fee_cents;
    if v_terms.setup_due_month=p_month and not exists(
      select 1 from public.platform_billing_statements st
      cross join lateral jsonb_array_elements(st.snapshot->'lines') line
      where st.org_id=p_org and line->>'key'='setup'
    ) then v_setup:=v_terms.setup_fee_cents; end if;
  end if;
  v_start := (p_month::text||' 00:00:00 America/Fortaleza')::timestamptz;
  v_end := v_start+interval '1 month';

  with current_sales as (
    select s.id,s.atualizado_em,s.status,round(s.total_amount*100)::bigint gross_cents,coalesce(s.cupom_vendedor,0) coupon,
      case when s.status='refunded' then round(s.total_amount*100)::bigint
        else least(coalesce(r.refunded_product_cents,public.platform_auto_refund_cents(s.status,s.estorno,s.raw),0),round(s.total_amount*100)::bigint) end refund_cents
    from public.ml_vendas s
    left join public.platform_matching_reconciliation(
      s.org_id, s.id, s.status, round(s.total_amount*100)::bigint
    ) r on true
    where s.org_id=p_org and s.date_closed>=v_start and s.date_closed<v_end
      and s.status in ('paid','partially_refunded','refunded')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'sale_id',s.id,'source_updated_at',s.atualizado_em,'status',s.status,'gross_cents',s.gross_cents,
      'refunded_product_cents',s.refund_cents,
      'recognized_base_cents',greatest(s.gross_cents-s.refund_cents,0)
    ) order by s.id),'[]'::jsonb),coalesce(sum(s.gross_cents),0),coalesce(sum(s.refund_cents),0),
    round(coalesce(sum(s.coupon),0)*100)::bigint
  into v_sales,v_gross,v_refund,v_coupon
  from current_sales s;

  select v_blockers||coalesce(jsonb_agg(jsonb_build_object(
    'code','refund_reconciliation_required','message','Devolução exige conciliação de produto e frete','sale_id',s.id,
    'order_ref',s.order_id::text,'source_updated_at',s.atualizado_em,'gross_cents',round(s.total_amount*100)::bigint,
    'status',s.status,'refunded_product_cents',r.refunded_product_cents
  ) order by s.id),'[]'::jsonb) into v_blockers
  from public.ml_vendas s
  left join public.platform_matching_reconciliation(
    s.org_id, s.id, s.status, round(s.total_amount*100)::bigint
  ) r on true
  where s.org_id=p_org
    and public.platform_sale_needs_refund_reconciliation(s.status, s.tem_devolucao, s.estorno)
    and r.id is null and public.platform_auto_refund_cents(s.status,s.estorno,s.raw) is null
    and (s.date_closed>=v_start and s.date_closed<v_end
      or exists(select 1 from public.platform_billing_sale_facts f where f.org_id=p_org and f.sale_id=s.id));

  v_base:=greatest(v_gross-v_refund,0);
  if v_terms.id is not null then
    v_applied_bps := public.platform_terms_tier_bps(
      v_base, v_terms.revenue_bps_t1, v_terms.revenue_bps_t2, v_terms.revenue_bps_t3, v_terms.revenue_bps_t4
    );
    v_applied_tier := public.platform_terms_tier(v_base);
    v_fee := round(v_base::numeric * v_applied_bps / 10000)::bigint;
  end if;
  select count(*),coalesce(sum(total_cents),0) into v_sonar_units,v_sonar
    from public.platform_sonar_deliveries where org_id=p_org and month=p_month and units=1;
  select count(*),coalesce(sum(total_cents),0) into v_image_units,v_image
    from public.platform_image_deliveries where org_id=p_org and month=p_month and units=1;

  select v_blockers||coalesce(jsonb_agg(jsonb_build_object(
    'code',case when s.id is null then 'billing_source_missing'
      when public.platform_sale_needs_refund_reconciliation(s.status, s.tem_devolucao, s.estorno) and r.id is null and public.platform_auto_refund_cents(s.status,s.estorno,s.raw) is null
        then 'refund_reconciliation_required' else 'billing_source_changed' end,
    'message',case when s.id is null then 'Venda original não está mais disponível'
      when public.platform_sale_needs_refund_reconciliation(s.status, s.tem_devolucao, s.estorno) and r.id is null and public.platform_auto_refund_cents(s.status,s.estorno,s.raw) is null
        then 'Devolução tardia exige conciliação' else 'Venda original foi alterada após o fechamento' end,
    'sale_id',f.sale_id,'order_ref',s.order_id::text,'source_updated_at',s.atualizado_em,
    'gross_cents',case when s.id is null then f.gross_cents else round(s.total_amount*100)::bigint end,
    'status',s.status,'refunded_product_cents',r.refunded_product_cents
  ) order by f.sale_id),'[]'::jsonb) into v_blockers
  from public.platform_billing_sale_facts f
  left join public.ml_vendas s on s.org_id=f.org_id and s.id=f.sale_id
  left join public.platform_matching_reconciliation(
    s.org_id, s.id, s.status, round(s.total_amount*100)::bigint
  ) r on true
  where f.org_id=p_org and (s.id is null
    or (public.platform_sale_needs_refund_reconciliation(s.status, s.tem_devolucao, s.estorno) and r.id is null and public.platform_auto_refund_cents(s.status,s.estorno,s.raw) is null)
    or (not public.platform_sale_needs_refund_reconciliation(s.status, s.tem_devolucao, s.estorno)
      and s.status not in ('refunded','cancelled')
      and (s.status is distinct from f.status or round(s.total_amount*100)::bigint<>f.gross_cents)));

  with origin as (
    select st.id,st.fee_cents,st.revenue_bps,
      round(sum(greatest(f.gross_cents-case
        when s.status in ('refunded','cancelled') then f.gross_cents
        when r.id is not null then least(r.refunded_product_cents,f.gross_cents)
        else least(coalesce(case when s.id is not null then public.platform_auto_refund_cents(s.status,s.estorno,s.raw) end,f.refunded_product_cents),f.gross_cents) end,0))::numeric*st.revenue_bps/10000)::bigint as revised_fee
    from public.platform_billing_statements st
    join public.platform_billing_sale_facts f on f.statement_id=st.id
    left join public.ml_vendas s on s.org_id=f.org_id and s.id=f.sale_id
    left join public.platform_matching_reconciliation(
      s.org_id, s.id, s.status, round(s.total_amount*100)::bigint
    ) r on true
    where st.org_id=p_org and st.month<p_month
    group by st.id,st.fee_cents,st.revenue_bps
  ), credited as (
    select (a->>'origin_statement_id')::uuid origin_id,coalesce(sum((a->>'amount_cents')::bigint),0) amount
    from public.platform_billing_statements st cross join lateral jsonb_array_elements(coalesce(st.snapshot->'adjustments','[]')) a
    where st.org_id=p_org and st.month<p_month group by 1
  ), due as (
    select o.id,greatest(o.fee_cents-o.revised_fee-coalesce(c.amount,0),0)::bigint amount
    from origin o left join credited c on c.origin_id=o.id
  ) select coalesce(jsonb_agg(jsonb_build_object('origin_statement_id',id,'amount_cents',amount) order by id)
      filter(where amount>0),'[]'::jsonb),coalesce(sum(amount) filter(where amount>0),0)
    into v_adjustments,v_late_credit from due;

  select coalesce((snapshot->>'credit_balance_cents')::bigint,0) into v_carry
    from public.platform_billing_statements where org_id=p_org and month<p_month order by month desc limit 1;
  v_carry:=coalesce(v_carry,0);
  v_credit_pool:=v_carry+v_late_credit;
  v_credit_applied:=least(v_credit_pool,v_infra+v_setup+v_fee+v_sonar+v_image);
  v_total:=v_infra+v_setup+v_fee+v_sonar+v_image-v_credit_applied;
  v_lines:=jsonb_build_array(
    jsonb_build_object('key','infrastructure','label','Infraestrutura','quantity',1,'unit_cents',v_infra,'amount_cents',v_infra,'source_type','commercial_terms','source_id',v_terms.id),
    jsonb_build_object('key','revenue','label','Remuneração ('||trim(trailing '.' from trim(trailing '0' from (coalesce(v_applied_bps,0)::numeric/100)::text))||'%)','quantity',null,'unit_cents',null,'amount_cents',v_fee,'source_type','sales','source_id',null)
  );
  if v_terms.id is not null and (v_terms.sonar_unit_cents>0 or v_sonar>0) then
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('key','sonar','label','Consultas Sonar','quantity',v_sonar_units,'unit_cents',v_terms.sonar_unit_cents,'amount_cents',v_sonar,'source_type','sonar_deliveries','source_id',null));
  end if;
  if v_terms.id is not null and (v_terms.image_unit_cents>0 or v_image_units>0) then
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('key','image_ia','label','Imagens IA','quantity',v_image_units,'unit_cents',v_terms.image_unit_cents,'amount_cents',v_image,'source_type','image_deliveries','source_id',null));
  end if;
  if v_setup>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('key','setup','label','Implantação','quantity',1,'unit_cents',v_setup,'amount_cents',v_setup,'source_type','commercial_terms','source_id',v_terms.id)); end if;
  if v_credit_applied>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('key','credits','label','Créditos de competências anteriores','quantity',null,'unit_cents',null,'amount_cents',-v_credit_applied,'source_type','billing_adjustment','source_id',null)); end if;
  v_sources:=jsonb_build_object('terms',to_jsonb(v_terms),'sales',v_sales,'sonar_units',v_sonar_units,
    'sonar_cents',v_sonar,'image_units',v_image_units,'image_cents',v_image,
    'adjustments',v_adjustments,'credit_carry_cents',v_carry,'blockers',v_blockers);
  v_revision:=encode(pg_catalog.sha256(convert_to(v_sources::text,'UTF8')),'hex');
  return jsonb_build_object(
    'org_id',p_org,'org_name',v_org.nome,'month',to_char(p_month,'YYYY-MM'),'timezone','America/Fortaleza',
    'terms',case when v_terms.id is null then null else to_jsonb(v_terms) end,'gross_cents',v_gross,'refund_cents',v_refund,
    'base_cents',v_base,'fee_cents',v_fee,'applied_bps',v_applied_bps,'applied_tier',v_applied_tier,
    'sonar_units',v_sonar_units,'sonar_cents',v_sonar,'image_units',v_image_units,'image_cents',v_image,'lines',v_lines,
    'total_cents',v_total,'credit_cents',v_credit_applied,'credit_balance_cents',v_credit_pool-v_credit_applied,
    'adjustments',v_adjustments,'sources',v_sales,'revision',v_revision,'blockers',v_blockers,
    -- ADR-0193 D-4/D-9: informativos, fora de v_sources (não mexem na revisão, no total nem na base).
    'seller_coupon_cents',v_coupon,'due_day',v_terms.due_day
  );
end;
$$;

revoke all on function public.platform_billing_preview(uuid,uuid,date) from public,anon,authenticated;
grant execute on function public.platform_billing_preview(uuid,uuid,date) to service_role;
