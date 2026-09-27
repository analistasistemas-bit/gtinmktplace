\set ON_ERROR_STOP on
-- ADR-0173: worker_rodadas / worker_pendencias / RPCs de execução. Casos 2–11 do plano (o 1 é
-- worker_rodadas_concorrencia.sh, que precisa de duas sessões).
begin;
insert into public.organizations (id, nome, slug) values
  ('95000000-0000-0000-0000-000000000001', 'Rodadas test', 'rodadas-test');
insert into auth.users (id, email, raw_user_meta_data) values
  ('95000000-0000-0000-0000-000000000101', 'rodadas@test.local', '{"org_id":"95000000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.pulse_produtos (id, org_id, catalog_product_id) values
  ('95000000-0000-0000-0000-000000000201', '95000000-0000-0000-0000-000000000001', 'MLBCAT1');

-- 11) Grants: RPCs só service_role; tabelas só select para authenticated.
do $$
declare f text; t text; p text;
begin
  foreach f in array array[
    'public.abrir_execucao(text,uuid,text,jsonb)',
    'public.avancar_execucao(text,uuid,uuid,text,jsonb)',
    'public.concluir_execucao(text,uuid,uuid,text,text,jsonb,boolean)',
    'public.liberar_execucao(text,uuid,uuid,text)',
    'public.marcar_notificado(text,uuid,uuid)',
    'public.registrar_pendencias_pedido(uuid,text[],timestamptz,text[],text)',
    'public.registrar_falha_coleta_pulse(uuid,uuid)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')
       or has_function_privilege('public', f, 'execute') then raise exception 'RPC exposta: %', f; end if;
    if not has_function_privilege('service_role', f, 'execute') then raise exception 'service_role sem execute: %', f; end if;
  end loop;
  foreach t in array array['public.worker_rodadas', 'public.worker_pendencias'] loop
    foreach p in array array['insert', 'update', 'delete'] loop
      if has_table_privilege('authenticated', t, p) or has_table_privilege('anon', t, p)
        then raise exception 'tabela % aberta para %', t, p; end if;
    end loop;
    if has_table_privilege('anon', t, 'select') then raise exception 'anon lê %', t; end if;
    if not has_table_privilege('authenticated', t, 'select') then raise exception 'authenticated não lê %', t; end if;
  end loop;
end $$;

set local role service_role;
do $$
declare
  o constant uuid := '95000000-0000-0000-0000-000000000001';
  r record; r2 record; w record; ok boolean; t0 timestamptz; d0 timestamptz; n integer;
