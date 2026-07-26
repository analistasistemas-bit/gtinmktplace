-- ADR-0092 — identidade Daludi sem tenant permanente e suporte temporário.
-- A máquina de estados é alterada apenas por backend/service_role; RLS só expõe
-- leitura autorizada ao cliente e mantém o isolamento caso a UI seja burlada.

-- Identidade: membros pertencem a um tenant; super-admins não. NOT VALID mantém
-- a conta super-admin legada operável para a migração controlada do ADR-0092,
-- mas já rejeita qualquer INSERT/UPDATE novo que viole o XOR.
alter table public.profiles alter column org_id drop not null;
alter table public.profiles drop constraint if exists profiles_identity_xor;
alter table public.profiles
  add constraint profiles_identity_xor
  check (
    (is_super_admin and org_id is null)
    or (not is_super_admin and org_id is not null)
  ) not valid;

-- Somente app_metadata é controlado pelo servidor; raw_user_meta_data é editável
-- pelo usuário e nunca pode conceder administração da plataforma.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, nome, allowed_menus, is_super_admin, org_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    coalesce(
      array(select jsonb_array_elements_text(new.raw_user_meta_data->'allowed_menus')),
      '{}'::text[]
    ),
    coalesce(new.raw_app_meta_data->>'is_super_admin', 'false') = 'true',
    (new.raw_user_meta_data->>'org_id')::uuid
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

alter table public.organizations
  add column if not exists is_test boolean not null default false;
update public.organizations set is_test = true where slug = 'diego-souza';

create type public.support_scope as enum ('read', 'full');
create type public.support_status as enum (
  'pending', 'approved', 'active', 'rejected', 'cancelled', 'expired', 'revoked', 'ended'
);
create type public.support_audit_event as enum (
  'request_created', 'request_cancelled', 'request_approved', 'request_rejected',
  'session_started', 'session_ended', 'session_expired', 'session_revoked',
  'renewal_requested', 'operation', 'notification_delivery_failed'
);
create type public.support_audit_result as enum ('succeeded', 'failed', 'denied');

create table public.support_requests (
  id                  uuid primary key default gen_random_uuid(),
  requester_id        uuid not null references public.profiles(id) on delete restrict,
  org_id              uuid not null references public.organizations(id) on delete restrict,
  scope               public.support_scope not null,
  reason              text not null check (char_length(btrim(reason)) between 1 and 1000),
  status              public.support_status not null default 'pending',
  renewal_of          uuid references public.support_requests(id) on delete set null,
  decided_by          uuid references public.profiles(id) on delete set null,
  revoked_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  pending_expires_at  timestamptz not null default (now() + interval '24 hours'),
  approved_at         timestamptz,
  approval_expires_at timestamptz,
  started_at          timestamptz,
  expires_at          timestamptz,
  rejected_at         timestamptz,
  cancelled_at        timestamptz,
  expired_at          timestamptz,
  revoked_at          timestamptz,
  ended_at            timestamptz,
  constraint support_requests_pending_after_created_chk
    check (
      pending_expires_at > created_at
      and pending_expires_at <= created_at + interval '24 hours'
    ),
  constraint support_requests_maximum_windows_chk
    check (
      (approval_expires_at is null or approval_expires_at <= approved_at + interval '1 hour')
      and (expires_at is null or expires_at <= started_at + interval '2 hours')
    ),
  constraint support_requests_state_timestamps_chk check (
    (status = 'pending'
      and decided_by is null and revoked_by is null
      and approved_at is null and approval_expires_at is null and started_at is null
      and expires_at is null and rejected_at is null and cancelled_at is null
      and expired_at is null and revoked_at is null and ended_at is null)
    or (status = 'approved'
      and decided_by is not null and approved_at is not null
      and approval_expires_at > approved_at and started_at is null and expires_at is null
      and rejected_at is null and cancelled_at is null and expired_at is null
      and revoked_by is null and revoked_at is null and ended_at is null)
    or (status = 'active'
      and decided_by is not null and approved_at is not null and approval_expires_at is not null
      and started_at is not null and expires_at > started_at and started_at <= approval_expires_at
      and rejected_at is null and cancelled_at is null and expired_at is null
      and revoked_by is null and revoked_at is null and ended_at is null)
    or (status = 'rejected'
      and decided_by is not null and rejected_at is not null
      and approved_at is null and approval_expires_at is null and started_at is null
      and expires_at is null and cancelled_at is null and expired_at is null
      and revoked_by is null and revoked_at is null and ended_at is null)
    or (status = 'cancelled'
      and cancelled_at is not null and decided_by is null and revoked_by is null
      and approved_at is null and approval_expires_at is null and started_at is null
      and expires_at is null and rejected_at is null and expired_at is null
      and revoked_at is null and ended_at is null)
    or (status = 'expired' and expired_at is not null and rejected_at is null
      and cancelled_at is null and revoked_by is null and revoked_at is null and ended_at is null
      and (
        (decided_by is null and approved_at is null and approval_expires_at is null
          and started_at is null and expires_at is null)
        or (decided_by is not null and approved_at is not null and approval_expires_at > approved_at
          and started_at is null and expires_at is null)
        or (decided_by is not null and approved_at is not null and approval_expires_at is not null
          and started_at is not null and expires_at > started_at and started_at <= approval_expires_at)
      ))
    or (status = 'revoked'
      and decided_by is not null and approved_at is not null and approval_expires_at is not null
      and started_at is not null and expires_at > started_at and started_at <= approval_expires_at
      and revoked_by is not null and revoked_at is not null
      and rejected_at is null and cancelled_at is null and expired_at is null and ended_at is null)
    or (status = 'ended'
      and decided_by is not null and approved_at is not null and approval_expires_at is not null
      and started_at is not null and expires_at > started_at and started_at <= approval_expires_at
      and ended_at is not null and rejected_at is null and cancelled_at is null
      and expired_at is null and revoked_by is null and revoked_at is null)
  )
);
alter table public.support_requests enable row level security;
alter table public.support_requests
  add constraint support_requests_id_org_id_key unique (id, org_id);

