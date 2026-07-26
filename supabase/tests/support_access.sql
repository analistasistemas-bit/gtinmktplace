-- Run locally after `supabase db reset`:
-- docker exec -i supabase_db_<project-ref> psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/support_access.sql
-- Everything, including the legacy migration fixture, is rolled back.
\set ON_ERROR_STOP on

begin;

insert into public.organizations (id, nome, slug) values
  ('90000000-0000-0000-0000-000000000001', 'Support test tenant', 'support-test-tenant'),
  ('90000000-0000-0000-0000-000000000002', 'Other support tenant', 'support-test-other');

-- Preserve the migration's validation state before the legacy-row fixture.
create temporary table support_access_xor_validation as
select convalidated
from pg_constraint
where conname = 'profiles_identity_xor'
  and conrelid = 'public.profiles'::regclass;

-- This is the one pre-existing hybrid row allowed while the XOR remains NOT VALID.
alter table public.profiles drop constraint profiles_identity_xor;
insert into auth.users (id, email, raw_user_meta_data) values
  ('90000000-0000-0000-0000-000000000101', 'legacy-support@test.local',
   '{"org_id":"90000000-0000-0000-0000-000000000001"}'::jsonb);
update public.profiles set is_super_admin = true
where id = '90000000-0000-0000-0000-000000000101';
alter table public.profiles add constraint profiles_identity_xor check (
  (is_super_admin and org_id is null) or (not is_super_admin and org_id is not null)
) not valid;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('90000000-0000-0000-0000-000000000102', 'support@test.local',
   '{"is_super_admin":true}'::jsonb, '{}'::jsonb),
  ('90000000-0000-0000-0000-000000000103', 'tenant-admin@test.local',
   '{}'::jsonb, '{"org_id":"90000000-0000-0000-0000-000000000001"}'::jsonb),
  ('90000000-0000-0000-0000-000000000105', 'other-support@test.local',
   '{"is_super_admin":true}'::jsonb, '{}'::jsonb);
update public.profiles set is_admin = true
where id = '90000000-0000-0000-0000-000000000103';

-- The legacy hybrid keeps its original tenant until it is demoted.
set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-0000-0000-000000000101';
do $$
begin
  if public.current_org_id() <> '90000000-0000-0000-0000-000000000001'::uuid
     or not public.can_write_current_org() then
    raise exception 'legacy profile lost its tenant during transition';
  end if;
end;
$$;
reset role;

-- A new platform identity has neither tenant nor write access before approval.
set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-0000-0000-000000000102';
do $$
begin
  if public.current_org_id() is not null or public.can_write_current_org() then
    raise exception 'support resolved a tenant without a session';
  end if;
end;
$$;
reset role;

insert into public.support_requests (id, requester_id, org_id, scope, reason) values
  ('90000000-0000-0000-0000-000000000201',
   '90000000-0000-0000-0000-000000000102',
   '90000000-0000-0000-0000-000000000001', 'read', 'transactional RLS test');

-- The three duration ceilings are database constraints, not only API rules.
do $$
begin
  begin
    update public.support_requests
    set pending_expires_at = created_at + interval '24 hours 1 second'
    where id = '90000000-0000-0000-0000-000000000201';
    raise exception using errcode = 'P0001', message = 'pending duration accepted';
  exception when check_violation then null;
  end;
  begin
    update public.support_requests
    set status = 'approved', decided_by = '90000000-0000-0000-0000-000000000103',
        approved_at = now(), approval_expires_at = now() + interval '1 hour 1 second'
    where id = '90000000-0000-0000-0000-000000000201';
    raise exception using errcode = 'P0001', message = 'approval duration accepted';
  exception when check_violation then null;
  end;
end;
$$;

update public.support_requests
set status = 'active', decided_by = '90000000-0000-0000-0000-000000000103',
    approved_at = now(), approval_expires_at = now() + interval '1 hour',
    started_at = now(), expires_at = now() + interval '2 hours'
where id = '90000000-0000-0000-0000-000000000201';

