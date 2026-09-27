\set ON_ERROR_STOP on
begin;
insert into public.organizations (id, nome, slug) values
  ('94000000-0000-0000-0000-000000000001', 'Tráfego test', 'trafego-test'),
  ('94000000-0000-0000-0000-000000000002', 'Outra org tráfego', 'outra-org-trafego');
insert into auth.users (id, email, raw_user_meta_data) values
  ('94000000-0000-0000-0000-000000000101', 'trafego@test.local', '{"org_id":"94000000-0000-0000-0000-000000000001"}'::jsonb),
  ('94000000-0000-0000-0000-000000000102', 'outra-trafego@test.local', '{"org_id":"94000000-0000-0000-0000-000000000002"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('94000000-0000-0000-0000-000000000101', '94000000-0000-0000-0000-000000000001', true),
  ('94000000-0000-0000-0000-000000000102', '94000000-0000-0000-0000-000000000002', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;

-- Grants: RPCs de gravação só para service_role.
do $$
declare f text;
begin
  foreach f in array array[
    'public.gravar_visitas_dia(uuid,timestamptz,jsonb)', 'public.gravar_preco_dia(uuid,jsonb)',
    'public.gravar_trafego_item(uuid,jsonb)', 'public.reservar_trafego_posse(uuid)',
    'public.avancar_trafego_cursor(uuid,timestamptz,text,text)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')
       or has_function_privilege('public', f, 'execute') then raise exception 'RPC exposta: %', f; end if;
    if not has_function_privilege('service_role', f, 'execute') then raise exception 'service_role sem execute: %', f; end if;
  end loop;
end $$;

set local role service_role;
do $$
declare r record; ok boolean;
begin
  -- Posse: 1ª reserva devolve rodada; 2ª com posse viva não devolve nada.
  select * into r from public.reservar_trafego_posse('94000000-0000-0000-0000-000000000001');
  if r.rodada is null or r.cursor is not null then raise exception 'reserva inicial errada: %', r; end if;
  if exists (select 1 from public.reservar_trafego_posse('94000000-0000-0000-0000-000000000001'))
    then raise exception 'abriu 2ª cadeia com posse viva'; end if;
  -- CAS do cursor.
  ok := public.avancar_trafego_cursor('94000000-0000-0000-0000-000000000001', r.rodada, null, 'MLB20');
  if not ok then raise exception 'CAS null→MLB20 falhou'; end if;
  if public.avancar_trafego_cursor('94000000-0000-0000-0000-000000000001', r.rodada, null, 'MLB40')
    then raise exception 'CAS com cursor velho passou'; end if;
  if public.avancar_trafego_cursor('94000000-0000-0000-0000-000000000001', r.rodada - interval '1 day', 'MLB20', 'MLB40')
    then raise exception 'CAS com rodada obsoleta passou'; end if;
  -- Posse expirada + carga inicial não concluída: nova rodada retoma o cursor.
  update public.ml_trafego_sync set posse_ate = now() - interval '1 minute' where org_id = '94000000-0000-0000-0000-000000000001';
  update public.ml_trafego_sync set rodada = rodada - interval '1 hour' where org_id = '94000000-0000-0000-0000-000000000001';
  select * into r from public.reservar_trafego_posse('94000000-0000-0000-0000-000000000001');
  if r.cursor is distinct from 'MLB20' then raise exception 'não retomou cursor da carga inicial: %', r; end if;
  -- Carga concluída: execução seguinte recomeça do início.
  update public.ml_trafego_sync set posse_ate = now() - interval '1 minute', rodada = rodada - interval '1 hour',
    carga_inicial_concluida_em = now() where org_id = '94000000-0000-0000-0000-000000000001';
  select * into r from public.reservar_trafego_posse('94000000-0000-0000-0000-000000000001');
  if r.cursor is not null then raise exception 'carga concluída devia recomeçar do início: %', r; end if;

  -- Visitas.
  perform public.gravar_visitas_dia('94000000-0000-0000-0000-000000000001', '2026-09-20T10:00:00Z',
    '[{"ml_item_id":"MLB1","dia":"2026-09-01","visitas":10,"estado":"ok"},
      {"ml_item_id":"MLB1","dia":"2026-09-02","visitas":3,"estado":"pendente"},
      {"ml_item_id":"MLB1","dia":"2026-09-03","visitas":7,"estado":"ok"}]');
  perform public.gravar_visitas_dia('94000000-0000-0000-0000-000000000002', '2026-09-20T10:00:00Z',
    '[{"ml_item_id":"MLB1","dia":"2026-09-01","visitas":99,"estado":"ok"}]');
  -- Rodada antiga não sobrescreve.
  perform public.gravar_visitas_dia('94000000-0000-0000-0000-000000000001', '2026-09-19T10:00:00Z',
    '[{"ml_item_id":"MLB1","dia":"2026-09-01","visitas":1,"estado":"ok"}]');
  if (select visitas from public.ml_item_visitas_dia where org_id = '94000000-0000-0000-0000-000000000001' and dia = '2026-09-01') <> 10
    then raise exception 'rodada antiga sobrescreveu'; end if;
  -- Rodada nova: ok revisa ok, pendente vira ok, falha não troca ok.
  perform public.gravar_visitas_dia('94000000-0000-0000-0000-000000000001', '2026-09-21T10:00:00Z',
    '[{"ml_item_id":"MLB1","dia":"2026-09-01","visitas":11,"estado":"ok"},
      {"ml_item_id":"MLB1","dia":"2026-09-02","visitas":8,"estado":"ok"},
      {"ml_item_id":"MLB1","dia":"2026-09-03","visitas":null,"estado":"falha"}]');
  select * into r from public.ml_item_visitas_dia where org_id = '94000000-0000-0000-0000-000000000001' and dia = '2026-09-01';
  if r.visitas <> 11 or r.rodada <> '2026-09-21T10:00:00Z' then raise exception 'rodada nova não sobrescreveu: %', r; end if;
  select * into r from public.ml_item_visitas_dia where org_id = '94000000-0000-0000-0000-000000000001' and dia = '2026-09-02';
  if r.visitas <> 8 or r.estado <> 'ok' then raise exception 'pendente não virou ok: %', r; end if;
  select * into r from public.ml_item_visitas_dia where org_id = '94000000-0000-0000-0000-000000000001' and dia = '2026-09-03';
  if r.visitas <> 7 or r.estado <> 'ok' then raise exception 'falha sobrescreveu ok: %', r; end if;

  -- Preço: não reescreve dia existente.
  perform public.gravar_preco_dia('94000000-0000-0000-0000-000000000001',
    '[{"ml_item_id":"MLB1","dia":"2026-09-27","preco":49.9,"preco_regular":59.9,"moeda":"BRL","observado_em":"2026-09-27T12:00:00Z","origem":"sale_price"}]');
  perform public.gravar_preco_dia('94000000-0000-0000-0000-000000000001',
    '[{"ml_item_id":"MLB1","dia":"2026-09-27","preco":39.9,"preco_regular":null,"moeda":"BRL","observado_em":"2026-09-27T15:00:00Z","origem":"sale_price"}]');
  if (select preco from public.ml_item_preco_dia where org_id = '94000000-0000-0000-0000-000000000001') <> 49.9
    then raise exception 'preço do dia reescrito'; end if;

  -- Status do item: status_desde só muda quando o status muda.
  perform public.gravar_trafego_item('94000000-0000-0000-0000-000000000001', '[{"ml_item_id":"MLB1","status":"active"}]');
  update public.ml_trafego_item set status_desde = '2026-01-01' where ml_item_id = 'MLB1';
  perform public.gravar_trafego_item('94000000-0000-0000-0000-000000000001', '[{"ml_item_id":"MLB1","status":"active","ultimo_ok_em":"2026-09-27T12:00:00Z"}]');
  select * into r from public.ml_trafego_item where ml_item_id = 'MLB1';
  if r.status_desde <> '2026-01-01' or r.ultimo_ok_em <> '2026-09-27T12:00:00Z' then raise exception 'item mesmo status errado: %', r; end if;
  perform public.gravar_trafego_item('94000000-0000-0000-0000-000000000001', '[{"ml_item_id":"MLB1","status":"closed"}]');
  select * into r from public.ml_trafego_item where ml_item_id = 'MLB1';
  if r.status <> 'closed' or r.status_desde <= '2026-01-01' or r.ultimo_ok_em is null then raise exception 'troca de status errada: %', r; end if;
end $$;
reset role;

-- RLS: usuário da org 1 lê só a org 1 e não escreve.
set local role authenticated;
set local request.jwt.claims = '{"sub":"94000000-0000-0000-0000-000000000101","role":"authenticated"}';
do $$
begin
  if (select count(*) from public.ml_item_visitas_dia) <> 3 then raise exception 'visitas: RLS errada'; end if;
  if exists (select 1 from public.ml_item_visitas_dia where org_id <> '94000000-0000-0000-0000-000000000001')
    then raise exception 'org 2 vazou'; end if;
  if (select count(*) from public.ml_item_preco_dia) <> 1 or (select count(*) from public.ml_trafego_sync) <> 1
     or (select count(*) from public.ml_trafego_item) <> 1 then raise exception 'leitura da própria org falhou'; end if;
  begin
    insert into public.ml_item_visitas_dia (org_id, ml_item_id, dia, visitas, estado, coletado_em, rodada)
      values ('94000000-0000-0000-0000-000000000001', 'MLB9', '2026-09-01', 1, 'ok', now(), now());
    raise exception 'authenticated inseriu';
  exception when insufficient_privilege then null;
  end;
  -- Chamada negada de RPC não é testada por exceção: o Postgres 17.6 local dá segfault em EXECUTE negado
  -- (reproduz com anon → vendas_sku_catalogo()). A negação é provada por has_function_privilege no topo.
end $$;
reset role;
set local role anon;
do $$
begin
  begin
    insert into public.ml_item_preco_dia (org_id, ml_item_id, dia, preco, moeda, observado_em, origem)
      values ('94000000-0000-0000-0000-000000000001', 'MLB9', '2026-09-01', 1, 'BRL', now(), 'x');
    raise exception 'anon inseriu';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.ml_trafego_sync;
    raise exception 'anon leu';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
