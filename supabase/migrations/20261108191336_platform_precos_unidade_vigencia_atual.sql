-- Emenda 2026-11-08 ao ADR-0155: preços por unidade (Sonar por consulta, Imagem IA por unidade) com vigência
-- na competência aberta, sem liberar renegociação retroativa do resto.
--
-- 1. platform_save_unit_prices: grava uma VERSÃO NOVA do termo resolvido para a competência aberta
--    (starts_on = competência, version seguinte), copiando modalidade, mensalidade, faixas, vencimento e
--    implantação, e trocando só sonar_unit_cents/image_unit_cents. Cada entrega já congela o próprio
--    unit_cents: as anteriores ficam com o preço antigo, as seguintes pegam o novo.
--    Implantação (ADR-0164): copiada do termo resolvido, nunca do input; só zera quando já venceu
--    (setup_due_month < starts_on), e aí o mês dela continua resolvendo para o termo antigo.
-- 2. platform_sonar_delivery_json passa a tomar o MESMO lock da org que platform_billing_close e a nova RPC
--    (antes de ler competência e termo), calcula a competência com clock_timestamp() depois do lock e nunca
--    grava em competência fechada (vai para a aberta seguinte) — igual à entrega de Imagem IA.
-- 3. platform_billing_preview: a linha de Sonar/Imagem mostra o unit_cents praticado no mês; com mais de um
--    preço no mesmo mês, unit_cents = null. Total, quantidade e revisão (v_sources) não mudam.
--
-- Sem begin/commit: o db push já envolve a migration numa transação.