create trigger support_requests_set_updated_at
  before update on public.support_requests
  for each row execute procedure extensions.moddatetime(updated_at);

-- Uma pendência por solicitante+tenant; e uma única sessão em qualquer tenant.
create unique index support_requests_one_pending_per_requester_org_idx
  on public.support_requests (requester_id, org_id) where status = 'pending';
create unique index support_requests_one_active_per_requester_idx
  on public.support_requests (requester_id) where status = 'active';
create index support_requests_org_status_created_idx
  on public.support_requests (org_id, status, created_at desc);
create index support_requests_requester_created_idx
  on public.support_requests (requester_id, created_at desc);

create table public.support_audit_events (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null,
  support_request_id uuid not null,
  actor_id           uuid references public.profiles(id) on delete set null,
  event              public.support_audit_event not null,
  target_type        text,
  target_id          text,
  result             public.support_audit_result not null,
  legal_hold         boolean not null default false,
  created_at         timestamptz not null default now(),
  constraint support_audit_events_target_pair_chk
    check ((target_type is null and target_id is null) or (target_type is not null and target_id is not null)),
  constraint support_audit_events_target_type_chk
    check (target_type is null or char_length(btrim(target_type)) between 1 and 100),
  constraint support_audit_events_target_id_chk
    check (target_id is null or char_length(btrim(target_id)) between 1 and 200),
  constraint support_audit_events_request_org_fk
    foreign key (support_request_id, org_id)
    references public.support_requests (id, org_id) on delete restrict
);
alter table public.support_audit_events enable row level security;

create index support_audit_events_org_created_idx
  on public.support_audit_events (org_id, created_at desc);
create index support_audit_events_request_created_idx
  on public.support_audit_events (support_request_id, created_at desc);
create index support_audit_events_retention_idx
  on public.support_audit_events (created_at) where not legal_hold;

-- Sessão temporária: o perfil do super-admin continua sem org_id permanente.
create or replace function public.current_org_id()
returns uuid language sql security definer stable set search_path = '' as $$
  select p.org_id
  from public.profiles p
  where p.id = (select auth.uid())
    and p.is_active
    and p.org_id is not null
  union all
  select sr.org_id
  from public.support_requests sr
  join public.profiles p on p.id = sr.requester_id
  where sr.requester_id = (select auth.uid())
    and p.is_active
    and p.is_super_admin
    and sr.status = 'active'
    and sr.expires_at > now()
  limit 1
$$;
revoke all on function public.current_org_id() from public, anon;
grant execute on function public.current_org_id() to authenticated;

