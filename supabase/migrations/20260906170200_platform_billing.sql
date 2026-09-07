create table public.platform_billing_statements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  month date not null check (month=date_trunc('month',month)::date),
  terms_id uuid not null references public.platform_commercial_terms(id) on delete restrict,
  revenue_bps integer not null check (revenue_bps between 0 and 10000),
  gross_cents bigint not null check (gross_cents>=0),
  refund_cents bigint not null check (refund_cents>=0),
  base_cents bigint not null check (base_cents>=0),
  fee_cents bigint not null check (fee_cents>=0),
  sonar_cents bigint not null check (sonar_cents>=0),
  credit_cents bigint not null check (credit_cents>=0),
  total_cents bigint not null check (total_cents>=0),
  revision text not null,
  snapshot jsonb not null,
  closed_at timestamptz not null default now(),
  closed_by uuid not null references public.profiles(id) on delete restrict,
  unique(org_id,month)
);

create table public.platform_billing_sale_facts (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.platform_billing_statements(id) on delete restrict,
  org_id uuid not null references public.organizations(id) on delete restrict,
  sale_id uuid not null,
  source_updated_at timestamptz not null,
  gross_cents bigint not null check (gross_cents>=0),
  refunded_product_cents bigint not null check (refunded_product_cents between 0 and gross_cents),
  recognized_base_cents bigint not null check (recognized_base_cents>=0),
  unique(statement_id,sale_id)
);

create table public.platform_revenue_reconciliations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  sale_id uuid not null,
  source_updated_at timestamptz not null,
  refunded_product_cents bigint not null check (refunded_product_cents>=0),
  reason text not null check (length(btrim(reason))>0),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  unique(org_id,sale_id,source_updated_at)
);

create index platform_billing_statements_org_month_idx on public.platform_billing_statements(org_id,month desc);
create index platform_billing_sale_facts_org_sale_idx on public.platform_billing_sale_facts(org_id,sale_id);
create index platform_reconciliations_org_sale_idx on public.platform_revenue_reconciliations(org_id,sale_id,created_at desc);

alter table public.platform_billing_statements enable row level security;
alter table public.platform_billing_sale_facts enable row level security;
alter table public.platform_revenue_reconciliations enable row level security;
revoke all on public.platform_billing_statements,public.platform_billing_sale_facts,
  public.platform_revenue_reconciliations from anon,authenticated;

create function public.platform_billing_append_only() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'billing history is immutable' using errcode='23514'; end;
$$;
create trigger platform_billing_statements_immutable before update or delete on public.platform_billing_statements
  for each row execute function public.platform_billing_append_only();
create trigger platform_billing_sale_facts_immutable before update or delete on public.platform_billing_sale_facts
  for each row execute function public.platform_billing_append_only();
create trigger platform_reconciliations_immutable before update or delete on public.platform_revenue_reconciliations
  for each row execute function public.platform_billing_append_only();

