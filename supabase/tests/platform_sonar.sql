\set ON_ERROR_STOP on
\ir platform_commercial.sql

alter table public.organizations add column modulos_habilitados text[] not null default array['pulse'];
alter table public.profiles add column org_id uuid references public.organizations(id);

create table public.support_requests (
  id uuid primary key,
  requester_id uuid not null references public.profiles(id),
  org_id uuid not null references public.organizations(id),
  scope text not null,
  status text not null,
  expires_at timestamptz not null
);

update public.profiles set org_id='90000000-0000-0000-0000-000000000001'
  where id='80000000-0000-0000-0000-000000000002';
insert into public.profiles(id,is_super_admin,is_active,org_id) values
  ('80000000-0000-0000-0000-000000000003',false,true,'90000000-0000-0000-0000-000000000002');
insert into public.support_requests(id,requester_id,org_id,scope,status,expires_at) values
  ('70000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001',
   '90000000-0000-0000-0000-000000000001','read','active',now()+interval '1 hour');

insert into public.platform_commercial_terms(
  org_id,starts_on,modality,monthly_fee_cents,revenue_bps,sonar_unit_cents,
  setup_fee_cents,setup_due_month,reason,created_by,version
) values
('90000000-0000-0000-0000-000000000001',date_trunc('month',now() at time zone 'America/Fortaleza')::date,
 1,0,0,125,0,null,'sonar fixture','80000000-0000-0000-0000-000000000001',1),
('90000000-0000-0000-0000-000000000002',date_trunc('month',now() at time zone 'America/Fortaleza')::date,
 1,0,0,275,0,null,'sonar fixture','80000000-0000-0000-0000-000000000001',1);

\ir ../migrations/20260906170100_platform_sonar_metering.sql

do $$
begin
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  begin
    perform public.platform_sonar_begin(
      '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
      gen_random_uuid(),'cafeteira','termo',1,null);
    raise exception 'non service role was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claims','{"role":"service_role"}',false);

do $$
declare v_begin jsonb; v_retry jsonb; v_done jsonb; v_reopen jsonb; v_other jsonb; v_v2 jsonb;
declare v_search uuid; v_result uuid; v_lease uuid;
begin
  v_begin := public.platform_sonar_begin(
    '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
    '60000000-0000-0000-0000-000000000001','  Cafeteira  ','termo',1,null);
  if v_begin->>'acao' <> 'collect' then raise exception 'first request must collect: %',v_begin; end if;
  v_search := (v_begin->>'busca_id')::uuid; v_result := (v_begin->>'resultado_id')::uuid; v_lease := (v_begin->>'lease_token')::uuid;

  v_retry := public.platform_sonar_begin(
    '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
    '60000000-0000-0000-0000-000000000001','cafeteira','termo',1,null);
  if v_retry->>'acao' <> 'pending' then
    raise exception 'in-flight retry must wait without a second collector';
  end if;
  begin
    perform public.platform_sonar_begin(
      '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
      '60000000-0000-0000-0000-000000000001','outro termo','termo',1,null);
    raise exception 'request id accepted another intent';
  exception when invalid_parameter_value then null;
  end;

  v_done := public.platform_sonar_complete(
    '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
    v_search,v_lease,'{"configurado":true,"itens":[{"id":"MLB1"}]}'::jsonb,null);
  if v_done#>>'{consumo,classificacao}' <> 'cliente' or (v_done#>>'{consumo,total_centavos}')::int <> 125 then
    raise exception 'client price wrong: %',v_done;
  end if;

  v_reopen := public.platform_sonar_begin(
    '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
    '60000000-0000-0000-0000-000000000002','cafeteira','termo',1,null);
  v_reopen := public.platform_sonar_resolve_result(
    '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
    (v_reopen->>'busca_id')::uuid);
  if v_reopen#>>'{consumo,classificacao}' <> 'reabertura' then raise exception 'cache delivery charged twice'; end if;

  v_other := public.platform_sonar_begin(
    '80000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000002',null,
    '60000000-0000-0000-0000-000000000003','cafeteira','termo',1,null);
  v_other := public.platform_sonar_resolve_result(
    '80000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000002',null,
    (v_other->>'busca_id')::uuid);
  if v_other#>>'{consumo,classificacao}' <> 'cliente' or (v_other#>>'{consumo,total_centavos}')::int <> 275 then
    raise exception 'per-org price wrong: %',v_other;
  end if;

  perform set_config('session_replication_role','replica',true);
  update public.platform_sonar_results set valid_until=now()-interval '1 day' where id=v_result;
  perform set_config('session_replication_role','origin',true);
  v_v2 := public.platform_sonar_begin(
    '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
    '60000000-0000-0000-0000-000000000010','cafeteira','termo',1,null);
  if v_v2->>'acao' <> 'collect' or v_v2->>'resultado_id'=v_result::text then raise exception 'expired result was mutated/reused'; end if;
  v_v2 := public.platform_sonar_complete(
    '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
    (v_v2->>'busca_id')::uuid,(v_v2->>'lease_token')::uuid,'{"configurado":true,"versao":2,"itens":[{"id":"MLB2"}]}'::jsonb,null);
  if v_v2#>>'{consumo,classificacao}' <> 'cliente' or (v_v2#>>'{consumo,total_centavos}')::int <> 125 then
    raise exception 'new durable version was not billed once';
  end if;
  v_reopen := public.platform_sonar_begin(
    '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
    '60000000-0000-0000-0000-000000000004','ignored','termo',1,v_result);
  v_reopen := public.platform_sonar_resolve_result(
    '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
    (v_reopen->>'busca_id')::uuid);
  if v_reopen#>>'{consumo,classificacao}' <> 'reabertura' or v_reopen#>>'{payload,itens,0,id}' <> 'MLB1' then
    raise exception 'durable reopen after TTL did not preserve version 1';
  end if;
  if (select count(*) from public.platform_sonar_results where normalized_query='cafeteira') <> 2
    or (select count(*) from public.platform_sonar_deliveries where org_id='90000000-0000-0000-0000-000000000001'
      and result_id in (select id from public.platform_sonar_results where normalized_query='cafeteira')) <> 2 then
    raise exception 'versioned delivery history was not preserved';
  end if;
