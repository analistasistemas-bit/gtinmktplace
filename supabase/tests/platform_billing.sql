\set ON_ERROR_STOP on
\ir platform_sonar.sql

-- `if not exists`: platform_commercial.sql, encadeado acima via platform_sonar.sql, ja cria esta
-- tabela com o superset das colunas. Sem isto o arquivo aborta em "relation already exists" e o
-- teste de fechamento inteiro deixa de rodar.
create table if not exists public.ml_vendas (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  order_id bigint,
  date_closed timestamptz not null,
  total_amount numeric not null,
  status text not null,
  atualizado_em timestamptz not null,
  tem_devolucao boolean not null default false,
  estorno numeric not null default 0
);

\ir ../migrations/20260906170200_platform_billing.sql
-- Migrations novas que tocam billing entram ABAIXO, em ordem de timestamp.
-- Fora de ordem (ou ausentes) o teste roda contra a versao antiga das funcoes e passa em falso.
\ir ../migrations/20260907102428_platform_terms_contract_fix.sql
select set_config('request.jwt.claims','{"role":"service_role"}',false);

insert into public.organizations(id,nome,slug) values
  ('90000000-0000-0000-0000-000000000003','Org Billing','org-billing'),
  ('90000000-0000-0000-0000-000000000004','Org Partial','org-partial'),
  ('90000000-0000-0000-0000-000000000005','Org Late','org-late'),
  ('90000000-0000-0000-0000-000000000006','Org Rounding','org-rounding'),
  ('90000000-0000-0000-0000-000000000007','Org Source Guard','org-source-guard'),
  ('90000000-0000-0000-0000-000000000008','Org Cancelled','org-cancelled'),
  ('90000000-0000-0000-0000-000000000009','Org Paid Evidence','org-paid-evidence'),
  ('90000000-0000-0000-0000-000000000010','Org Late Paid Evidence','org-late-paid-evidence'),
  ('90000000-0000-0000-0000-000000000013','Org No Terms','org-no-terms');

