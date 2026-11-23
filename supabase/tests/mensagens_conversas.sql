-- Emenda ADR-0067 (23/11): pedido cancelado só encerra a conversa quando o ML a bloqueia
-- (ml_conversas.status distinto de 'active'). Rodar:
--   python3 scripts/teste-sql-desfeito.py supabase/tests/mensagens_conversas.sql \
--     supabase/migrations/20261123231030_mensagens_conversas.sql
-- Sem a migration tem que falhar (ml_conversas não existe).
-- Compara deltas sobre uma org existente com packs sintéticos (tudo desfeito no rollback). Cada pack
-- tem a última mensagem recebida, lida no ML e não dispensada: conta em "aguardando" e "sem_responder".
\set ON_ERROR_STOP on
begin;
do $$
declare
  v_org uuid; v_user uuid; v_outra uuid; a_ag int; b_ag int; a record; b record; v_st text; n int;
begin
  select org_id, user_id into v_org, v_user from public.ml_mensagens limit 1;
  if v_org is null then raise exception 'sem mensagens — teste não prova nada'; end if;
  select id into v_outra from public.organizations where id <> v_org limit 1;
  if v_outra is null then raise exception 'sem segunda org — isolamento não provado'; end if;
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  set local role authenticated;
  if public.current_org_id() is distinct from v_org then raise exception 'org da sessão diverge'; end if;
  a_ag := public.contar_conversas_aguardando();
  select * into a from public.resumo_mensagens_posvenda();
  reset role;

  insert into public.ml_mensagens
    (user_id, org_id, pack_id, message_id, direcao, texto, data_ml, lida, lida_ml_em, order_status)
  values
    (v_user, v_org, '9200001', 'tst-cv-1', 'recebida', 'x', '2099-01-01', false, now(), 'cancelled'), -- active: conta
    (v_user, v_org, '9200002', 'tst-cv-2', 'recebida', 'x', '2099-01-01', false, now(), 'cancelled'), -- blocked: não conta
    (v_user, v_org, '9200003', 'tst-cv-3', 'recebida', 'x', '2099-01-01', false, now(), 'cancelled'), -- sem estado: não conta
    (v_user, v_org, '9200004', 'tst-cv-4', 'recebida', 'x', '2099-01-01', false, now(), 'paid'),      -- sem estado: conta
    (v_user, v_org, '9200005', 'tst-cv-5', 'recebida', 'x', '2099-01-01', false, now(), 'paid'),      -- blocked: conta (não cancelado ignora)
    (v_user, v_org, '9200006', 'tst-cv-6', 'recebida', 'x', '2099-01-01', false, now(), null),        -- sem status: conta
    (v_user, v_org, '9200007', 'tst-cv-7', 'recebida', 'x', '2099-01-01', false, now(), 'cancelled'); -- active só na OUTRA org: não conta
  perform public.registrar_estado_conversa(v_org, '9200001', 'active', now());
  perform public.registrar_estado_conversa(v_org, '9200002', 'blocked', now());
  perform public.registrar_estado_conversa(v_org, '9200005', 'blocked', now());
  perform public.registrar_estado_conversa(v_outra, '9200007', 'active', now());

  set local role authenticated;
  b_ag := public.contar_conversas_aguardando();
  select * into b from public.resumo_mensagens_posvenda();
  select count(*) into n from public.ml_conversas where org_id <> v_org;
  reset role;

  if b_ag - a_ag <> 4 then raise exception 'contar_conversas_aguardando: delta esperado 4, veio %', b_ag - a_ag; end if;
  if b.sem_responder - a.sem_responder <> 4 then
    raise exception 'sem_responder: delta esperado 4, veio %', b.sem_responder - a.sem_responder;
  end if;
  if b.nao_lidas_total <> a.nao_lidas_total or b.respondidas <> a.respondidas then
    raise exception 'outros contadores mudaram: antes=% depois=%', a, b;
  end if;
  if n <> 0 then raise exception 'RLS: % linha(s) de ml_conversas de outra org visíveis', n; end if;

  -- Guarda temporal: observação mais antiga não sobrescreve; mais nova sobrescreve.
  perform public.registrar_estado_conversa(v_org, '9200099', 'blocked', '2099-01-01 12:00');
  perform public.registrar_estado_conversa(v_org, '9200099', 'active', '2099-01-01 11:59');
  select status into v_st from public.ml_conversas where org_id = v_org and pack_id = '9200099';
  if v_st <> 'blocked' then raise exception 'observação antiga sobrescreveu: %', v_st; end if;
  perform public.registrar_estado_conversa(v_org, '9200099', 'active', '2099-01-01 12:01');
  select status into v_st from public.ml_conversas where org_id = v_org and pack_id = '9200099';
  if v_st <> 'active' then raise exception 'observação nova não sobrescreveu: %', v_st; end if;

  -- Só o service role registra: authenticated não executa a função nem escreve na tabela.
  set local role authenticated;
  begin
    perform public.registrar_estado_conversa(v_org, '9200098', 'active', now());
    raise exception 'authenticated executou registrar_estado_conversa';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.ml_conversas values (v_org, '9200098', 'active', now());
    raise exception 'authenticated inseriu em ml_conversas';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;
rollback;