end $$;

do $$
declare v_begin jsonb; v_done jsonb; v_reopen jsonb; v_result uuid;
begin
  v_begin := public.platform_sonar_begin(
    '80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000005',
    'liquidificador','termo',1,null);
  v_done := public.platform_sonar_complete(
    '80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000001',(v_begin->>'busca_id')::uuid,(v_begin->>'lease_token')::uuid,
    '{"itens":[{"id":"MLB-D"}]}'::jsonb,null);
  if v_done#>>'{consumo,classificacao}' <> 'daludi' then raise exception 'Daludi was not exempt'; end if;
  v_result := (v_begin->>'resultado_id')::uuid;
  v_reopen := public.platform_sonar_begin(
    '80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000011',
    '',null,1,v_result);
  v_reopen := public.platform_sonar_resolve_result(
    '80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000001',(v_reopen->>'busca_id')::uuid);
  if v_reopen#>>'{consumo,classificacao}' <> 'daludi' then raise exception 'Daludi durable reopen failed'; end if;
  if exists(select 1 from public.platform_sonar_deliveries where result_id=v_result) then
    raise exception 'Daludi created client delivery';
  end if;

  v_begin := public.platform_sonar_begin(
    '80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000012',
    'batedeira','termo',1,null);
  update public.support_requests set status='revoked' where id='70000000-0000-0000-0000-000000000001';
  begin
    perform public.platform_sonar_complete(
      '80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000001',(v_begin->>'busca_id')::uuid,(v_begin->>'lease_token')::uuid,
      '{"itens":[{"id":"MLB-R"}]}'::jsonb,null);
    raise exception 'revoked support completed provider result';
  exception when insufficient_privilege then null;
  end;
  v_result := (v_begin->>'resultado_id')::uuid;
  if exists(select 1 from public.platform_sonar_deliveries where result_id=v_result) then
    raise exception 'Daludi created client delivery';
  end if;
end $$;

do $$
declare v_old jsonb; v_new jsonb;
begin
  v_old := public.platform_sonar_begin(
    '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
    '60000000-0000-0000-0000-000000000006','fritadeira','termo',1,null);
  update public.platform_sonar_results set lease_until=now()-interval '1 second' where id=(v_old->>'resultado_id')::uuid;
  v_new := public.platform_sonar_begin(
    '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
    '60000000-0000-0000-0000-000000000006','fritadeira','termo',1,null);
  if v_new->>'acao' <> 'collect' or v_new->>'resultado_id'<>v_old->>'resultado_id'
    or v_new->>'lease_token'=v_old->>'lease_token' then raise exception 'same request did not reclaim expired lease'; end if;
  begin
    perform public.platform_sonar_complete(
      '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
      (v_old->>'busca_id')::uuid,(v_old->>'lease_token')::uuid,'{"itens":[{"id":"MLB-O"}]}'::jsonb,null);
    raise exception 'stale worker completed result';
  exception when serialization_failure then null;
  end;
  if (public.platform_sonar_begin(
    '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
    '60000000-0000-0000-0000-000000000007','fritadeira','termo',1,null)->>'acao') <> 'pending' then
    raise exception 'second request bypassed reclaimed lease';
  end if;
end $$;

do $$
declare v_begin jsonb; v_failed jsonb;
begin
  v_begin := public.platform_sonar_begin(
    '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
    '60000000-0000-0000-0000-000000000013','sem resultado','termo',1,null);
  v_failed := public.platform_sonar_complete(
    '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
    (v_begin->>'busca_id')::uuid,(v_begin->>'lease_token')::uuid,'{"itens":[]}'::jsonb,null);
  if v_failed->>'acao' <> 'failed' then raise exception 'empty sample was accepted'; end if;
  if exists(select 1 from public.platform_sonar_deliveries where result_id=(v_begin->>'resultado_id')::uuid) then
    raise exception 'empty sample was billed';
  end if;
  if (public.platform_sonar_begin(
    '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
    '60000000-0000-0000-0000-000000000013','sem resultado','termo',1,null)->>'acao') <> 'failed' then
    raise exception 'failed request was not terminal';
  end if;
