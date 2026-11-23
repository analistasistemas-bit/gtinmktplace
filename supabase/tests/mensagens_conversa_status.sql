-- Emenda ADR-0067 (23/11): pedido cancelado só encerra a conversa quando o ML a bloqueia
-- (conversa_status distinto de 'active'). Rodar:
--   python3 scripts/teste-sql-desfeito.py supabase/tests/mensagens_conversa_status.sql \
--     supabase/migrations/20261123225446_mensagens_conversa_status.sql
-- Sem a migration tem que falhar (a coluna conversa_status não existe).
-- Compara deltas sobre uma org existente com packs sintéticos (tudo desfeito no rollback). Cada pack
-- tem a última mensagem recebida, lida no ML e não dispensada: conta em "aguardando" e "sem_responder".
\set ON_ERROR_STOP on
begin;
do $$
declare
  v_org uuid; v_user uuid; a_ag int; b_ag int; a record; b record;
begin
  select org_id, user_id into v_org, v_user from public.ml_mensagens limit 1;
  if v_org is null then raise exception 'sem mensagens — teste não prova nada'; end if;
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  set local role authenticated;
  if public.current_org_id() is distinct from v_org then raise exception 'org da sessão diverge'; end if;
  a_ag := public.contar_conversas_aguardando();
  select * into a from public.resumo_mensagens_posvenda();
  reset role;

  insert into public.ml_mensagens
    (user_id, org_id, pack_id, message_id, direcao, texto, data_ml, lida, lida_ml_em, order_status, conversa_status)
  values
    (v_user, v_org, '9200001', 'tst-cs-1', 'recebida', 'x', '2099-01-01', false, now(), 'cancelled', 'active'),  -- conta
    (v_user, v_org, '9200002', 'tst-cs-2', 'recebida', 'x', '2099-01-01', false, now(), 'cancelled', 'blocked'), -- não conta
    (v_user, v_org, '9200003', 'tst-cs-3', 'recebida', 'x', '2099-01-01', false, now(), 'cancelled', null),      -- não conta (não relida)
    (v_user, v_org, '9200004', 'tst-cs-4', 'recebida', 'x', '2099-01-01', false, now(), 'paid', null),           -- conta
    (v_user, v_org, '9200005', 'tst-cs-5', 'recebida', 'x', '2099-01-01', false, now(), 'paid', 'blocked'),      -- conta (não cancelado: ignora)
    (v_user, v_org, '9200006', 'tst-cs-6', 'recebida', 'x', '2099-01-01', false, now(), null, null),             -- conta (sem status)
    -- Estado vem da mensagem mais recente: active antigo + blocked novo → não conta.
    (v_user, v_org, '9200007', 'tst-cs-7a', 'recebida', 'x', '2099-01-01', false, now(), 'cancelled', 'active'),
    (v_user, v_org, '9200007', 'tst-cs-7b', 'recebida', 'x', '2099-01-02', false, now(), 'cancelled', 'blocked');

  set local role authenticated;
  b_ag := public.contar_conversas_aguardando();
  select * into b from public.resumo_mensagens_posvenda();
  reset role;

  if b_ag - a_ag <> 4 then raise exception 'contar_conversas_aguardando: delta esperado 4, veio %', b_ag - a_ag; end if;
  if b.sem_responder - a.sem_responder <> 4 then
    raise exception 'sem_responder: delta esperado 4, veio %', b.sem_responder - a.sem_responder;
  end if;
  if b.nao_lidas_total <> a.nao_lidas_total or b.respondidas <> a.respondidas then
    raise exception 'outros contadores mudaram: antes=% depois=%', a, b;
  end if;
end $$;
rollback;