-- Read resolves the tenant but RLS rejects a mutation.
set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-0000-0000-000000000102';
do $$
begin
  if public.current_org_id() <> '90000000-0000-0000-0000-000000000001'::uuid
     or public.can_write_current_org() then
    raise exception 'read support context is incorrect';
  end if;
  begin
    insert into public.lotes (user_id, status)
    values ('90000000-0000-0000-0000-000000000102', 'importando');
    raise exception using errcode = 'P0001', message = 'read support wrote a lote';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Full support writes, but cannot exceed the two-hour active-session ceiling.
update public.support_requests set scope = 'full'
where id = '90000000-0000-0000-0000-000000000201';
do $$
begin
  begin
    update public.support_requests
    set expires_at = started_at + interval '2 hours 1 second'
    where id = '90000000-0000-0000-0000-000000000201';
    raise exception using errcode = 'P0001', message = 'active duration accepted';
  exception when check_violation then null;
  end;
end;
$$;
set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-0000-0000-000000000102';
do $$
begin
  if public.current_org_id() <> '90000000-0000-0000-0000-000000000001'::uuid
     or not public.can_write_current_org() then
    raise exception 'full support context is incorrect';
  end if;
  insert into public.lotes (user_id, status)
  values ('90000000-0000-0000-0000-000000000102', 'importando');
end;
$$;
reset role;

-- An audit row must belong to the same organization as its request.
do $$
begin
  begin
    insert into public.support_audit_events (org_id, support_request_id, event, result)
    values ('90000000-0000-0000-0000-000000000002',
            '90000000-0000-0000-0000-000000000201', 'operation', 'succeeded');
    raise exception using errcode = 'P0001', message = 'cross-tenant audit accepted';
  exception when foreign_key_violation then null;
  end;
end;
$$;
insert into public.support_audit_events (org_id, support_request_id, actor_id, event, result)
values ('90000000-0000-0000-0000-000000000001',
        '90000000-0000-0000-0000-000000000201',
        '90000000-0000-0000-0000-000000000103', 'operation', 'succeeded');

set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-0000-0000-000000000103';
do $$
begin
  if (select count(*) from public.support_audit_events) <> 1 then
    raise exception 'tenant admin did not receive exactly its audit history';
  end if;
end;
$$;
reset role;

update public.support_requests
set status = 'revoked', revoked_by = '90000000-0000-0000-0000-000000000103', revoked_at = now()
where id = '90000000-0000-0000-0000-000000000201';

set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-0000-0000-000000000102';
do $$
begin
  if public.current_org_id() is not null or public.can_write_current_org() then
    raise exception 'revoked support retained access';
  end if;
end;
$$;
reset role;

-- Starting an approved renewal must atomically end the predecessor.
insert into public.support_requests (
  id, requester_id, org_id, scope, reason, status, decided_by,
  approved_at, approval_expires_at, started_at, expires_at
) values (
  '90000000-0000-0000-0000-000000000204',
  '90000000-0000-0000-0000-000000000102',
  '90000000-0000-0000-0000-000000000001', 'full', 'original renewal session', 'active',
  '90000000-0000-0000-0000-000000000103',
  '2026-07-25 11:30:00+00', '2026-07-25 12:30:00+00',
  '2026-07-25 11:30:00+00', '2026-07-25 12:15:00+00'
), (
  '90000000-0000-0000-0000-000000000202',
  '90000000-0000-0000-0000-000000000102',
  '90000000-0000-0000-0000-000000000001', 'full', 'approved renewal', 'approved',
  '90000000-0000-0000-0000-000000000103',
  '2026-07-25 11:30:00+00', '2026-07-25 12:30:00+00', null, null
);
update public.support_requests
set renewal_of = '90000000-0000-0000-0000-000000000204'
where id = '90000000-0000-0000-0000-000000000202';