end $$;

do $$
declare v_owner jsonb; v_waiter jsonb;
begin
  v_owner := public.platform_sonar_begin(
    '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
    '60000000-0000-0000-0000-000000000014','panela eletrica','termo',1,null);
  v_waiter := public.platform_sonar_begin(
    '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
    '60000000-0000-0000-0000-000000000015','panela eletrica','termo',1,null);
  if v_owner->>'acao'<>'collect' or v_waiter->>'acao'<>'pending' then raise exception 'reclaim fixture invalid'; end if;
  update public.platform_sonar_results set lease_until=now()-interval '1 second'
    where id=(v_owner->>'resultado_id')::uuid;
end $$;

select dblink_connect('reclaim_1', format('dbname=%L user=supabase_admin', current_database()));
select dblink_connect('reclaim_2', format('dbname=%L user=supabase_admin', current_database()));
select dblink_exec('reclaim_1', $$set request.jwt.claims='{"role":"service_role"}'$$);
select dblink_exec('reclaim_2', $$set request.jwt.claims='{"role":"service_role"}'$$);
create temporary table sonar_reclaim(payload jsonb);
select dblink_send_query('reclaim_1', $$select public.platform_sonar_begin(
  '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
  '60000000-0000-0000-0000-000000000014','panela eletrica','termo',1,null)$$);
select dblink_send_query('reclaim_2', $$select public.platform_sonar_begin(
  '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
  '60000000-0000-0000-0000-000000000016','panela eletrica','termo',1,null)$$);
insert into sonar_reclaim select * from dblink_get_result('reclaim_1') as result(payload jsonb);
insert into sonar_reclaim select * from dblink_get_result('reclaim_2') as result(payload jsonb);
select dblink_disconnect('reclaim_1');
select dblink_disconnect('reclaim_2');

do $$
begin
  if (select count(*) from sonar_reclaim where payload->>'acao'='collect')<>1
    or (select count(*) from sonar_reclaim where payload->>'acao'='pending')<>1
    or (select count(distinct payload->>'resultado_id') from sonar_reclaim)<>1
    or (select count(*) from public.platform_sonar_results where normalized_query='panela eletrica')<>1 then
    raise exception 'expired lease race elected more than one collector/generation: %',
      (select jsonb_agg(payload) from sonar_reclaim);
  end if;
end $$;

select dblink_connect('sonar_1', format('dbname=%L user=supabase_admin', current_database()));
select dblink_connect('sonar_2', format('dbname=%L user=supabase_admin', current_database()));
select dblink_exec('sonar_1', $$set request.jwt.claims='{"role":"service_role"}'$$);
select dblink_exec('sonar_2', $$set request.jwt.claims='{"role":"service_role"}'$$);
create temporary table sonar_concurrent(payload jsonb);
select dblink_send_query('sonar_1', $$select public.platform_sonar_begin(
  '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
  '60000000-0000-0000-0000-000000000008','aspirador','termo',1,null)$$);
select dblink_send_query('sonar_2', $$select public.platform_sonar_begin(
  '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
  '60000000-0000-0000-0000-000000000009','aspirador','termo',1,null)$$);
insert into sonar_concurrent select * from dblink_get_result('sonar_1') as result(payload jsonb);
insert into sonar_concurrent select * from dblink_get_result('sonar_2') as result(payload jsonb);
select dblink_disconnect('sonar_1');
select dblink_disconnect('sonar_2');

do $$
declare v_collect jsonb; v_pending jsonb; v_done jsonb; v_resolved jsonb;
begin
  if (select count(*) from public.platform_sonar_results where normalized_query='aspirador') <> 1 then
    raise exception 'concurrent result duplicated';
  end if;
  if (select count(*) from sonar_concurrent where payload->>'acao'='collect') <> 1
    or (select count(*) from sonar_concurrent where payload->>'acao'='pending') <> 1 then
    raise exception 'concurrent requests did not elect one collector';
  end if;
  select payload into v_collect from sonar_concurrent where payload->>'acao'='collect';
  select payload into v_pending from sonar_concurrent where payload->>'acao'='pending';
  v_done := public.platform_sonar_complete(
    '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
    (v_collect->>'busca_id')::uuid,(v_collect->>'lease_token')::uuid,'{"itens":[{"id":"MLB-A"}]}'::jsonb,null);
  v_resolved := public.platform_sonar_resolve_result(
    '80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',null,
    (v_pending->>'busca_id')::uuid);
  if v_done#>>'{consumo,classificacao}' <> 'cliente' or v_resolved#>>'{consumo,classificacao}' <> 'reabertura'
    or (select count(*) from public.platform_sonar_deliveries where result_id=(v_collect->>'resultado_id')::uuid) <> 1 then
    raise exception 'concurrent delivery was not exactly once';
  end if;
end $$;