create function public.platform_assert_admin_actor(p_actor uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role'
    or not exists(select 1 from public.profiles p where p.id=p_actor and p.is_active and p.is_super_admin) then
    raise exception 'active platform admin required' using errcode='42501';
  end if;
end;
$$;

create function public.platform_billing_preview(p_actor uuid,p_org uuid,p_month date) returns jsonb
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
declare v_base bigint := 0;
declare v_fee bigint := 0;
declare v_sonar_units integer := 0;
declare v_sonar bigint := 0;
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
  if not found then
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
    select s.id,s.atualizado_em,round(s.total_amount*100)::bigint gross_cents,
      case when s.status='refunded' then round(s.total_amount*100)::bigint
        else least(coalesce(r.refunded_product_cents,0),round(s.total_amount*100)::bigint) end refund_cents
    from public.ml_vendas s
    left join public.platform_revenue_reconciliations r on r.org_id=s.org_id and r.sale_id=s.id and r.source_updated_at=s.atualizado_em
    where s.org_id=p_org and s.date_closed>=v_start and s.date_closed<v_end
      and s.status in ('paid','partially_refunded','refunded')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'sale_id',s.id,'source_updated_at',s.atualizado_em,'gross_cents',s.gross_cents,
      'refunded_product_cents',s.refund_cents,
      'recognized_base_cents',greatest(s.gross_cents-s.refund_cents,0)
    ) order by s.id),'[]'::jsonb),coalesce(sum(s.gross_cents),0),coalesce(sum(s.refund_cents),0)
  into v_sales,v_gross,v_refund
  from current_sales s;

  select v_blockers||coalesce(jsonb_agg(jsonb_build_object(
    'code','refund_reconciliation_required','message','Devolução exige conciliação de produto e frete','sale_id',s.id,
    'order_ref',s.order_id::text,'source_updated_at',s.atualizado_em,'gross_cents',round(s.total_amount*100)::bigint,
    'status',s.status,'refunded_product_cents',r.refunded_product_cents
  ) order by s.id),'[]'::jsonb) into v_blockers
  from public.ml_vendas s
  left join public.platform_revenue_reconciliations r on r.org_id=s.org_id and r.sale_id=s.id and r.source_updated_at=s.atualizado_em
  where s.org_id=p_org and s.status='partially_refunded' and r.id is null
    and (s.date_closed>=v_start and s.date_closed<v_end
      or exists(select 1 from public.platform_billing_sale_facts f where f.org_id=p_org and f.sale_id=s.id));

  v_base:=greatest(v_gross-v_refund,0);
  if v_terms.id is not null then v_fee:=round(v_base::numeric*v_terms.revenue_bps/10000)::bigint; end if;
  select count(*),coalesce(sum(total_cents),0) into v_sonar_units,v_sonar
    from public.platform_sonar_deliveries where org_id=p_org and month=p_month and units=1;

  select v_blockers||coalesce(jsonb_agg(jsonb_build_object(
    'code',case when s.id is null then 'billing_source_missing'
      when s.status='partially_refunded' then 'refund_reconciliation_required' else 'billing_source_changed' end,
    'message',case when s.id is null then 'Venda original não está mais disponível'
      when s.status='partially_refunded' then 'Devolução tardia exige conciliação' else 'Venda original foi alterada após o fechamento' end,
    'sale_id',f.sale_id,'order_ref',s.order_id::text,'source_updated_at',s.atualizado_em,
    'gross_cents',case when s.id is null then f.gross_cents else round(s.total_amount*100)::bigint end,
    'status',s.status,'refunded_product_cents',r.refunded_product_cents
  ) order by f.sale_id),'[]'::jsonb) into v_blockers
  from public.platform_billing_sale_facts f
  left join public.ml_vendas s on s.org_id=f.org_id and s.id=f.sale_id
  left join public.platform_revenue_reconciliations r on r.org_id=s.org_id and r.sale_id=s.id and r.source_updated_at=s.atualizado_em
  where f.org_id=p_org and (s.id is null
    or (s.status='partially_refunded' and r.id is null)
    or (s.status not in ('partially_refunded','refunded','cancelled')
      and (s.atualizado_em<>f.source_updated_at or round(s.total_amount*100)::bigint<>f.gross_cents)));

  with origin as (
    select st.id,st.fee_cents,st.revenue_bps,
      round(sum(greatest(f.gross_cents-case
        when s.status in ('refunded','cancelled') then f.gross_cents
        when r.id is not null then least(r.refunded_product_cents,f.gross_cents)
        else f.refunded_product_cents end,0))::numeric*st.revenue_bps/10000)::bigint as revised_fee
    from public.platform_billing_statements st
    join public.platform_billing_sale_facts f on f.statement_id=st.id
    left join public.ml_vendas s on s.org_id=f.org_id and s.id=f.sale_id
    left join public.platform_revenue_reconciliations r on r.org_id=s.org_id and r.sale_id=s.id and r.source_updated_at=s.atualizado_em
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
  v_credit_applied:=least(v_credit_pool,v_infra+v_setup+v_fee+v_sonar);
  v_total:=v_infra+v_setup+v_fee+v_sonar-v_credit_applied;
  v_lines:=jsonb_build_array(
    jsonb_build_object('key','infrastructure','label','Infraestrutura','quantity',1,'unit_cents',v_infra,'amount_cents',v_infra,'source_type','commercial_terms','source_id',v_terms.id),
    jsonb_build_object('key','revenue','label','Remuneração ('||trim(trailing '.' from trim(trailing '0' from (coalesce(v_terms.revenue_bps,0)::numeric/100)::text))||'%)','quantity',null,'unit_cents',null,'amount_cents',v_fee,'source_type','sales','source_id',null),
    jsonb_build_object('key','sonar','label','Consultas Sonar','quantity',v_sonar_units,'unit_cents',v_terms.sonar_unit_cents,'amount_cents',v_sonar,'source_type','sonar_deliveries','source_id',null)
  );
  if v_setup>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('key','setup','label','Implantação','quantity',1,'unit_cents',v_setup,'amount_cents',v_setup,'source_type','commercial_terms','source_id',v_terms.id)); end if;
  if v_credit_applied>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('key','credits','label','Créditos de competências anteriores','quantity',null,'unit_cents',null,'amount_cents',-v_credit_applied,'source_type','billing_adjustment','source_id',null)); end if;
  v_sources:=jsonb_build_object('terms',to_jsonb(v_terms),'sales',v_sales,'sonar_units',v_sonar_units,
    'sonar_cents',v_sonar,'adjustments',v_adjustments,'credit_carry_cents',v_carry,'blockers',v_blockers);
  v_revision:=encode(pg_catalog.sha256(convert_to(v_sources::text,'UTF8')),'hex');
  return jsonb_build_object(
    'org_id',p_org,'org_name',v_org.nome,'month',to_char(p_month,'YYYY-MM'),'timezone','America/Fortaleza',
    'terms',case when v_terms.id is null then null else to_jsonb(v_terms) end,'gross_cents',v_gross,'refund_cents',v_refund,
    'base_cents',v_base,'fee_cents',v_fee,'sonar_units',v_sonar_units,'sonar_cents',v_sonar,'lines',v_lines,
    'total_cents',v_total,'credit_cents',v_credit_applied,'credit_balance_cents',v_credit_pool-v_credit_applied,
    'adjustments',v_adjustments,'sources',v_sales,'revision',v_revision,'blockers',v_blockers
  );
