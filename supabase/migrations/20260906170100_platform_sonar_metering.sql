create table public.platform_sonar_results (
  id uuid primary key default gen_random_uuid(),
  normalized_query text not null check (length(btrim(normalized_query)) >= 3),
  query_type text not null check (query_type in ('termo', 'ean')),
  schema_version integer not null check (schema_version > 0),
  generation integer not null check (generation > 0),
  payload jsonb,
  state text not null check (state in ('pending', 'ready', 'failed')),
  failure_reason text,
  valid_until timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_query, query_type, schema_version, generation),
  check ((state = 'ready' and payload is not null and valid_until is not null)
    or (state = 'pending' and lease_token is not null and lease_until is not null)
    or state = 'failed')
);

create table public.platform_sonar_searches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  support_request_id uuid references public.support_requests(id) on delete restrict,
  request_id uuid not null,
  intent_key text not null,
  normalized_query text not null,
  query_type text not null check (query_type in ('termo', 'ean')),
  result_id uuid references public.platform_sonar_results(id) on delete restrict,
  lease_token uuid,
  state text not null check (state in ('pending', 'completed', 'failed')),
  origin text not null check (origin in ('cliente', 'daludi')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (org_id, actor_id, request_id)
);

create table public.platform_sonar_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  search_id uuid not null references public.platform_sonar_searches(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  result_id uuid references public.platform_sonar_results(id) on delete restrict,
  stage text not null,
  outcome text not null,
  reason text,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table public.platform_sonar_deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  result_id uuid not null references public.platform_sonar_results(id) on delete restrict,
  search_id uuid not null references public.platform_sonar_searches(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  terms_id uuid references public.platform_commercial_terms(id) on delete restrict,
  month date not null check (month = date_trunc('month', month)::date),
  timezone text not null default 'America/Fortaleza' check (timezone = 'America/Fortaleza'),
  unit_cents bigint not null check (unit_cents between 0 and 9007199254740991),
  units smallint not null check (units in (0, 1)),
  total_cents bigint not null check (total_cents between 0 and 9007199254740991),
  reason text,
  delivered_at timestamptz not null default now(),
  unique (org_id, result_id),
  check (total_cents = unit_cents * units)
);

create index platform_sonar_searches_org_created_idx on public.platform_sonar_searches (org_id, created_at desc, id desc);
create index platform_sonar_events_org_occurred_idx on public.platform_sonar_events (org_id, occurred_at desc, id desc);
create index platform_sonar_deliveries_org_month_idx on public.platform_sonar_deliveries (org_id, month, delivered_at desc);

alter table public.platform_sonar_results enable row level security;
alter table public.platform_sonar_searches enable row level security;
alter table public.platform_sonar_events enable row level security;
alter table public.platform_sonar_deliveries enable row level security;
revoke all on public.platform_sonar_results, public.platform_sonar_searches,
  public.platform_sonar_events, public.platform_sonar_deliveries from anon, authenticated;

create function public.platform_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'platform ledger is append-only' using errcode='23514'; end;
$$;
create trigger platform_sonar_events_append_only before update or delete on public.platform_sonar_events
  for each row execute function public.platform_append_only();
create trigger platform_sonar_deliveries_append_only before update or delete on public.platform_sonar_deliveries
  for each row execute function public.platform_append_only();

create function public.platform_sonar_result_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' or old.state='ready' then
    raise exception 'ready sonar result is immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger platform_sonar_results_immutable before update or delete on public.platform_sonar_results
  for each row execute function public.platform_sonar_result_immutable();

create function public.platform_assert_sonar_context(
  p_actor uuid, p_org_id uuid, p_support_request uuid default null
) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare v_profile public.profiles%rowtype;
begin
  if public.platform_jwt_role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = p_actor and is_active;
  if not found then raise exception 'active actor required' using errcode = '42501'; end if;
  if v_profile.is_super_admin then
    if p_support_request is null or not exists (
      select 1 from public.support_requests s where s.id = p_support_request
        and s.requester_id = p_actor and s.org_id = p_org_id and s.status = 'active'
        and s.expires_at > now() and s.scope in ('read', 'full')
    ) then raise exception 'active support context required' using errcode = '42501'; end if;
  elsif v_profile.org_id is distinct from p_org_id or p_support_request is not null then
    raise exception 'organization context mismatch' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organizations o where o.id = p_org_id and 'pulse' = any(o.modulos_habilitados)
  ) then raise exception 'Pulse module unavailable' using errcode = '42501'; end if;
  return case when v_profile.is_super_admin then 'daludi' else 'cliente' end;