insert into public.platform_commercial_terms(
  org_id,starts_on,modality,monthly_fee_cents,revenue_bps,sonar_unit_cents,
  setup_fee_cents,setup_due_month,reason,created_by,version
) values
  ('90000000-0000-0000-0000-000000000003',(date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date,2,60000,500,120,0,null,'billing fixture','80000000-0000-0000-0000-000000000001',1),
  ('90000000-0000-0000-0000-000000000004',(date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date,2,0,500,0,100,(date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date,'partial fixture','80000000-0000-0000-0000-000000000001',1),
  ('90000000-0000-0000-0000-000000000005',(date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date,2,0,500,0,0,null,'late fixture','80000000-0000-0000-0000-000000000001',1),
  ('90000000-0000-0000-0000-000000000006',(date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date,2,0,5000,0,0,null,'rounding fixture','80000000-0000-0000-0000-000000000001',1),
  ('90000000-0000-0000-0000-000000000007',(date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date,2,0,500,0,0,null,'source guard fixture','80000000-0000-0000-0000-000000000001',1),
  ('90000000-0000-0000-0000-000000000008',(date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date,2,0,500,0,0,null,'cancelled fixture','80000000-0000-0000-0000-000000000001',1),
  ('90000000-0000-0000-0000-000000000009',(date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date,2,0,500,0,0,null,'paid evidence fixture','80000000-0000-0000-0000-000000000001',1),
  ('90000000-0000-0000-0000-000000000010',(date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date,2,0,500,0,0,null,'late paid evidence fixture','80000000-0000-0000-0000-000000000001',1);

insert into public.ml_vendas(id,org_id,order_id,date_closed,total_amount,status,atualizado_em,tem_devolucao,estorno) values
  ('50000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000003',300001,date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months'+interval '1 day',9000,'paid','2026-07-02T12:00:00Z',false,0),
  ('50000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000003',300002,date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months'+interval '2 days',1000,'refunded','2026-07-03T12:00:00Z',false,0),
  ('50000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000004',400003,date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months'+interval '1 day',100,'partially_refunded','2026-07-02T12:00:00Z',false,0),
  ('50000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000005',500004,date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months'+interval '1 day',9000,'paid','2026-07-02T12:00:00Z',false,0),
  ('50000000-0000-0000-0000-000000000005','90000000-0000-0000-0000-000000000006',600005,date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months'+interval '1 day',0.03,'paid','2026-07-02T12:00:00Z',false,0),
  ('50000000-0000-0000-0000-000000000006','90000000-0000-0000-0000-000000000007',700006,date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months'+interval '1 day',100,'paid','2026-07-02T12:00:00Z',false,0),
  ('50000000-0000-0000-0000-000000000007','90000000-0000-0000-0000-000000000008',800007,date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months'+interval '1 day',100,'paid','2026-07-02T12:00:00Z',false,0),
  ('50000000-0000-0000-0000-000000000008','90000000-0000-0000-0000-000000000009',900008,date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months'+interval '1 day',100,'paid','2026-07-02T12:00:00Z',false,12.50),
  ('50000000-0000-0000-0000-000000000009','90000000-0000-0000-0000-000000000009',900009,date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months'+interval '2 days',50,'paid','2026-07-03T12:00:00Z',true,0),
  ('50000000-0000-0000-0000-000000000010','90000000-0000-0000-0000-000000000010',100010,date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months'+interval '1 day',200,'paid','2026-07-02T12:00:00Z',false,0);

do $$
declare i integer; v_result uuid; v_search uuid;
begin
  for i in 1..10 loop
    insert into public.platform_sonar_results(normalized_query,query_type,schema_version,generation,payload,state,valid_until)
      values('billing-'||i,'termo',1,1,jsonb_build_object('itens',jsonb_build_array(jsonb_build_object('id',i))),'ready',now()+interval '1 day') returning id into v_result;
    insert into public.platform_sonar_searches(org_id,actor_id,request_id,intent_key,normalized_query,query_type,result_id,state,origin,completed_at)
      values('90000000-0000-0000-0000-000000000003','80000000-0000-0000-0000-000000000001',gen_random_uuid(),'billing-'||i,'billing-'||i,'termo',v_result,'completed','cliente',now()) returning id into v_search;
    insert into public.platform_sonar_deliveries(org_id,result_id,search_id,actor_id,terms_id,month,unit_cents,units,total_cents)
      values('90000000-0000-0000-0000-000000000003',v_result,v_search,'80000000-0000-0000-0000-000000000001',
        (select id from public.platform_resolve_terms('90000000-0000-0000-0000-000000000003',(date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date)),
        (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date,120,1,120);
  end loop;
end $$;

do $$
declare v_month date := (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date;
declare v_preview jsonb; v_closed jsonb;
begin
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000003',v_month);
  if (v_preview->>'gross_cents')::bigint<>1000000 or (v_preview->>'refund_cents')::bigint<>100000
    or (v_preview->>'base_cents')::bigint<>900000 or (v_preview->>'fee_cents')::bigint<>45000
    or (v_preview->>'sonar_units')::integer<>10 or (v_preview->>'sonar_cents')::bigint<>1200
    or (v_preview->>'total_cents')::bigint<>106200 or jsonb_array_length(v_preview->'blockers')<>0 then
    raise exception 'numeric fixture failed: %',v_preview;
  end if;
  if v_preview#>>'{lines,1,unit_cents}' is not null then raise exception 'bps exposed as cents'; end if;
  begin
    perform public.platform_billing_close('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000003',v_month,'wrong');
    raise exception 'revision mismatch accepted';
  exception when serialization_failure then null;
  end;
  v_closed:=public.platform_billing_close('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000003',v_month,v_preview->>'revision');
  if (v_closed->>'total_cents')::bigint<>106200 then raise exception 'close changed preview'; end if;
  begin update public.platform_billing_statements set total_cents=0 where id=(v_closed->>'id')::uuid;
    raise exception 'statement update allowed'; exception when check_violation then null; end;
  begin delete from public.platform_billing_sale_facts where statement_id=(v_closed->>'id')::uuid;
    raise exception 'fact delete allowed'; exception when check_violation then null; end;
end $$;

do $$
declare v_month date := (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date;
declare v_preview jsonb;
begin
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000004',v_month);
  if not (v_preview->'blockers' @> '[{"code":"refund_reconciliation_required","sale_id":"50000000-0000-0000-0000-000000000003"}]') then
    raise exception 'partial refund without evidence was not blocked: %',v_preview;
  end if;
  if not (v_preview->'blockers' @> '[{"sale_id":"50000000-0000-0000-0000-000000000003","order_ref":"400003","source_updated_at":"2026-07-02T12:00:00+00:00","gross_cents":10000,"status":"partially_refunded","refunded_product_cents":null}]') then
    raise exception 'partial blocker is missing reconciliation candidate fields: %',v_preview;
  end if;
  foreach v_preview in array array['{"org_id":"90000000-0000-0000-0000-000000000004","sale_id":"50000000-0000-0000-0000-000000000003","source_updated_at":"2026-07-02T12:00:00Z","refunded_product_cents":1.5,"reason":"decimal"}'::jsonb,
    '{"org_id":"90000000-0000-0000-0000-000000000004","sale_id":"50000000-0000-0000-0000-000000000003","source_updated_at":"2026-07-02T12:00:00Z","refunded_product_cents":9007199254740992,"reason":"unsafe"}'::jsonb] loop
    begin perform public.platform_reconcile_revenue('80000000-0000-0000-0000-000000000001',v_preview);
      raise exception 'invalid cents accepted'; exception when invalid_parameter_value then null; end;
  end loop;
  perform public.platform_reconcile_revenue('80000000-0000-0000-0000-000000000001',jsonb_build_object(
    'org_id','90000000-0000-0000-0000-000000000004','sale_id','50000000-0000-0000-0000-000000000003',
    'source_updated_at','2026-07-02T12:00:00Z','refunded_product_cents',1000,'reason','product evidence'));
end $$;

do $$
declare v_origin date := (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date;
declare v_next date := (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '1 month')::date;
declare v_preview jsonb;
begin
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000007',v_origin);
  perform public.platform_billing_close('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000007',v_origin,v_preview->>'revision');
  update public.ml_vendas set atualizado_em='2026-08-01T12:00:00Z' where id='50000000-0000-0000-0000-000000000006';
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000007',v_next);
  if v_preview->'blockers' @> '[{"code":"billing_source_changed","sale_id":"50000000-0000-0000-0000-000000000006"}]' then
    raise exception 'timestamp-only source update was blocked: %',v_preview;
  end if;
  update public.ml_vendas set total_amount=101,atualizado_em='2026-08-02T12:00:00Z' where id='50000000-0000-0000-0000-000000000006';
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000007',v_next);
  if not (v_preview->'blockers' @> '[{"code":"billing_source_changed","sale_id":"50000000-0000-0000-0000-000000000006","order_ref":"700006","source_updated_at":"2026-08-02T12:00:00+00:00","gross_cents":10100,"status":"paid","refunded_product_cents":null}]') then
    raise exception 'altered source was not blocked with candidate fields: %',v_preview;
  end if;
  begin
    perform public.platform_billing_close('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000007',v_next,v_preview->>'revision');
    raise exception 'altered source close was accepted';
  exception when check_violation then null;
  end;
  delete from public.ml_vendas where id='50000000-0000-0000-0000-000000000006';
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000007',v_next);
  if not (v_preview->'blockers' @> '[{"code":"billing_source_missing","sale_id":"50000000-0000-0000-0000-000000000006"}]') then
    raise exception 'deleted source was not blocked: %',v_preview;
  end if;
end $$;

do $$
declare v_origin date := (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date;
declare v_next date := (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '1 month')::date;
declare v_preview jsonb;
begin
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000008',v_origin);
  perform public.platform_billing_close('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000008',v_origin,v_preview->>'revision');
  update public.ml_vendas set status='cancelled',atualizado_em='2026-08-03T12:00:00Z' where id='50000000-0000-0000-0000-000000000007';
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000008',v_next);
  if (v_preview->>'gross_cents')::bigint<>0 or v_preview#>>'{adjustments,0,amount_cents}'<>'500' then
    raise exception 'cancelled sale changed current gross or missed full original-rate credit: %',v_preview;
  end if;
end $$;

create temporary table billing_concurrent(payload jsonb);
select dblink_connect('billing_1',format('dbname=%L user=supabase_admin',current_database()));
select dblink_connect('billing_2',format('dbname=%L user=supabase_admin',current_database()));
select dblink_exec('billing_1',$$set request.jwt.claims='{"role":"service_role"}'$$);
select dblink_exec('billing_2',$$set request.jwt.claims='{"role":"service_role"}'$$);
do $$
declare v_month date := (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date;
declare v_revision text;
begin
  v_revision:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000004',v_month)->>'revision';
  perform dblink_send_query('billing_1',format('select public.platform_billing_close(%L,%L,%L,%L)',
    '80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000004',v_month,v_revision));
  perform dblink_send_query('billing_2',format('select public.platform_billing_close(%L,%L,%L,%L)',
    '80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000004',v_month,v_revision));
end $$;
insert into billing_concurrent select * from dblink_get_result('billing_1') as result(payload jsonb);
insert into billing_concurrent select * from dblink_get_result('billing_2') as result(payload jsonb);
select dblink_disconnect('billing_1');
select dblink_disconnect('billing_2');
do $$
declare v_next date := (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '1 month')::date;
declare v_preview jsonb;
begin
  if (select count(*) from billing_concurrent)<>2
    or (select count(distinct payload->>'id') from billing_concurrent)<>1
    or (select count(*) from public.platform_billing_statements where org_id='90000000-0000-0000-0000-000000000004')<>1 then
    raise exception 'concurrent close was not idempotent: %',(select jsonb_agg(payload) from billing_concurrent);
  end if;
  insert into public.platform_commercial_terms(org_id,starts_on,modality,monthly_fee_cents,revenue_bps,sonar_unit_cents,setup_fee_cents,setup_due_month,reason,created_by,version)
    values('90000000-0000-0000-0000-000000000004',v_next,2,0,500,0,100,v_next,'setup must remain unique','80000000-0000-0000-0000-000000000001',1);
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000004',v_next);
  if (select count(*) from jsonb_array_elements(v_preview->'lines') line where line->>'key'='setup')<>0 then
    raise exception 'setup repeated after terms version';
  end if;
end $$;

do $$
declare v_origin date := (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date;
declare v_next date := (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '1 month')::date;
declare v_preview jsonb;
begin
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000005',v_origin);
  perform public.platform_billing_close('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000005',v_origin,v_preview->>'revision');
  insert into public.platform_commercial_terms(org_id,starts_on,modality,monthly_fee_cents,revenue_bps,sonar_unit_cents,setup_fee_cents,setup_due_month,reason,created_by,version)
    values('90000000-0000-0000-0000-000000000005',v_next,2,0,700,0,0,null,'new rate','80000000-0000-0000-0000-000000000001',1);
  update public.ml_vendas set status='partially_refunded',atualizado_em='2026-08-03T12:00:00Z',tem_devolucao=true where id='50000000-0000-0000-0000-000000000004';
  perform public.platform_reconcile_revenue('80000000-0000-0000-0000-000000000001',jsonb_build_object(
    'org_id','90000000-0000-0000-0000-000000000005','sale_id','50000000-0000-0000-0000-000000000004',
    'source_updated_at','2026-08-03T12:00:00Z','refunded_product_cents',100000,'reason','late refund'));
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000005',v_next);
  if (v_preview->>'credit_cents')::bigint<>0 or (v_preview->>'credit_balance_cents')::bigint<>5000
    or v_preview#>>'{adjustments,0,amount_cents}'<>'5000' then raise exception 'late refund did not use original 500 bps: %',v_preview; end if;
end $$;

do $$
declare v_origin date := (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date;
declare v_next date := (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '1 month')::date;
declare v_preview jsonb;
begin
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000006',v_origin);
  if (v_preview->>'fee_cents')::bigint<>2 then raise exception '3 cent aggregate must round to 2'; end if;
  perform public.platform_billing_close('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000006',v_origin,v_preview->>'revision');
  update public.ml_vendas set status='partially_refunded',atualizado_em='2026-08-01T12:00:00Z',tem_devolucao=true where id='50000000-0000-0000-0000-000000000005';
  perform public.platform_reconcile_revenue('80000000-0000-0000-0000-000000000001',jsonb_build_object('org_id','90000000-0000-0000-0000-000000000006','sale_id','50000000-0000-0000-0000-000000000005','source_updated_at','2026-08-01T12:00:00Z','refunded_product_cents',1,'reason','one cent'));
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000006',v_next);
  if v_preview#>>'{adjustments,0,amount_cents}'<>'1' then raise exception 'first incremental credit must be 1: %',v_preview; end if;
  perform public.platform_billing_close('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000006',v_next,v_preview->>'revision');
  update public.ml_vendas set atualizado_em='2026-09-01T12:00:00Z' where id='50000000-0000-0000-0000-000000000005';
  perform public.platform_reconcile_revenue('80000000-0000-0000-0000-000000000001',jsonb_build_object('org_id','90000000-0000-0000-0000-000000000006','sale_id','50000000-0000-0000-0000-000000000005','source_updated_at','2026-09-01T12:00:00Z','refunded_product_cents',2,'reason','two cents'));
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000006',date_trunc('month',now() at time zone 'America/Fortaleza')::date);
  if jsonb_array_length(v_preview->'adjustments')<>0 then raise exception 'second incremental credit must be zero: %',v_preview; end if;
  update public.ml_vendas set atualizado_em='2026-09-02T12:00:00Z' where id='50000000-0000-0000-0000-000000000005';
  perform public.platform_reconcile_revenue('80000000-0000-0000-0000-000000000001',jsonb_build_object('org_id','90000000-0000-0000-0000-000000000006','sale_id','50000000-0000-0000-0000-000000000005','source_updated_at','2026-09-02T12:00:00Z','refunded_product_cents',3,'reason','three cents'));
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000006',date_trunc('month',now() at time zone 'America/Fortaleza')::date);
  if v_preview#>>'{adjustments,0,amount_cents}'<>'1' then raise exception 'third incremental credit must be 1: %',v_preview; end if;
end $$;

do $$
declare v_month date := (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date;
declare v_preview jsonb;
begin
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000009',v_month);
  if not (v_preview->'blockers' @> '[{"code":"refund_reconciliation_required","sale_id":"50000000-0000-0000-0000-000000000008"}]') then
    raise exception 'paid with estorno was not blocked: %',v_preview;
  end if;
  if not (v_preview->'blockers' @> '[{"sale_id":"50000000-0000-0000-0000-000000000008","order_ref":"900008","source_updated_at":"2026-07-02T12:00:00+00:00","gross_cents":10000,"status":"paid","refunded_product_cents":null}]') then
    raise exception 'paid estorno blocker missing candidate fields: %',v_preview;
  end if;
  if (v_preview->>'gross_cents')::bigint<>15000 then raise exception 'paid evidence gross must include both sales: %',v_preview; end if;
  begin
    perform public.platform_billing_close('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000009',v_month,v_preview->>'revision');
    raise exception 'paid estorno close was accepted';
  exception when check_violation then null;
  end;
  perform public.platform_reconcile_revenue('80000000-0000-0000-0000-000000000001',jsonb_build_object(
    'org_id','90000000-0000-0000-0000-000000000009','sale_id','50000000-0000-0000-0000-000000000008',
    'source_updated_at','2026-07-02T12:00:00Z','refunded_product_cents',8000,'reason','product only'));
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000009',v_month);
  if (v_preview->>'refund_cents')::bigint<>8000 or (v_preview->>'base_cents')::bigint<>7000 then
    raise exception 'reconciled product amount not reflected in base: %',v_preview;
  end if;
  if v_preview->'blockers' @> '[{"code":"refund_reconciliation_required","sale_id":"50000000-0000-0000-0000-000000000008"}]' then
    raise exception 'paid estorno blocker remained after reconciliation: %',v_preview;
  end if;
  if not (v_preview->'blockers' @> '[{"code":"refund_reconciliation_required","sale_id":"50000000-0000-0000-0000-000000000009"}]') then
    raise exception 'paid with tem_devolucao was not blocked: %',v_preview;
  end if;
  perform public.platform_reconcile_revenue('80000000-0000-0000-0000-000000000001',jsonb_build_object(
    'org_id','90000000-0000-0000-0000-000000000009','sale_id','50000000-0000-0000-0000-000000000009',
    'source_updated_at','2026-07-03T12:00:00Z','refunded_product_cents',0,'reason','mediation only'));
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000009',v_month);
  if jsonb_array_length(v_preview->'blockers')<>0 then raise exception 'tem_devolucao zero reconciliation still blocked: %',v_preview; end if;
  if (v_preview->>'base_cents')::bigint<>7000
    or (select (elem->>'recognized_base_cents')::bigint from jsonb_array_elements(v_preview->'sources') elem
        where elem->>'sale_id'='50000000-0000-0000-0000-000000000009')<>5000 then
    raise exception 'tem_devolucao zero reconciliation must keep sale gross in base: %',v_preview;
  end if;
end $$;

do $$
declare v_month date := (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date;
declare v_preview jsonb;
begin
  update public.ml_vendas set atualizado_em='2026-08-01T12:00:00Z'
    where id='50000000-0000-0000-0000-000000000008';
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000009',v_month);
  if (v_preview->>'refund_cents')::bigint<>8000 or (v_preview->>'base_cents')::bigint<>7000 then
    raise exception 'timestamp-only bump changed billing totals: %',v_preview;
  end if;
  if v_preview->'blockers' @> '[{"code":"refund_reconciliation_required","sale_id":"50000000-0000-0000-0000-000000000008"}]'
    or v_preview->'blockers' @> '[{"code":"billing_source_changed","sale_id":"50000000-0000-0000-0000-000000000008"}]' then
    raise exception 'timestamp-only bump re-blocked reconciled sale: %',v_preview;
  end if;
  perform public.platform_reconcile_revenue('80000000-0000-0000-0000-000000000001',jsonb_build_object(
    'org_id','90000000-0000-0000-0000-000000000009','sale_id','50000000-0000-0000-0000-000000000008',
    'source_updated_at','2026-08-01T12:00:00Z','refunded_product_cents',8000,'reason','product only'));
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000009',v_month);
  if (v_preview->>'refund_cents')::bigint<>8000 or (v_preview->>'base_cents')::bigint<>7000
    or jsonb_array_length(v_preview->'blockers')<>0 then
    raise exception 'idempotent reconcile after timestamp bump failed: %',v_preview;
  end if;
  update public.ml_vendas set total_amount=110,atualizado_em='2026-08-02T12:00:00Z'
    where id='50000000-0000-0000-0000-000000000008';
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000009',v_month);
  if not (v_preview->'blockers' @> '[{"code":"refund_reconciliation_required","sale_id":"50000000-0000-0000-0000-000000000008"}]') then
    raise exception 'gross change after reconciliation was not blocked: %',v_preview;
  end if;
end $$;

do $$
declare v_origin date := (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date;
declare v_next date := (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '1 month')::date;
declare v_preview jsonb;
begin
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000010',v_origin);
  perform public.platform_billing_close('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000010',v_origin,v_preview->>'revision');
  update public.ml_vendas set tem_devolucao=true,estorno=15,atualizado_em='2026-08-03T12:00:00Z'
    where id='50000000-0000-0000-0000-000000000010';
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000010',v_next);
  if not (v_preview->'blockers' @> '[{"code":"refund_reconciliation_required","sale_id":"50000000-0000-0000-0000-000000000010"}]') then
    raise exception 'late paid evidence was not blocked: %',v_preview;
  end if;
  if v_preview->'blockers' @> '[{"code":"billing_source_changed","sale_id":"50000000-0000-0000-0000-000000000010"}]' then
    raise exception 'late paid evidence was classified as source changed: %',v_preview;
  end if;
end $$;

do $$
declare v_month date := (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date;
declare v_preview jsonb;
begin
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  begin perform public.platform_billing_preview('80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000003',v_month);
    raise exception 'inactive/non-admin actor accepted'; exception when insufficient_privilege then null; end;
  begin perform public.platform_billing_close('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000004',date_trunc('month',now() at time zone 'America/Fortaleza')::date,'x');
    raise exception 'current month closed'; exception when invalid_parameter_value then null; end;
end $$;

-- Mês sem condição comercial: a prévia bloqueia e o fechamento recusa (ADR-0158 §1).
do $$
declare v_month date := (date_trunc('month',now() at time zone 'America/Fortaleza')-interval '2 months')::date;
declare v_preview jsonb;
begin
  v_preview:=public.platform_billing_preview('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000013',v_month);
  if not (v_preview->'blockers' @> '[{"code":"commercial_terms_required"}]') then
    raise exception 'month without commercial terms was not blocked: %',v_preview;
  end if;
  if jsonb_typeof(v_preview->'terms')<>'null' then
    raise exception 'preview without terms must expose terms as json null: %',v_preview;
  end if;
  if v_preview->>'total_cents' is null or (v_preview->>'total_cents')::bigint<>0 then
    raise exception 'preview without terms must total zero, not null: %',v_preview;
  end if;
  begin
    perform public.platform_billing_close('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000013',v_month,v_preview->>'revision');
    raise exception 'close without commercial terms was accepted';
  exception when check_violation then
    if sqlerrm<>'commercial terms required' then
      raise exception 'close without terms raised the wrong error: %',sqlerrm;
    end if;
  end;
  if exists(select 1 from public.platform_billing_statements where org_id='90000000-0000-0000-0000-000000000013') then
    raise exception 'close without terms persisted a statement';
  end if;
end $$;