create or replace function public.current_support_scope()
returns public.support_scope language sql security definer stable set search_path = '' as $$
  select sr.scope
  from public.support_requests sr
  join public.profiles p on p.id = sr.requester_id
  where sr.requester_id = (select auth.uid())
    and p.is_active
    and p.is_super_admin
    and sr.status = 'active'
    and sr.expires_at > now()
  limit 1
$$;
revoke all on function public.current_support_scope() from public, anon;
grant execute on function public.current_support_scope() to authenticated;

create or replace function public.can_write_current_org()
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active
      and p.org_id is not null
  )
  or coalesce(
    (select public.current_support_scope()) = 'full'::public.support_scope,
    false
  )
$$;
revoke all on function public.can_write_current_org() from public, anon;
grant execute on function public.can_write_current_org() to authenticated;

-- Platform admins see tenant metadata only; they still need an active support
-- session before any operational policy can resolve an organization.
create policy "organizations: select platform" on public.organizations
  for select to authenticated using (public.is_super_admin());

-- Solicitações são lidas pelo solicitante ou por admin ativo do próprio tenant.
-- Todas as transições permanecem na Edge Function com service_role.
revoke all on table public.support_requests from anon, authenticated;
grant select on table public.support_requests to authenticated;
grant select, insert, update, delete on table public.support_requests to service_role;
create policy "support_requests: select requester or tenant admin" on public.support_requests
  for select to authenticated using (
    requester_id = (select auth.uid())
    and public.is_super_admin()
    or (
      org_id = (select public.current_org_id())
      and public.is_admin()
    )
  );

-- A auditoria não recebe payload livre; somente workers/service_role a escrevem.
revoke all on table public.support_audit_events from anon, authenticated;
grant select on table public.support_audit_events to authenticated;
grant select, insert, update, delete on table public.support_audit_events to service_role;
create policy "support_audit_events: select tenant admin" on public.support_audit_events
  for select to authenticated using (
    org_id = (select public.current_org_id()) and public.is_admin()
  );

-- RLS de escrita operacional: SELECT continua limitado por current_org_id();
-- mutações exigem um membro normal ou suporte full ainda vigente.
do $$
declare t text;
begin
  foreach t in array array['lotes', 'familias', 'variacoes', 'anuncios_externos'] loop
    execute format('drop policy if exists "%s: insert org" on public.%I', t, t);
    execute format('drop policy if exists "%s: update org" on public.%I', t, t);
    execute format('drop policy if exists "%s: delete org" on public.%I', t, t);
    execute format('create policy "%s: insert org writable" on public.%I for insert to authenticated with check (org_id = (select public.current_org_id()) and (select public.can_write_current_org()))', t, t);
    execute format('create policy "%s: update org writable" on public.%I for update to authenticated using (org_id = (select public.current_org_id()) and (select public.can_write_current_org())) with check (org_id = (select public.current_org_id()) and (select public.can_write_current_org()))', t, t);
    execute format('create policy "%s: delete org writable" on public.%I for delete to authenticated using (org_id = (select public.current_org_id()) and (select public.can_write_current_org()))', t, t);
  end loop;
end
$$;

-- As policies acima só são alcançáveis com os verbos mínimos concedidos ao
-- cliente autenticado; RLS continua decidindo a linha e o escopo permitidos.
grant select, insert, update, delete on public.lotes, public.familias,
  public.variacoes, public.anuncios_externos to authenticated;

drop policy if exists "configuracoes: insert admin org" on public.configuracoes;
drop policy if exists "configuracoes: update admin org" on public.configuracoes;
create policy "configuracoes: insert admin org writable" on public.configuracoes
  for insert to authenticated
  with check (
    org_id = (select public.current_org_id())
    and (select public.can_write_current_org())
    and (public.is_admin() or (select public.current_support_scope()) = 'full'::public.support_scope)
  );
create policy "configuracoes: update admin org writable" on public.configuracoes
  for update to authenticated
  using (
    org_id = (select public.current_org_id())
    and (select public.can_write_current_org())
    and (public.is_admin() or (select public.current_support_scope()) = 'full'::public.support_scope)
  )
  with check (
    org_id = (select public.current_org_id())
    and (select public.can_write_current_org())
    and (public.is_admin() or (select public.current_support_scope()) = 'full'::public.support_scope)
  );
grant select, insert, update on public.configuracoes to authenticated;

