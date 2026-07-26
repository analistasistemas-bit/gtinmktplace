-- Run locally after `supabase db reset`:
-- docker exec -i supabase_db_<project-ref> psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/support_access.sql
-- Everything, including the legacy migration fixture, is rolled back.
\set ON_ERROR_STOP on

begin;

insert into public.organizations (id, nome, slug) values
  ('90000000-0000-0000-0000-000000000001', 'Support test tenant', 'support-test-tenant'),
  ('90000000-0000-0000-0000-000000000002', 'Other support tenant', 'support-test-other');

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
   '{}'::jsonb, '{"org_id":"90000000-0000-0000-0000-000000000001"}'::jsonb);
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
