-- Emendas 24/11 aos ADR-0067/0037: conversa dispensada sai das não lidas; pergunta pode ser dispensada. Rodar:
--   python3 scripts/teste-sql-desfeito.py supabase/tests/dispensar_perguntas_e_nao_lidas.sql \
--     supabase/migrations/20261124190139_dispensar_perguntas_e_nao_lidas.sql
-- Sem a migration tem que falhar.
\set ON_ERROR_STOP on
begin;
do $$
declare v_org uuid; v_user uuid; v_outra uuid; a record; b record; n int;
begin
  select org_id, user_id into v_org, v_user from public.ml_mensagens limit 1;
  if v_org is null then raise exception 'sem mensagens — teste não prova nada'; end if;
  select id into v_outra from public.organizations where id <> v_org limit 1;
  if v_outra is null then raise exception 'sem segunda org — isolamento não provado'; end if;
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  set local role authenticated;
  if public.current_org_id() is distinct from v_org then raise exception 'org da sessão diverge'; end if;
  select * into a from public.resumo_mensagens_posvenda();
  reset role;

  insert into public.ml_mensagens
    (user_id, org_id, pack_id, message_id, direcao, texto, data_ml, lida, lida_ml_em, order_status)
  values
    (v_user, v_org, '9300001', 'tst-dp-1', 'recebida', 'x', '2099-01-01', true,  null,  'paid'), -- dispensada sem abrir: fora
    (v_user, v_org, '9300002', 'tst-dp-2', 'recebida', 'x', '2099-01-01', false, null,  'paid'), -- não lida: conta
    (v_user, v_org, '9300003', 'tst-dp-3', 'recebida', 'x', '2099-01-01', true,  null,  'paid'), -- dispensada e...
    (v_user, v_org, '9300003', 'tst-dp-4', 'recebida', 'y', '2099-01-02', false, null,  'paid'), -- ...mensagem nova: conta
    (v_user, v_org, '9300004', 'tst-dp-5', 'recebida', 'x', '2099-01-01', true,  null,  'paid'), -- respondida pelo app
    (v_user, v_org, '9300004', 'tst-dp-6', 'enviada',  'y', '2099-01-02', true,  null,  'paid'), --   sem abrir: respondidas
    (v_user, v_org, '9300005', 'tst-dp-7', 'recebida', 'x', '2099-01-01', false, now(), 'paid'); -- lida no ML: sem responder

  set local role authenticated;
  select * into b from public.resumo_mensagens_posvenda();
  reset role;
  if b.nao_lidas_total - a.nao_lidas_total <> 2 then raise exception 'nao_lidas_total: esperado +2, veio %', b.nao_lidas_total - a.nao_lidas_total; end if;
  if b.respondidas - a.respondidas <> 1 then raise exception 'respondidas: esperado +1, veio %', b.respondidas - a.respondidas; end if;
  if b.sem_responder - a.sem_responder <> 1 then raise exception 'sem_responder: esperado +1, veio %', b.sem_responder - a.sem_responder; end if;

  insert into public.ml_perguntas (user_id, org_id, question_id, texto, status) values
    (v_user, v_org,   -9300001, 'x', 'UNANSWERED'),
    (v_user, v_org,   -9300002, 'x', 'ANSWERED'),
    (v_user, v_outra, -9300003, 'x', 'UNANSWERED'),
    (v_user, v_org,   -9300004, 'x', 'UNANSWERED');
  set local role authenticated;
  n := public.dispensar_perguntas(array[-9300001, -9300002, -9300003]::bigint[]);
  if n <> 1 then raise exception 'dispensar: esperado 1, veio %', n; end if;
  n := public.dispensar_perguntas(array[-9300001]::bigint[]);
  if n <> 0 then raise exception 'dispensar de novo: esperado 0, veio %', n; end if;
  reset role;
  select count(*) into n from public.ml_perguntas where question_id between -9300004 and -9300001 and dispensada_em is not null;
  if n <> 1 then raise exception 'linhas dispensadas: esperado 1, veio %', n; end if;

  -- O upsert do worker não manda a coluna: o sync não desfaz a dispensa.
  insert into public.ml_perguntas (user_id, org_id, question_id, texto, status) values (v_user, v_org, -9300001, 'z', 'UNANSWERED')
    on conflict (user_id, question_id) do update set texto = excluded.texto, status = excluded.status;
  select count(*) into n from public.ml_perguntas where question_id = -9300001 and dispensada_em is not null;
  if n <> 1 then raise exception 'sync desfez a dispensa'; end if;

  -- Sem sessão não executa.
  set local role anon;
  begin
    perform public.dispensar_perguntas(array[-9300004]::bigint[]);
    raise exception 'anon executou dispensar_perguntas';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;
rollback;