-- The session state and both audit rows roll back together.
do $$
begin
  begin
    perform public.start_support_session(
      '90000000-0000-0000-0000-000000000202',
      '90000000-0000-0000-0000-000000000102',
      '2026-07-25 12:00:00+00'
    );
    raise exception 'force renewal rollback';
  exception when others then
    null;
  end;
  if (select status from public.support_requests where id = '90000000-0000-0000-0000-000000000204') <> 'active'
     or (select status from public.support_requests where id = '90000000-0000-0000-0000-000000000202') <> 'approved' then
    raise exception 'renewal rollback changed session state';
  end if;
  if exists (select 1 from public.support_audit_events
             where support_request_id in (
               '90000000-0000-0000-0000-000000000204',
               '90000000-0000-0000-0000-000000000202'
             ) and event in ('session_ended', 'session_started')) then
    raise exception 'renewal rollback left audit events';
  end if;
end;
$$;

select public.start_support_session(
  '90000000-0000-0000-0000-000000000202',
  '90000000-0000-0000-0000-000000000102',
  '2026-07-25 12:00:00+00'
);

do $$
begin
  if (select status from public.support_requests where id = '90000000-0000-0000-0000-000000000204') <> 'ended' then
    raise exception 'renewal did not end the original session';
  end if;
  if (select status from public.support_requests where id = '90000000-0000-0000-0000-000000000202') <> 'active' then
    raise exception 'approved renewal did not become active';
  end if;
  if (select count(*) from public.support_requests
      where requester_id = '90000000-0000-0000-0000-000000000102' and status = 'active') <> 1 then
    raise exception 'renewal left an invalid number of active sessions';
  end if;
  if (select expires_at <> started_at + interval '2 hours'
      from public.support_requests where id = '90000000-0000-0000-0000-000000000202') then
    raise exception 'renewal did not receive the two-hour session duration';
  end if;
  if not exists (select 1 from public.support_audit_events
                 where support_request_id = '90000000-0000-0000-0000-000000000204'
                   and event = 'session_ended') then
    raise exception 'renewal did not audit session_ended';
  end if;
  if not exists (select 1 from public.support_audit_events
                 where support_request_id = '90000000-0000-0000-0000-000000000202'
                   and event = 'session_started') then
    raise exception 'renewal did not audit session_started';
  end if;
end;
$$;

