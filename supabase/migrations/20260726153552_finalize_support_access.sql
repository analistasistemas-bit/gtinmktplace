begin;

create or replace function public.start_support_session(
  p_request_id uuid,
  p_requester_id uuid,
  p_now timestamptz
)
returns public.support_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new public.support_requests%rowtype;
  v_previous public.support_requests%rowtype;
  v_started public.support_requests%rowtype;
begin
  select *
  into v_new
  from public.support_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'support request not found';
  end if;
  if v_new.requester_id <> p_requester_id then
    raise exception 'support requester does not match';
  end if;
  if v_new.status <> 'approved'::public.support_status then
    raise exception 'support request is not approved';
  end if;
  if p_now < v_new.approved_at or p_now >= v_new.approval_expires_at then
    raise exception 'support approval is not valid';
  end if;

  if v_new.renewal_of is not null then
    select *
    into v_previous
    from public.support_requests
    where id = v_new.renewal_of
    for update;

    if not found then
      raise exception 'previous support session not found';
    end if;
    if v_previous.requester_id <> p_requester_id
       or v_previous.org_id <> v_new.org_id then
      raise exception 'previous support session does not match';
    end if;
    if v_previous.status <> 'active'::public.support_status
       or v_previous.expires_at <= p_now then
      raise exception 'previous support session is not active';
    end if;

    update public.support_requests
    set status = 'ended', ended_at = p_now
    where id = v_new.renewal_of and status = 'active';

    insert into public.support_audit_events (
      org_id, support_request_id, actor_id, event, result
    ) values (
      v_previous.org_id, v_previous.id, p_requester_id, 'session_ended', 'succeeded'
    );
  end if;

  update public.support_requests
  set status = 'active',
      started_at = p_now,
      expires_at = p_now + interval '2 hours'
  where id = p_request_id
  returning * into v_started;

  insert into public.support_audit_events (
    org_id, support_request_id, actor_id, event, result
  ) values (
    v_started.org_id, v_started.id, p_requester_id, 'session_started', 'succeeded'
  );

  return v_started;
end;
$$;

revoke execute on function public.start_support_session(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.start_support_session(uuid, uuid, timestamptz)
  to service_role;

create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid
    from cron.job
    where jobname = 'cleanup-support-audit-events'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end;
$$;

select cron.schedule(
  'cleanup-support-audit-events',
  '15 3 * * *',
  'select public.cleanup_support_audit_events();'
);

alter table public.profiles
  validate constraint profiles_identity_xor;

commit;