begin
  -- 2) executar → posse vencida → executar com lease diferente; CAS pelo lease.
  select * into r from public.abrir_execucao('backfill', o, '2026-09-27', '{"janela":1}');
  if r.resultado <> 'executar' or r.lease is null or r.cursor is not null or r.params <> '{"janela":1}'::jsonb
    then raise exception '2: abertura inicial errada: %', r; end if;
  update public.worker_rodadas set lease_ate = now() - interval '1 second' where job = 'backfill' and org_id = o;
  select * into r2 from public.abrir_execucao('backfill', o, '2026-09-27', '{"janela":1}');
  if r2.resultado <> 'executar' or r2.lease is null or r2.lease = r.lease then raise exception '2: reabertura errada: %', r2; end if;
  if public.avancar_execucao('backfill', o, r.lease, 'e|1', '{"n":1}') then raise exception '2: CAS com lease antigo passou'; end if;
  if not public.avancar_execucao('backfill', o, r2.lease, 'e|1', '{"n":1}') then raise exception '2: CAS com lease novo falhou'; end if;

  -- 3) Mesmo ciclo, params diferentes → devolve os gravados (posse vencida para poder reabrir).
  update public.worker_rodadas set lease_ate = now() - interval '1 second' where job = 'backfill' and org_id = o;
  select * into r from public.abrir_execucao('backfill', o, '2026-09-27', '{"janela":99}');
  if r.resultado <> 'executar' or r.params <> '{"janela":1}'::jsonb or r.cursor <> 'e|1' or r.acumulado <> '{"n":1}'::jsonb
    then raise exception '3: não devolveu params/cursor gravados: %', r; end if;

  -- 4) concluir ok sem notificar → posse solta; concluida / obsoleta / executar (ciclo novo zerado).
  if not public.concluir_execucao('backfill', o, r.lease, 'ok', null, '{"n":2}', false)
    then raise exception '4: concluir ok falhou'; end if;
  select * into w from public.worker_rodadas where job = 'backfill' and org_id = o;
  if w.lease_id is not null or w.lease_ate is not null or w.estado <> 'ok' or w.ultimo_ok_em is null or w.acumulado <> '{"n":2}'::jsonb
    then raise exception '4: estado pós-concluir errado: %', w; end if;
  select * into r from public.abrir_execucao('backfill', o, '2026-09-27', '{}');
  if r.resultado <> 'concluida' or r.lease is not null then raise exception '4: esperava concluida: %', r; end if;
  select * into r from public.abrir_execucao('backfill', o, '2026-09-26', '{}');
  if r.resultado <> 'obsoleta' or r.lease is not null then raise exception '4: esperava obsoleta: %', r; end if;
  select * into r from public.abrir_execucao('backfill', o, '2026-09-28', '{"janela":2}');
  if r.resultado <> 'executar' or r.cursor is not null or r.acumulado <> '{}'::jsonb or r.ciclo <> '2026-09-28'
     or r.params <> '{"janela":2}'::jsonb or r.estado <> 'rodando'
    then raise exception '4: ciclo novo errado: %', r; end if;
  select * into w from public.worker_rodadas where job = 'backfill' and org_id = o;
  if w.cursor is not null or w.acumulado <> '{}'::jsonb or w.lease_id <> r.lease then raise exception '4: linha do ciclo novo errada: %', w; end if;

  -- 5) concluir parcial grava estado, erro, ultimo_ok_em e ultimo_erro_em.
  if not public.concluir_execucao('backfill', o, r.lease, 'parcial', 'falhou 3', null, false)
    then raise exception '5: concluir parcial falhou'; end if;
  select * into w from public.worker_rodadas where job = 'backfill' and org_id = o;
  if w.estado <> 'parcial' or w.erro <> 'falhou 3' or w.ultimo_ok_em is null or w.ultimo_erro_em is null or w.lease_id is not null
    then raise exception '5: parcial errado: %', w; end if;
  -- Estado inválido não conclui.
  select * into r from public.abrir_execucao('reconciliar', o, '2026-09-27T10', '{}');
  if public.concluir_execucao('reconciliar', o, r.lease, 'rodando', null, null, false)
    then raise exception '5: concluiu com estado inválido'; end if;

  -- 6) Notificação: concluir com p_notificar mantém a posse até marcar_notificado.
  if not public.concluir_execucao('reconciliar', o, r.lease, 'ok', null, '{"x":1}', true)
    then raise exception '6: concluir notificando falhou'; end if;
  select * into w from public.worker_rodadas where job = 'reconciliar' and org_id = o;
  if w.lease_id <> r.lease or w.lease_ate <= now() or not w.notificar_pendente then raise exception '6: posse não mantida: %', w; end if;
  select * into r2 from public.abrir_execucao('reconciliar', o, '2026-09-27T10', '{}');
  if r2.resultado <> 'ocupada' then raise exception '6: esperava ocupada: %', r2; end if;
  if not public.marcar_notificado('reconciliar', o, r.lease) then raise exception '6: marcar_notificado falhou'; end if;
  select * into w from public.worker_rodadas where job = 'reconciliar' and org_id = o;
  if w.lease_id is not null or w.lease_ate is not null or w.notificar_pendente then raise exception '6: marcar não soltou: %', w; end if;
  select * into r2 from public.abrir_execucao('reconciliar', o, '2026-09-27T10', '{}');
  if r2.resultado <> 'concluida' then raise exception '6: esperava concluida: %', r2; end if;
  -- Variante: concluir notificando, posse vence, ciclo novo → notificar_anterior com dados antigos.
  select * into r from public.abrir_execucao('reconciliar', o, '2026-09-27T11', '{}');
  if r.resultado <> 'executar' then raise exception '6v: abrir 11 errado: %', r; end if;
  if not public.concluir_execucao('reconciliar', o, r.lease, 'ok', null, '{"x":11}', true)
    then raise exception '6v: concluir notificando falhou'; end if;
  update public.worker_rodadas set lease_ate = now() - interval '1 second' where job = 'reconciliar' and org_id = o;
  select * into r2 from public.abrir_execucao('reconciliar', o, '2026-09-27T12', '{}');
  if r2.resultado <> 'notificar_anterior' or r2.lease is null or r2.lease = r.lease or r2.ciclo <> '2026-09-27T11'
     or r2.acumulado <> '{"x":11}'::jsonb or not r2.notificar_pendente
    then raise exception '6v: esperava notificar_anterior: %', r2; end if;
  if not public.marcar_notificado('reconciliar', o, r2.lease) then raise exception '6v: marcar_notificado falhou'; end if;
  select * into r2 from public.abrir_execucao('reconciliar', o, '2026-09-27T12', '{}');
  if r2.resultado <> 'executar' or r2.ciclo <> '2026-09-27T12' or r2.acumulado <> '{}'::jsonb
    then raise exception '6v: esperava executar no ciclo novo: %', r2; end if;

  -- 7) concluir com lease vencido → false; liberar zera a posse e grava erro.
  update public.worker_rodadas set lease_ate = now() - interval '1 second' where job = 'reconciliar' and org_id = o;
  if public.concluir_execucao('reconciliar', o, r2.lease, 'ok', null, null, false)
    then raise exception '7: concluiu com lease vencido'; end if;
  select * into r from public.abrir_execucao('reconciliar', o, '2026-09-27T12', '{}');
  perform public.liberar_execucao('reconciliar', o, r.lease, 'boom');
  select * into w from public.worker_rodadas where job = 'reconciliar' and org_id = o;
  if w.lease_id is not null or w.lease_ate is not null or w.erro <> 'boom' or w.ultimo_erro_em is null or w.estado <> 'rodando'
    then raise exception '7: liberar errado: %', w; end if;

  -- 8) Pendências: 5ª falha descarta (devolve 1), 6ª só atualiza (devolve 0), sucesso posterior apaga.
  select descartados into n from public.registrar_pendencias_pedido(o, '{}', now(), '{7}', 'x');
  if n <> 0 or (select tentativas from public.worker_pendencias where org_id = o and order_id = '7') <> 1
    then raise exception '8: 1ª falha errada'; end if;
  for i in 2..4 loop
    select descartados into n from public.registrar_pendencias_pedido(o, '{}', now(), '{7}', 'x' || i);
    if n <> 0 then raise exception '8: descartou cedo na %ª', i; end if;
  end loop;
  select * into w from public.worker_pendencias where org_id = o and order_id = '7';
  if w.tentativas <> 4 or w.descartado_em is not null or w.ultimo_erro <> 'x4' then raise exception '8: 4ª errada: %', w; end if;
  select descartados into n from public.registrar_pendencias_pedido(o, '{}', now(), '{7}', 'x5');
  select * into w from public.worker_pendencias where org_id = o and order_id = '7';
  if n <> 1 or w.tentativas <> 5 or w.descartado_em is null then raise exception '8: 5ª errada (n=%): %', n, w; end if;
  d0 := w.descartado_em; t0 := w.atualizado_em;
  select descartados into n from public.registrar_pendencias_pedido(o, '{}', now(), '{7}', 'x6');
  select * into w from public.worker_pendencias where org_id = o and order_id = '7';
  if n <> 0 or w.tentativas <> 6 or w.ultimo_erro <> 'x6' or w.atualizado_em <= t0 or w.descartado_em <> d0
    then raise exception '8: 6ª errada (n=%): %', n, w; end if;
  select descartados into n from public.registrar_pendencias_pedido(o, '{7}', clock_timestamp(), '{}', null);
  if exists (select 1 from public.worker_pendencias where org_id = o and order_id = '7')
    then raise exception '8: sucesso posterior não apagou'; end if;

  -- 8b) Sucesso atrasado não apaga falha nova.
  t0 := clock_timestamp();
  perform public.registrar_pendencias_pedido(o, '{}', now(), '{9}', 'nova');
  perform public.registrar_pendencias_pedido(o, '{9}', t0, '{}', null);
  if not exists (select 1 from public.worker_pendencias where org_id = o and order_id = '9')
    then raise exception '8b: sucesso atrasado apagou falha nova'; end if;
  perform public.registrar_pendencias_pedido(o, '{9}', clock_timestamp(), '{}', null);
  if exists (select 1 from public.worker_pendencias where org_id = o and order_id = '9')
    then raise exception '8b: sucesso posterior não apagou'; end if;
  -- Variante descartada: falha nova em pendência descartada renova o carimbo e sobrevive ao sucesso atrasado.
  insert into public.worker_pendencias (org_id, order_id, tentativas, ultimo_erro, atualizado_em, descartado_em)
  values (o, '9', 5, 'velho', now() - interval '1 day', now() - interval '1 day');
  t0 := clock_timestamp();
  perform public.registrar_pendencias_pedido(o, '{}', now(), '{9}', 'novo');
  select * into w from public.worker_pendencias where org_id = o and order_id = '9';
  if w.atualizado_em <= t0 or w.descartado_em is null or w.ultimo_erro <> 'novo' then raise exception '8bv: falha não renovou: %', w; end if;
  perform public.registrar_pendencias_pedido(o, '{9}', t0, '{}', null);
  select * into w from public.worker_pendencias where org_id = o and order_id = '9';
  if w is null or w.descartado_em is null or w.ultimo_erro <> 'novo' then raise exception '8bv: sucesso atrasado apagou descartada'; end if;

  -- 8c) Falha repetida na mesma chamada: dedup no SQL, 1 linha com tentativas=1.
  perform public.registrar_pendencias_pedido(o, '{}', now(), '{11,11}', 'x');
  if (select count(*) from public.worker_pendencias where org_id = o and order_id = '11') <> 1
     or (select tentativas from public.worker_pendencias where org_id = o and order_id = '11') <> 1
    then raise exception '8c: dedup de p_falhas errado'; end if;

  -- 9) Falha de coleta do Pulse: no máximo 1 por hora.
  perform public.registrar_falha_coleta_pulse(o, '95000000-0000-0000-0000-000000000201');
  perform public.registrar_falha_coleta_pulse(o, '95000000-0000-0000-0000-000000000201');
  if (select coleta_falhas_seguidas from public.pulse_produtos where id = '95000000-0000-0000-0000-000000000201') <> 1
    then raise exception '9: contou 2x na mesma hora'; end if;
  update public.pulse_produtos set coleta_tentativa_em = now() - interval '2 hours' where id = '95000000-0000-0000-0000-000000000201';
  perform public.registrar_falha_coleta_pulse(o, '95000000-0000-0000-0000-000000000201');
  if (select coleta_falhas_seguidas from public.pulse_produtos where id = '95000000-0000-0000-0000-000000000201') <> 2
    then raise exception '9: não contou após 2h'; end if;

  -- 10) notificacoes.chave: única por usuário; null não colide.
  insert into public.notificacoes (user_id, org_id, categoria, texto, chave)
  values ('95000000-0000-0000-0000-000000000101', o, 'vendas', 'a', 'k1');
  begin
    insert into public.notificacoes (user_id, org_id, categoria, texto, chave)
    values ('95000000-0000-0000-0000-000000000101', o, 'vendas', 'b', 'k1');
    raise exception '10: chave repetida entrou';
  exception when unique_violation then null; end;
  insert into public.notificacoes (user_id, org_id, categoria, texto, chave) values
    ('95000000-0000-0000-0000-000000000101', o, 'vendas', 'c', null),
    ('95000000-0000-0000-0000-000000000101', o, 'vendas', 'd', null);
end $$;
reset role;
-- ponytail: o 11 fica só em has_function_privilege — chamar a RPC como authenticated derruba o
-- Postgres local (segfault em qualquer permission denied de função, inclusive pré-existentes).
rollback;
\echo 'worker_rodadas: OK'