-- A cross-tenant renewal fails without changing either request.
insert into public.support_requests (
  id, requester_id, org_id, scope, reason, status, renewal_of, decided_by,
  approved_at, approval_expires_at
) values (
  '90000000-0000-0000-0000-000000000203',
  '90000000-0000-0000-0000-000000000102',
  '90000000-0000-0000-0000-000000000002', 'full', 'cross-tenant renewal', 'approved',
  '90000000-0000-0000-0000-000000000202',
  '90000000-0000-0000-0000-000000000103',
  '2026-07-25 12:00:00+00', '2026-07-25 13:00:00+00'
);
do $$
declare v_failed boolean := false; v_audit_count bigint;
begin
  select count(*) into v_audit_count from public.support_audit_events
  where support_request_id in (
    '90000000-0000-0000-0000-000000000202',
    '90000000-0000-0000-0000-000000000203'
  );
  begin
    perform public.start_support_session(
      '90000000-0000-0000-0000-000000000203',
      '90000000-0000-0000-0000-000000000102',
      '2026-07-25 12:01:00+00'
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'cross-tenant renewal started';
  end if;
  if (select status from public.support_requests where id = '90000000-0000-0000-0000-000000000202') <> 'active' then
    raise exception 'failed renewal changed the original session';
  end if;
  if (select status from public.support_requests where id = '90000000-0000-0000-0000-000000000203') <> 'approved' then
    raise exception 'failed renewal changed the approved request';
  end if;
  if (select count(*) from public.support_audit_events
      where support_request_id in (
        '90000000-0000-0000-0000-000000000202',
        '90000000-0000-0000-0000-000000000203'
      )) <> v_audit_count then
    raise exception 'failed renewal changed audit history';
  end if;
end;
$$;

-- A renewal cannot take over another support user's session in the same tenant.
insert into public.support_requests (
  id, requester_id, org_id, scope, reason, status, renewal_of, decided_by,
  approved_at, approval_expires_at
) values (
  '90000000-0000-0000-0000-000000000205',
  '90000000-0000-0000-0000-000000000105',
  '90000000-0000-0000-0000-000000000001', 'full', 'other requester renewal', 'approved',
  '90000000-0000-0000-0000-000000000202',
  '90000000-0000-0000-0000-000000000103',
  '2026-07-25 12:00:00+00', '2026-07-25 13:00:00+00'
);
do $$
declare v_failed boolean := false; v_audit_count bigint;
begin
  select count(*) into v_audit_count from public.support_audit_events
  where support_request_id in (
    '90000000-0000-0000-0000-000000000202',
    '90000000-0000-0000-0000-000000000205'
  );
  begin
    perform public.start_support_session(
      '90000000-0000-0000-0000-000000000205',
      '90000000-0000-0000-0000-000000000105',
      '2026-07-25 12:02:00+00'
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'cross-requester renewal started';
  end if;
  if (select status from public.support_requests where id = '90000000-0000-0000-0000-000000000202') <> 'active' then
    raise exception 'cross-requester renewal changed the original session';
  end if;
  if (select status from public.support_requests where id = '90000000-0000-0000-0000-000000000205') <> 'approved' then
    raise exception 'cross-requester renewal changed the approved request';
  end if;
  if (select count(*) from public.support_audit_events
      where support_request_id in (
        '90000000-0000-0000-0000-000000000202',
        '90000000-0000-0000-0000-000000000205'
      )) <> v_audit_count then
    raise exception 'cross-requester renewal changed audit history';
  end if;
end;
$$;

-- Retention removes only old events without a legal hold.
insert into public.support_audit_events (
  org_id, support_request_id, actor_id, event, target_type, target_id, result, legal_hold, created_at
) values
  ('90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000202',
   '90000000-0000-0000-0000-000000000103', 'operation', 'retention', 'expired', 'succeeded', false,
   now() - interval '1 year 1 second'),
  ('90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000202',
   '90000000-0000-0000-0000-000000000103', 'operation', 'retention', 'recent', 'succeeded', false, now()),
  ('90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000202',
   '90000000-0000-0000-0000-000000000103', 'operation', 'retention', 'held', 'succeeded', true,
   now() - interval '1 year 1 second');
select public.cleanup_support_audit_events();
do $$
begin
  if exists (select 1 from public.support_audit_events where target_id = 'expired') then
    raise exception 'retention did not remove the old event';
  end if;
  if (select count(*) from public.support_audit_events where target_id in ('recent', 'held')) <> 2 then
    raise exception 'retention removed a recent or legally held event';
  end if;
  if not exists (select 1 from public.profiles
                 where id = '90000000-0000-0000-0000-000000000102'
                   and is_active and is_super_admin and org_id is null) then
    raise exception 'super-admin identity violates XOR semantics';
  end if;
  if not exists (select 1 from public.profiles
                 where id = '90000000-0000-0000-0000-000000000103'
                   and is_active and not is_super_admin
                   and org_id = '90000000-0000-0000-0000-000000000001') then
    raise exception 'tenant member identity violates XOR semantics';
  end if;
  begin
    update public.profiles set org_id = '90000000-0000-0000-0000-000000000001'
    where id = '90000000-0000-0000-0000-000000000102';
    raise exception using errcode = 'P0001', message = 'XOR accepted super-admin tenant identity';
  exception when check_violation then null;
  end;
  begin
    update public.profiles set org_id = null
    where id = '90000000-0000-0000-0000-000000000103';
    raise exception using errcode = 'P0001', message = 'XOR accepted tenant member without organization';
  exception when check_violation then null;
  end;
  if not coalesce((select convalidated from support_access_xor_validation), false) then
    raise exception 'profiles_identity_xor is not validated';
  end if;
  if (select count(*) from cron.job where jobname = 'cleanup-support-audit-events' and active) <> 1 then
    raise exception 'cleanup-support-audit-events job is not active exactly once';
  end if;
end;
$$;

-- Requester visibility also requires an active profile.
update public.profiles set is_active = false
where id = '90000000-0000-0000-0000-000000000102';
set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-0000-0000-000000000102';
do $$
begin
  if exists (select 1 from public.support_requests) then
    raise exception 'inactive requester can still read support requests';
  end if;
end;
$$;

rollback;
