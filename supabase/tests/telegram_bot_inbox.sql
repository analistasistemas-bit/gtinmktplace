\set ON_ERROR_STOP on
-- ADR-0190 D-8: telegram_updates (PK/CHECK), lease CAS das RPCs e trigger de configuracoes.telegram_bot_id.
-- Fixtures dentro da transação desfeita; o trigger usa um admin real (RLS de configuracoes).
begin;
insert into public.organizations (id, nome, slug) values
  ('98000000-0000-0000-0000-000000000001', 'Bot inbox test', 'bot-inbox-test');

do $$
declare
  o constant uuid := '98000000-0000-0000-0000-000000000001';
  t0 constant timestamptz := '2026-10-25 12:00:00+00';
  r public.telegram_updates; n integer; lease_a uuid; lease_b uuid; ok boolean;
begin
  -- 1) PK (bot, update) e CHECK de status.
  insert into public.telegram_updates (bot_id, update_id, org_id, payload) values (7, 1, o, '{}');
  select * into r from public.telegram_updates where bot_id = 7 and update_id = 1;
  if r.status <> 'recebido' or r.tentativas <> 0 then raise exception 'defaults errados: %', row_to_json(r); end if;
  insert into public.telegram_updates (bot_id, update_id, org_id, payload) values (7, 1, o, '{}') on conflict do nothing;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'PK não deduplicou'; end if;
  begin
    insert into public.telegram_updates (bot_id, update_id, org_id, payload, status) values (7, 2, o, '{}', 'xpto');
    raise exception 'CHECK de status aceitou xpto';
  exception when check_violation then null;
  end;

  -- 2) Duas reivindicações no mesmo instante → só uma vence.
  select count(*) into n from public.telegram_update_reivindicar(7, 1, t0);
  if n <> 1 then raise exception '1ª reivindicação devolveu % linhas', n; end if;
  select count(*) into n from public.telegram_update_reivindicar(7, 1, t0 + interval '10 seconds');
  if n <> 0 then raise exception '2ª reivindicação com lease vivo venceu'; end if;
  select lease_id into lease_a from public.telegram_updates where bot_id = 7 and update_id = 1;

  -- 3) Lease vencido → reivindicável (lease novo, tentativas 2).
  select * into r from public.telegram_update_reivindicar(7, 1, t0 + interval '61 seconds');
  if r.lease_id is null or r.lease_id = lease_a or r.tentativas <> 2 then
    raise exception 'lease vencido não foi retomado: %', row_to_json(r);
  end if;
  lease_b := r.lease_id;

  -- 4) Execução vencida (A) não confirma, não conclui, não devolve.
  if public.telegram_update_confirmar_posse(7, 1, lease_a, t0 + interval '62 seconds') then raise exception 'A confirmou posse'; end if;
  if public.telegram_update_concluir(7, 1, lease_a, 'respondido', null) then raise exception 'A concluiu'; end if;
  if public.telegram_update_devolver(7, 1, lease_a, 'x') then raise exception 'A devolveu'; end if;
  select * into r from public.telegram_updates where bot_id = 7 and update_id = 1;
  if r.status <> 'processando' or r.lease_id <> lease_b then raise exception 'A alterou a linha de B: %', row_to_json(r); end if;

  -- 5) B confirma (lease vivo) e conclui; B com lease vencido não confirmaria.
  if not public.telegram_update_confirmar_posse(7, 1, lease_b, t0 + interval '62 seconds') then raise exception 'B não confirmou'; end if;
  if public.telegram_update_confirmar_posse(7, 1, lease_b, t0 + interval '10 minutes') then raise exception 'confirmou lease vencido'; end if;
  if not public.telegram_update_concluir(7, 1, lease_b, 'respondido', null) then raise exception 'B não concluiu'; end if;
  select * into r from public.telegram_updates where bot_id = 7 and update_id = 1;
  if r.status <> 'respondido' or r.lease_id is not null or r.processado_em is null then raise exception 'conclusão errada: %', row_to_json(r); end if;
  select count(*) into n from public.telegram_update_reivindicar(7, 1, t0 + interval '1 hour');
  if n <> 0 then raise exception 'reivindicou update respondido'; end if;

  -- 6) devolver: < 5 tentativas volta a recebido; na 5ª vira falhou.
  insert into public.telegram_updates (bot_id, update_id, org_id, payload) values (7, 3, o, '{}');
  for i in 1..5 loop
    select lease_id into lease_a from public.telegram_update_reivindicar(7, 3, t0);
    if lease_a is null then raise exception 'não reivindicou na tentativa %', i; end if;
    ok := public.telegram_update_devolver(7, 3, lease_a, 'envio falhou');
    if not ok then raise exception 'devolver falhou na tentativa %', i; end if;
    select * into r from public.telegram_updates where bot_id = 7 and update_id = 3;
    if (i < 5 and (r.status <> 'recebido' or r.lease_id is not null)) or (i = 5 and r.status <> 'falhou') then
      raise exception 'tentativa %: status %', i, r.status;
    end if;
  end loop;

  -- 7) Varredura: recebido parado e processando vencido entram; respondido e recente não.
  insert into public.telegram_updates (bot_id, update_id, org_id, payload, publicado_em) values
    (8, 1, o, '{}', t0 - interval '5 minutes'),
    (8, 2, o, '{}', t0 - interval '10 seconds');
  insert into public.telegram_updates (bot_id, update_id, org_id, payload, status, lease_ate) values
    (8, 3, o, '{}', 'processando', t0 - interval '1 second');
  select count(*) into n from public.telegram_updates_parados(t0, null, null, 200) p where p.bot_id = 8;
  if n <> 2 then raise exception 'varredura devolveu % linhas do bot 8 (esperado 2)', n; end if;
  select count(*) into n from public.telegram_updates_parados(t0, 8, 1, 200) p where p.bot_id = 8;
  if n <> 1 then raise exception 'cursor não avançou (% linhas)', n; end if;
  select count(*) into n from public.telegram_updates_parados(t0, null, null, 200) p where p.bot_id = 7;
  if n <> 0 then raise exception 'varredura pegou respondido/falhou'; end if;