end;
$$;

create function public.platform_billing_close(p_actor uuid,p_org uuid,p_month date,p_expected_revision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_existing public.platform_billing_statements%rowtype;
declare v_preview jsonb;
declare v_statement public.platform_billing_statements%rowtype;
declare v_first date;
begin
  perform public.platform_assert_admin_actor(p_actor);
  perform 1 from public.organizations where id=p_org for update;
  if not found then raise exception 'organization not found' using errcode='23503'; end if;
  select * into v_existing from public.platform_billing_statements where org_id=p_org and month=p_month;
  if found then return v_existing.snapshot||jsonb_build_object('id',v_existing.id,'closed_at',v_existing.closed_at,'closed_by',v_existing.closed_by); end if;
  if p_month>=date_trunc('month',now() at time zone 'America/Fortaleza')::date then
    raise exception 'only completed months can be closed' using errcode='22023';
  end if;
  -- SHARE locks keep sales, reconciliations and deliveries fixed between preview and insert.
  -- The closing transaction is short, but writers for other tenants may wait briefly.
  lock table public.ml_vendas in share mode;
  lock table public.platform_revenue_reconciliations in share mode;
  lock table public.platform_sonar_deliveries in share mode;
  v_preview:=public.platform_billing_preview(p_actor,p_org,p_month);
  if v_preview->>'revision' is distinct from p_expected_revision then raise exception 'billing revision conflict' using errcode='40001'; end if;
  if jsonb_array_length(v_preview->'blockers')>0 then raise exception 'billing preview has blockers' using errcode='23514'; end if;
  select min(starts_on) into v_first from public.platform_commercial_terms where org_id=p_org and starts_on<=p_month;
  if exists(select 1 from generate_series(v_first,p_month-interval '1 month',interval '1 month') as g(month_value)
    where not exists(select 1 from public.platform_billing_statements s where s.org_id=p_org and s.month=g.month_value::date)) then
    raise exception 'previous billing month must be closed first' using errcode='23514';
  end if;
  insert into public.platform_billing_statements(org_id,month,terms_id,revenue_bps,gross_cents,refund_cents,base_cents,
    fee_cents,sonar_cents,credit_cents,total_cents,revision,snapshot,closed_by)
  values(p_org,p_month,(v_preview->'terms'->>'id')::uuid,(v_preview->'terms'->>'revenue_bps')::integer,
    (v_preview->>'gross_cents')::bigint,(v_preview->>'refund_cents')::bigint,(v_preview->>'base_cents')::bigint,
    (v_preview->>'fee_cents')::bigint,(v_preview->>'sonar_cents')::bigint,(v_preview->>'credit_cents')::bigint,
    (v_preview->>'total_cents')::bigint,v_preview->>'revision',v_preview,p_actor) returning * into v_statement;
  insert into public.platform_billing_sale_facts(statement_id,org_id,sale_id,source_updated_at,gross_cents,refunded_product_cents,recognized_base_cents)
    select v_statement.id,p_org,(row->>'sale_id')::uuid,(row->>'source_updated_at')::timestamptz,
      (row->>'gross_cents')::bigint,(row->>'refunded_product_cents')::bigint,(row->>'recognized_base_cents')::bigint
    from jsonb_array_elements(v_preview->'sources') row;
  insert into public.platform_audit_events(org_id,actor_id,category,action,result,target,details)
    values(p_org,p_actor,'billing','billing_closed','success',v_statement.id::text,jsonb_build_object('month',p_month,'revision',v_statement.revision));
  return v_preview||jsonb_build_object('id',v_statement.id,'closed_at',v_statement.closed_at,'closed_by',v_statement.closed_by);
end;
$$;

create function public.platform_reconcile_revenue(p_actor uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_sale uuid; v_source timestamptz; v_refund bigint; v_reason text;
declare v_row public.platform_revenue_reconciliations%rowtype; v_gross bigint;
declare v_refund_text text;
begin
  perform public.platform_assert_admin_actor(p_actor);
  begin
    v_org:=(p_input->>'org_id')::uuid; v_sale:=(p_input->>'sale_id')::uuid;
    v_source:=(p_input->>'source_updated_at')::timestamptz;
    v_reason:=btrim(p_input->>'reason');
  exception when others then raise exception 'invalid reconciliation input' using errcode='22023'; end;
  v_refund_text:=p_input->>'refunded_product_cents';
  if jsonb_typeof(p_input->'refunded_product_cents') is distinct from 'number'
    or v_refund_text !~ '^(0|[1-9][0-9]*)$' or length(v_refund_text)>16
    or (length(v_refund_text)=16 and v_refund_text>'9007199254740991') then
    raise exception 'invalid reconciliation input' using errcode='22023';
  end if;
  v_refund:=v_refund_text::bigint;
  select round(total_amount*100)::bigint into v_gross from public.ml_vendas
    where id=v_sale and org_id=v_org and atualizado_em=v_source
      and (status in ('partially_refunded','refunded','cancelled') or coalesce(tem_devolucao,false) or coalesce(estorno,0)>0) for update;
  if not found or v_refund>v_gross or length(coalesce(v_reason,''))=0 then
    raise exception 'invalid or stale reconciliation' using errcode='22023';
  end if;
  insert into public.platform_revenue_reconciliations(org_id,sale_id,source_updated_at,refunded_product_cents,reason,created_by)
    values(v_org,v_sale,v_source,v_refund,v_reason,p_actor)
    on conflict(org_id,sale_id,source_updated_at) do nothing returning * into v_row;
  if not found then
    select * into v_row from public.platform_revenue_reconciliations where org_id=v_org and sale_id=v_sale and source_updated_at=v_source;
    if v_row.refunded_product_cents<>v_refund or v_row.reason<>v_reason then raise exception 'reconciliation conflict' using errcode='23505'; end if;
  else
    insert into public.platform_audit_events(org_id,actor_id,category,action,result,target,reason,details)
      values(v_org,p_actor,'billing','revenue_reconciled','success',v_sale::text,v_reason,jsonb_build_object('source_updated_at',v_source,'refund_cents',v_refund));
  end if;
  return jsonb_build_object('id',v_row.id);
end;
$$;

revoke all on function public.platform_billing_append_only() from public,anon,authenticated;
revoke all on function public.platform_assert_admin_actor(uuid) from public,anon,authenticated;
revoke all on function public.platform_billing_preview(uuid,uuid,date) from public,anon,authenticated;
revoke all on function public.platform_billing_close(uuid,uuid,date,text) from public,anon,authenticated;
revoke all on function public.platform_reconcile_revenue(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.platform_billing_preview(uuid,uuid,date) to service_role;
grant execute on function public.platform_billing_close(uuid,uuid,date,text) to service_role;
grant execute on function public.platform_reconcile_revenue(uuid,jsonb) to service_role;