create function public.platform_save_unit_prices(p_actor uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_expected uuid;
  v_sonar bigint;
  v_image bigint;
  v_reason text;
  v_month date;
  v_prev public.platform_commercial_terms%rowtype;
  v_term public.platform_commercial_terms%rowtype;
  v_version integer;
  v_setup_fee bigint;
  v_setup_due date;
  v_field text;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor and p.is_super_admin and p.is_active
  ) then
    raise exception 'Active super-admin actor required' using errcode = '42501';
  end if;

  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'Invalid unit prices input' using errcode = '22023';
  end if;
  begin
    v_org_id := (p_input->>'org_id')::uuid;
    v_expected := (p_input->>'expected_terms_id')::uuid;
  exception when others then
    raise exception 'Invalid unit prices input' using errcode = '22023';
  end;
  if v_org_id is null or v_expected is null then
    raise exception 'Invalid unit prices input' using errcode = '22023';
  end if;
  foreach v_field in array array['sonar_unit_cents', 'image_unit_cents'] loop
    if jsonb_typeof(p_input->v_field) is distinct from 'number'
      or (p_input->>v_field) !~ '^(0|[1-9][0-9]*)$'
      or length(p_input->>v_field) > 16
      or (length(p_input->>v_field) = 16 and (p_input->>v_field) > '9007199254740991') then
      raise exception 'Invalid unit prices input' using errcode = '22023';
    end if;
  end loop;
  v_sonar := (p_input->>'sonar_unit_cents')::bigint;
  v_image := (p_input->>'image_unit_cents')::bigint;
  if p_input ? 'reason' and jsonb_typeof(p_input->'reason') is distinct from 'string' then
    raise exception 'Invalid unit prices input' using errcode = '22023';
  end if;
  v_reason := coalesce(nullif(btrim(p_input->>'reason'), ''), 'Preços por unidade a partir de agora');

  -- Mesmo lock da org que platform_billing_close (for update) e as entregas (for no key update). Depois dele,
  -- competência pelo relógio atual: uma entrega concorrente vê o termo antigo inteiro ou o novo commitado.
  perform 1 from public.organizations o where o.id = v_org_id for update;
  if not found then
    raise exception 'Organization not found' using errcode = '23503';
  end if;
  v_month := date_trunc('month', clock_timestamp() at time zone 'America/Fortaleza')::date;

  if exists (select 1 from public.platform_billing_statements s where s.org_id = v_org_id and s.month = v_month) then
    raise exception 'Competência % já tem demonstrativo fechado: preço por unidade não pode mudar', to_char(v_month, 'YYYY-MM')
      using errcode = '23514';
  end if;

  select * into v_prev from public.platform_resolve_terms(v_org_id, v_month);
  if v_prev.id is null then
    raise exception 'Sem condição comercial vigente em %: cadastre o contrato antes', to_char(v_month, 'YYYY-MM')
      using errcode = '23514';
  end if;
  -- Formulário desatualizado (outro admin trocou antes, ou o mês virou): não sobrescrever em silêncio.
  if v_prev.id <> v_expected then
    raise exception 'Commercial terms revision conflict: a condição vigente mudou, recarregue' using errcode = '40001';
  end if;
  if v_prev.modality = 1 and v_sonar <> 0 then
    raise exception 'Modalidade 1 não cobra Sonar do cliente: informe 0,00' using errcode = '22023';
  end if;
  if v_sonar = v_prev.sonar_unit_cents and v_image = v_prev.image_unit_cents then
    raise exception 'Preços iguais aos vigentes: nada a alterar' using errcode = '22023';
  end if;

  -- ADR-0164: a implantação vem do termo resolvido, nunca do input. Vencida antes desta competência, herdar
  -- violaria platform_commercial_terms_setup_once; o mês dela continua resolvendo para o termo antigo.
  v_setup_fee := v_prev.setup_fee_cents;
  v_setup_due := v_prev.setup_due_month;
  if v_setup_due < v_month then
    v_setup_fee := 0;
    v_setup_due := null;
  end if;

  select coalesce(max(t.version), 0) + 1 into v_version
  from public.platform_commercial_terms t
  where t.org_id = v_org_id and t.starts_on = v_month;

  insert into public.platform_commercial_terms (
    org_id, starts_on, modality, monthly_fee_cents,
    revenue_bps_t1, revenue_bps_t2, revenue_bps_t3, revenue_bps_t4,
    sonar_unit_cents, setup_fee_cents, setup_due_month, reason, created_by, version, due_day, image_unit_cents
  ) values (
    v_org_id, v_month, v_prev.modality, v_prev.monthly_fee_cents,
    v_prev.revenue_bps_t1, v_prev.revenue_bps_t2, v_prev.revenue_bps_t3, v_prev.revenue_bps_t4,
    v_sonar, v_setup_fee, v_setup_due, v_reason, p_actor, v_version, v_prev.due_day, v_image
  ) returning * into v_term;

  insert into public.platform_audit_events (
    org_id, actor_id, category, action, result, target, reason, details
  ) values (
    v_org_id, p_actor, 'admin', 'platform_unit_prices_saved', 'success', v_term.id::text, v_reason,
    jsonb_build_object(
      'starts_on', v_month, 'version', v_version, 'previous_terms_id', v_prev.id,
      'sonar_unit_cents', jsonb_build_object('de', v_prev.sonar_unit_cents, 'para', v_sonar),
      'image_unit_cents', jsonb_build_object('de', v_prev.image_unit_cents, 'para', v_image))
  );

  return to_jsonb(v_term);
end;
$$;