-- Support lê os dados de mensagens do tenant durante a sessão, preservando a
-- privacidade user_id->user_id para todos os membros regulares.
drop policy if exists "ml_mensagens: select own" on public.ml_mensagens;
create policy "ml_mensagens: select own or support org" on public.ml_mensagens
  for select to authenticated using (
    user_id = (select auth.uid())
    or (
      org_id = (select public.current_org_id())
      and (select public.current_support_scope()) is not null
    )
  );

-- Storage aceita o layout legado {user_id}/... e o novo {org_id}/... .
drop policy if exists "imagens: select org" on storage.objects;
drop policy if exists "imagens: insert own" on storage.objects;
drop policy if exists "imagens: update own" on storage.objects;
drop policy if exists "imagens: delete own" on storage.objects;
create policy "imagens: select org" on storage.objects
  for select to authenticated using (
    bucket_id = 'imagens'
    and (
      (storage.foldername(name))[1] = (select public.current_org_id())::text
      or exists (
        select 1 from public.profiles p
        where p.id::text = (storage.foldername(name))[1]
          and p.org_id = (select public.current_org_id())
      )
    )
  );
create policy "imagens: insert org writable" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'imagens'
    and (select public.can_write_current_org())
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (storage.foldername(name))[1] = (select public.current_org_id())::text
    )
  );
create policy "imagens: update org writable" on storage.objects
  for update to authenticated using (
    bucket_id = 'imagens'
    and (select public.can_write_current_org())
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (storage.foldername(name))[1] = (select public.current_org_id())::text
    )
  ) with check (
    bucket_id = 'imagens'
    and (select public.can_write_current_org())
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (storage.foldername(name))[1] = (select public.current_org_id())::text
    )
  );
create policy "imagens: delete org writable" on storage.objects
  for delete to authenticated using (
    bucket_id = 'imagens'
    and (select public.can_write_current_org())
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (storage.foldername(name))[1] = (select public.current_org_id())::text
    )
  );

-- RPCs mutáveis expostas ao cliente também verificam o escopo antes de executar
-- como SECURITY DEFINER, impedindo que suporte read contorne RLS por RPC.
create or replace function public.registrar_saque_ml_vendas(p_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_count integer;
begin
  v_org := public.current_org_id();
  if v_org is null or not public.can_write_current_org() then raise exception 'not allowed'; end if;
  update public.ml_vendas set sacado_em = now(), sacado_por = auth.uid(), atualizado_em = now()
  where id = any(p_ids) and org_id = v_org and money_release_date is not null
    and money_release_date <= now() and sacado_em is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.desfazer_saque_ml_vendas(p_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_count integer;
begin
  v_org := public.current_org_id();
  if v_org is null or not public.can_write_current_org() then raise exception 'not allowed'; end if;
  update public.ml_vendas set sacado_em = null, sacado_por = null, atualizado_em = now()
  where id = any(p_ids) and org_id = v_org and sacado_em is not null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.marcar_mensagens_lidas(p_pack_id text)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not public.can_write_current_org() then raise exception 'not allowed'; end if;
  update public.ml_mensagens set lida = true, atualizado_em = now()
  where user_id = auth.uid() and pack_id = p_pack_id and direcao = 'recebida' and lida = false;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.marcar_notificacoes_lidas(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not public.can_write_current_org() then raise exception 'not allowed'; end if;
  update public.notificacoes set lida = true
  where user_id = auth.uid() and lida = false and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.registrar_saque_ml_vendas(uuid[]) from public, anon;
revoke all on function public.desfazer_saque_ml_vendas(uuid[]) from public, anon;
revoke all on function public.marcar_mensagens_lidas(text) from public, anon;
revoke all on function public.marcar_notificacoes_lidas(uuid[]) from public, anon;
grant execute on function public.registrar_saque_ml_vendas(uuid[]) to authenticated;
grant execute on function public.desfazer_saque_ml_vendas(uuid[]) to authenticated;
grant execute on function public.marcar_mensagens_lidas(text) to authenticated;
grant execute on function public.marcar_notificacoes_lidas(uuid[]) to authenticated;

-- O agendador chama esta função como service_role. Eventos em legal_hold nunca
-- entram no DELETE, mesmo após o prazo normal de retenção de um ano.
create or replace function public.cleanup_support_audit_events()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_deleted integer;
begin
  delete from public.support_audit_events
  where created_at < now() - interval '1 year' and not legal_hold;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.cleanup_support_audit_events() from public, anon, authenticated;
grant execute on function public.cleanup_support_audit_events() to service_role;