end;
$$;

create function public.platform_sonar_delivery_json(p_search public.platform_sonar_searches)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_existing public.platform_sonar_deliveries%rowtype;
declare v_terms public.platform_commercial_terms%rowtype;
declare v_month date := date_trunc('month', now() at time zone 'America/Fortaleza')::date;
declare v_inserted boolean := false;
begin
  if p_search.origin = 'daludi' then
    insert into public.platform_sonar_events(org_id,search_id,actor_id,result_id,stage,outcome,reason)
      values(p_search.org_id,p_search.id,p_search.actor_id,p_search.result_id,'delivery','exempt','daludi');
    return jsonb_build_object('classificacao','daludi','entrega_id',null,'unidades',0,'total_centavos',0);
  end if;
  select * into v_existing from public.platform_sonar_deliveries
    where org_id = p_search.org_id and result_id = p_search.result_id;
  if found then
    insert into public.platform_sonar_events(org_id,search_id,actor_id,result_id,stage,outcome,reason)
      values(p_search.org_id,p_search.id,p_search.actor_id,p_search.result_id,'delivery','exempt','reabertura');
    return jsonb_build_object('classificacao','reabertura','entrega_id',v_existing.id,'unidades',0,'total_centavos',0);
  end if;
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

create function public.platform_sonar_begin(
  p_actor uuid, p_org_id uuid, p_support_request uuid, p_request_id uuid,
  p_query text, p_query_type text, p_schema_version integer default 1,
  p_reopen_result uuid default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_origin text;
declare v_query text := lower(regexp_replace(btrim(coalesce(p_query,'')), '\s+', ' ', 'g'));
declare v_intent text;
declare v_search public.platform_sonar_searches%rowtype;
declare v_result public.platform_sonar_results%rowtype;
declare v_token uuid := gen_random_uuid();
declare v_created_search uuid;
declare v_generation integer;
begin
  v_origin := public.platform_assert_sonar_context(p_actor,p_org_id,p_support_request);
  if p_reopen_result is not null then
    select * into v_result from public.platform_sonar_results where id=p_reopen_result and state='ready';
    if not found or not (
      exists(select 1 from public.platform_sonar_deliveries d where d.org_id=p_org_id and d.result_id=p_reopen_result)
      or exists(select 1 from public.platform_sonar_searches s where s.org_id=p_org_id and s.result_id=p_reopen_result and s.state='completed')
    ) then
      raise exception 'result not available for organization' using errcode = '42501';
    end if;
    v_query := v_result.normalized_query;
    p_query_type := v_result.query_type;
    p_schema_version := v_result.schema_version;
  end if;
  if p_request_id is null or p_query_type not in ('termo','ean') or p_schema_version < 1 or length(v_query) < 3 then
    raise exception 'invalid sonar request' using errcode = '22023';
  end if;
  v_intent := case when p_reopen_result is null
    then 'query:'||p_query_type||':'||p_schema_version||':'||v_query
    else 'reopen:'||p_reopen_result::text end;
  perform pg_advisory_xact_lock(hashtextextended(p_query_type||':'||p_schema_version||':'||v_query,0));
  insert into public.platform_sonar_searches(
    org_id,actor_id,support_request_id,request_id,intent_key,normalized_query,query_type,state,origin
  ) values(p_org_id,p_actor,p_support_request,p_request_id,v_intent,v_query,p_query_type,'pending',v_origin)
  on conflict (org_id,actor_id,request_id) do nothing returning id into v_created_search;
  select * into v_search from public.platform_sonar_searches
    where org_id=p_org_id and actor_id=p_actor and request_id=p_request_id for update;
  if v_search.intent_key <> v_intent then
    raise exception 'request_id reused with different intent' using errcode = '22023';
  end if;
  if v_search.state = 'completed' then
    select * into v_result from public.platform_sonar_results where id=v_search.result_id;
    return jsonb_build_object('acao','ready','busca_id',v_search.id,'resultado_id',v_result.id,'payload',v_result.payload);
  end if;
  if v_created_search is null and v_search.result_id is not null then
    select * into v_result from public.platform_sonar_results where id=v_search.result_id;
    if v_result.state='ready' then
      return jsonb_build_object('acao','ready','busca_id',v_search.id,'resultado_id',v_result.id,'payload',v_result.payload);
    end if;
    if v_result.state='pending' and v_result.lease_until > now() then
      return jsonb_build_object('acao','pending','busca_id',v_search.id,'resultado_id',v_result.id);
    end if;
    if v_result.state='pending' then
      update public.platform_sonar_results set lease_token=v_token,lease_until=now()+interval '5 minutes',updated_at=now()
        where id=v_result.id returning * into v_result;
      update public.platform_sonar_searches set lease_token=v_token where id=v_search.id;
      insert into public.platform_sonar_events(org_id,search_id,actor_id,result_id,stage,outcome,reason)
        values(p_org_id,v_search.id,p_actor,v_result.id,'begin','collect','lease_reclaimed');
      return jsonb_build_object('acao','collect','busca_id',v_search.id,'resultado_id',v_result.id,'lease_token',v_token);
    end if;
    return jsonb_build_object('acao',v_result.state,'busca_id',v_search.id,'resultado_id',v_result.id);
  end if;
  if p_reopen_result is not null then
    update public.platform_sonar_searches set result_id=v_result.id where id=v_search.id;
    return jsonb_build_object('acao','ready','busca_id',v_search.id,'resultado_id',v_result.id,'payload',v_result.payload);
  end if;
  select * into v_result from public.platform_sonar_results
    where normalized_query=v_query and query_type=p_query_type and schema_version=p_schema_version
    order by generation desc limit 1;
  if v_result.state='ready' and v_result.valid_until > now() then
    update public.platform_sonar_searches set result_id=v_result.id where id=v_search.id;
    insert into public.platform_sonar_events(org_id,search_id,actor_id,result_id,stage,outcome,reason)
      values(p_org_id,v_search.id,p_actor,v_result.id,'begin','ready','durable_cache');
    return jsonb_build_object('acao','ready','busca_id',v_search.id,'resultado_id',v_result.id,'payload',v_result.payload);
  end if;
  if v_result.state='pending' and v_result.lease_until > now() then
    update public.platform_sonar_searches set result_id=v_result.id where id=v_search.id;
    return jsonb_build_object('acao','pending','busca_id',v_search.id,'resultado_id',v_result.id);
  end if;
  if v_result.state='pending' then
    update public.platform_sonar_results set lease_token=v_token,lease_until=now()+interval '5 minutes',updated_at=now()
      where id=v_result.id returning * into v_result;
    update public.platform_sonar_searches set result_id=v_result.id,lease_token=v_token where id=v_search.id;
    insert into public.platform_sonar_events(org_id,search_id,actor_id,result_id,stage,outcome,reason)
      values(p_org_id,v_search.id,p_actor,v_result.id,'begin','collect','lease_reclaimed');
    return jsonb_build_object('acao','collect','busca_id',v_search.id,'resultado_id',v_result.id,'lease_token',v_token);
  end if;
  v_generation := coalesce(v_result.generation,0)+1;
  insert into public.platform_sonar_results(
    normalized_query,query_type,schema_version,generation,state,lease_token,lease_until
  ) values(v_query,p_query_type,p_schema_version,v_generation,'pending',v_token,now()+interval '5 minutes')
  returning * into v_result;
  update public.platform_sonar_searches set result_id=v_result.id where id=v_search.id;
  update public.platform_sonar_searches set lease_token=v_token where id=v_search.id;
  insert into public.platform_sonar_events(org_id,search_id,actor_id,result_id,stage,outcome)
    values(p_org_id,v_search.id,p_actor,v_result.id,'begin','collect');
  return jsonb_build_object('acao','collect','busca_id',v_search.id,'resultado_id',v_result.id,'lease_token',v_token);
end;
$$;

create function public.platform_sonar_resolve_result(
  p_actor uuid, p_org_id uuid, p_support_request uuid, p_search_id uuid
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
  select * into v_result from public.platform_sonar_results where id=v_search.result_id;
  if v_result.state <> 'ready' then
    return jsonb_build_object('acao',v_result.state,'busca_id',v_search.id,'resultado_id',v_result.id);
  end if;
  v_consumption := public.platform_sonar_delivery_json(v_search);
  update public.platform_sonar_searches set state='completed',completed_at=coalesce(completed_at,now()) where id=v_search.id;
  return jsonb_build_object('acao','ready','busca_id',v_search.id,'resultado_id',v_result.id,
    'payload',v_result.payload,'consumo',v_consumption);
end;
$$;

create function public.platform_sonar_complete(
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
  select * into v_result from public.platform_sonar_results where id=v_search.result_id for update;
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

create function public.platform_sonar_get_payload(
  p_actor uuid, p_org_id uuid, p_support_request uuid, p_search_id uuid, p_result_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_payload jsonb;
begin
  perform public.platform_assert_sonar_context(p_actor,p_org_id,p_support_request);
  select r.payload into v_payload
  from public.platform_sonar_searches s
  join public.platform_sonar_results r on r.id=s.result_id and r.state='ready'
  where s.id=p_search_id and s.org_id=p_org_id and s.actor_id=p_actor
    and s.support_request_id is not distinct from p_support_request
    and s.result_id=p_result_id and s.state='completed';
  if not found then raise exception 'sonar correlation not available' using errcode='42501'; end if;
  return v_payload;
end;
$$;

create function public.platform_sonar_log_event(
  p_actor uuid, p_org_id uuid, p_support_request uuid, p_search_id uuid, p_result_id uuid,
  p_stage text, p_outcome text, p_reason text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  perform public.platform_assert_sonar_context(p_actor,p_org_id,p_support_request);
  if length(btrim(coalesce(p_stage,'')))=0 or length(btrim(coalesce(p_outcome,'')))=0
    or not exists(select 1 from public.platform_sonar_searches s where s.id=p_search_id and s.org_id=p_org_id
      and s.actor_id=p_actor and s.support_request_id is not distinct from p_support_request
      and s.result_id=p_result_id and s.state='completed') then
    raise exception 'invalid sonar event correlation' using errcode='42501';
  end if;
  insert into public.platform_sonar_events(org_id,search_id,actor_id,result_id,stage,outcome,reason)
    values(p_org_id,p_search_id,p_actor,p_result_id,btrim(p_stage),btrim(p_outcome),p_reason) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.platform_assert_sonar_context(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.platform_append_only() from public,anon,authenticated;
revoke all on function public.platform_sonar_result_immutable() from public,anon,authenticated;
revoke all on function public.platform_sonar_delivery_json(public.platform_sonar_searches) from public,anon,authenticated;
revoke all on function public.platform_sonar_begin(uuid,uuid,uuid,uuid,text,text,integer,uuid) from public,anon,authenticated;
revoke all on function public.platform_sonar_resolve_result(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.platform_sonar_complete(uuid,uuid,uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.platform_sonar_get_payload(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.platform_sonar_log_event(uuid,uuid,uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.platform_sonar_begin(uuid,uuid,uuid,uuid,text,text,integer,uuid) to service_role;
grant execute on function public.platform_sonar_resolve_result(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.platform_sonar_complete(uuid,uuid,uuid,uuid,uuid,jsonb,text) to service_role;
grant execute on function public.platform_sonar_get_payload(uuid,uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.platform_sonar_log_event(uuid,uuid,uuid,uuid,uuid,text,text,text) to service_role;