revoke all on function public.platform_save_unit_prices(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.platform_save_unit_prices(uuid, jsonb) to service_role;

-- platform_sonar_delivery_json: igual à de 20260906170100 + lock da org, competência por clock_timestamp()
-- depois do lock e nunca em competência fechada.
create or replace function public.platform_sonar_delivery_json(p_search public.platform_sonar_searches)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_existing public.platform_sonar_deliveries%rowtype;
declare v_terms public.platform_commercial_terms%rowtype;
declare v_month date;
declare v_inserted boolean := false;
begin
  if p_search.origin = 'daludi' then
    insert into public.platform_sonar_events(org_id,search_id,actor_id,result_id,stage,outcome,reason)
      values(p_search.org_id,p_search.id,p_search.actor_id,p_search.result_id,'delivery','exempt','daludi');
    return jsonb_build_object('classificacao','daludi','entrega_id',null,'unidades',0,'total_centavos',0);
  end if;
  -- Mesmo lock da org que platform_billing_close (for update) e platform_save_unit_prices; `no key update`
  -- conflita com eles e não trava os FKs (key share). Depois do lock, cada comando enxerga o commitado.
  perform 1 from public.organizations o where o.id = p_search.org_id for no key update;
  select * into v_existing from public.platform_sonar_deliveries
    where org_id = p_search.org_id and result_id = p_search.result_id;
  if found then
    insert into public.platform_sonar_events(org_id,search_id,actor_id,result_id,stage,outcome,reason)
      values(p_search.org_id,p_search.id,p_search.actor_id,p_search.result_id,'delivery','exempt','reabertura');
    return jsonb_build_object('classificacao','reabertura','entrega_id',v_existing.id,'unidades',0,'total_centavos',0);
  end if;
  v_month := date_trunc('month', clock_timestamp() at time zone 'America/Fortaleza')::date;
  while exists (select 1 from public.platform_billing_statements s where s.org_id = p_search.org_id and s.month = v_month) loop
    v_month := (v_month + interval '1 month')::date;
  end loop;
  select * into v_terms from public.platform_resolve_terms(p_search.org_id, v_month);
  insert into public.platform_sonar_deliveries(
    org_id,result_id,search_id,actor_id,terms_id,month,unit_cents,units,total_cents,reason
  ) values (
    p_search.org_id,p_search.result_id,p_search.id,p_search.actor_id,v_terms.id,v_month,
    coalesce(v_terms.sonar_unit_cents,0),case when v_terms.id is null then 0 else 1 end,
    coalesce(v_terms.sonar_unit_cents,0),case when v_terms.id is null then 'sem_condicao_comercial' else null end
  ) on conflict (org_id,result_id) do nothing returning * into v_existing;
  v_inserted := found;
  if not v_inserted then
    select * into v_existing from public.platform_sonar_deliveries
      where org_id = p_search.org_id and result_id = p_search.result_id;
    insert into public.platform_sonar_events(org_id,search_id,actor_id,result_id,stage,outcome,reason)
      values(p_search.org_id,p_search.id,p_search.actor_id,p_search.result_id,'delivery','exempt','reabertura_concorrente');
    return jsonb_build_object('classificacao','reabertura','entrega_id',v_existing.id,'unidades',0,'total_centavos',0);
  end if;
  insert into public.platform_sonar_events(org_id,search_id,actor_id,result_id,stage,outcome,reason)
    values(p_search.org_id,p_search.id,p_search.actor_id,p_search.result_id,'delivery',
      case when v_existing.units=1 then 'billable' else 'exempt' end,v_existing.reason);
  return jsonb_build_object(
    'classificacao',case when v_existing.units = 1 then 'cliente' else 'isento' end,
    'entrega_id',v_existing.id,'unidades',v_existing.units,'total_centavos',v_existing.total_cents
  );
end;
$$;

-- platform_billing_preview: igual à de 20261108094500, exceto unit_cents das linhas Sonar e Imagem IA.
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
declare v_sonar_unit bigint;
declare v_image_unit bigint;
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
  -- unit_cents da linha: o preço praticado no mês; mais de um preço (troca no meio do mês) = null.
  select count(*),coalesce(sum(total_cents),0),case when count(distinct unit_cents)=1 then min(unit_cents) end
    into v_sonar_units,v_sonar,v_sonar_unit
    from public.platform_sonar_deliveries where org_id=p_org and month=p_month and units=1;
  select count(*),coalesce(sum(total_cents),0),case when count(distinct unit_cents)=1 then min(unit_cents) end
    into v_image_units,v_image,v_image_unit
    from public.platform_image_deliveries where org_id=p_org and month=p_month and units=1;
  if v_sonar_units=0 then v_sonar_unit:=v_terms.sonar_unit_cents; end if;
  if v_image_units=0 then v_image_unit:=v_terms.image_unit_cents; end if;

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
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('key','sonar','label','Consultas Sonar','quantity',v_sonar_units,'unit_cents',v_sonar_unit,'amount_cents',v_sonar,'source_type','sonar_deliveries','source_id',null));
  end if;
  if v_terms.id is not null and (v_terms.image_unit_cents>0 or v_image_units>0) then
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('key','image_ia','label','Imagens IA','quantity',v_image_units,'unit_cents',v_image_unit,'amount_cents',v_image,'source_type','image_deliveries','source_id',null));
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