end $$;

-- 8) Trigger de configuracoes.telegram_bot_id. Fixture: admin ativo de org com configuracoes.
do $$
declare v_user uuid; v_org uuid; n int;
begin
  select p.id, p.org_id into v_user, v_org from public.profiles p
    join public.configuracoes c on c.org_id = p.org_id
   where p.is_active and p.is_admin and p.org_id is not null and not coalesce(p.is_super_admin, false)
   limit 1;
  if v_user is null then raise exception 'nenhum admin com configuracoes para a fixture'; end if;
  perform set_config('teste.org', v_org::text, true);
  perform set_config('teste.user', v_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
end $$;

-- service_role grava o id
set local role service_role;
do $$
declare n int;
begin
  update public.configuracoes set telegram_bot_id = 999000000001 where org_id = current_setting('teste.org')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'service_role não gravou telegram_bot_id (% linhas)', n; end if;
end $$;
reset role;

-- authenticated não grava o id; trocar o token zera o id
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('teste.user'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare n int;
begin
  begin
    update public.configuracoes set telegram_bot_id = 123 where org_id = current_setting('teste.org')::uuid;
    raise exception 'authenticated gravou telegram_bot_id';
  exception when insufficient_privilege then
    if sqlerrm not like 'telegram_bot_id só é gravado pelo servidor%' then raise; end if;
  end;
  update public.configuracoes set telegram_bot_token = 'token-novo-teste' where org_id = current_setting('teste.org')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'troca de token pelo admin afetou % linhas', n; end if;
end $$;
reset role;

do $$
declare v bigint;
begin
  select telegram_bot_id into v from public.configuracoes where org_id = current_setting('teste.org')::uuid;
  if v is not null then raise exception 'trocar o token não zerou telegram_bot_id (%)', v; end if;
end $$;
rollback;