-- platform_sonar_complete: igual à de 20260906170100, exceto o lock do resultado (for update → for no key update).
-- Revisão do diff (Codex): com a entrega do Sonar esperando o lock da org, um `complete` repetido segurando o
-- resultado `for update` e esperando a org (fechamento em curso) fechava ciclo com a entrega de OUTRA org sobre o
-- mesmo resultado (o FK result_id pede key share) e com o fechamento (share em platform_sonar_deliveries).
-- `no key update` é compatível com key share e basta: o update do resultado só muda colunas que não são chave.
create or replace function public.platform_sonar_complete(
  p_actor uuid, p_org_id uuid, p_support_request uuid, p_search_id uuid,
  p_lease_token uuid, p_payload jsonb, p_failure_reason text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_search public.platform_sonar_searches%rowtype;
declare v_result public.platform_sonar_results%rowtype;
declare v_consumption jsonb;
begin
  perform public.platform_assert_sonar_context(p_actor,p_org_id,p_support_request);
  select * into v_search from public.platform_sonar_searches where id=p_search_id and org_id=p_org_id and actor_id=p_actor for update;
  if not found then raise exception 'search not found' using errcode='42501'; end if;
  if v_search.support_request_id is distinct from p_support_request then raise exception 'support context mismatch' using errcode='42501'; end if;
  select * into v_result from public.platform_sonar_results where id=v_search.result_id for no key update;
  if v_result.state='ready' then return public.platform_sonar_resolve_result(p_actor,p_org_id,p_support_request,p_search_id); end if;
  if v_result.state <> 'pending' or v_result.lease_token is distinct from p_lease_token
    or v_search.lease_token is distinct from p_lease_token or v_result.lease_until <= now() then
    raise exception 'stale sonar lease' using errcode='40001';
  end if;
  if p_failure_reason is not null or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or not coalesce((
      (jsonb_typeof(p_payload->'itens')='array' and jsonb_array_length(p_payload->'itens') > 0)
      or (jsonb_typeof(p_payload->'por_anuncio')='object' and p_payload->'por_anuncio' <> '{}'::jsonb)
    ), false) then
    update public.platform_sonar_results set state='failed',failure_reason=coalesce(nullif(btrim(p_failure_reason),''),'resultado_indisponivel'),
      lease_token=null,lease_until=null,updated_at=now() where id=v_result.id;
    update public.platform_sonar_searches set state='failed',completed_at=now() where id=v_search.id;
    insert into public.platform_sonar_events(org_id,search_id,actor_id,result_id,stage,outcome,reason)
      values(p_org_id,v_search.id,p_actor,v_result.id,'complete','failed',coalesce(p_failure_reason,'resultado_indisponivel'));
    return jsonb_build_object('acao','failed','busca_id',v_search.id,'resultado_id',v_result.id);
  end if;
  update public.platform_sonar_results set state='ready',payload=p_payload,valid_until=now()+interval '7 days',
    lease_token=null,lease_until=null,failure_reason=null,updated_at=now() where id=v_result.id;
  v_consumption := public.platform_sonar_delivery_json(v_search);
  update public.platform_sonar_searches set state='completed',completed_at=now() where id=v_search.id;
  insert into public.platform_sonar_events(org_id,search_id,actor_id,result_id,stage,outcome)
    values(p_org_id,v_search.id,p_actor,v_result.id,'complete','ready');
  return jsonb_build_object('acao','ready','busca_id',v_search.id,'resultado_id',v_result.id,
    'payload',p_payload,'consumo',v_consumption);
end;
$$;
