-- Pós-venda ML (Task 7). Rodar:
--   python3 scripts/teste-sql-desfeito.py supabase/tests/resumo_mensagens_posvenda.sql \
--     supabase/migrations/20261028172646_posvenda_resumo_mensagens.sql
-- Sem a migration tem que falhar (a função não existe).
-- Compara deltas sobre a org real (nada é apagado; tudo desfeito no rollback). Cobre: pack pendente
-- cujas mensagens ficam fora das 1.000 mais recentes e a leitura monotônica de lida_ml_em.
\set ON_ERROR_STOP on
begin;
do $$
declare
  v_org uuid; v_user uuid; a record; b record; n int; v_lida timestamptz;
begin
  select org_id, user_id into v_org, v_user from public.ml_mensagens limit 1;
  if v_org is null then raise exception 'sem mensagens — teste não prova nada'; end if;
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  set local role authenticated;
  select * into a from public.resumo_mensagens_posvenda();
  reset role;

  insert into public.ml_vendas (user_id, org_id, order_id, pack_id, status, shipping_status, date_closed)
  values (v_user, v_org, 9000001, 9000001, 'paid', 'handling', now());

  -- Pack A: recebida antiga NÃO lida no ML (a preparar), coberta por 1.100 mensagens mais novas de
  -- outros packs (enviadas, lidas) — fora das 1.000 mais recentes.
  insert into public.ml_mensagens (user_id, org_id, pack_id, message_id, direcao, texto, data_ml, lida, lida_ml_em)
  values (v_user, v_org, '9000001', 'tst-a1', 'recebida', 'oi', '2000-01-01', false, null);
  insert into public.ml_mensagens (user_id, org_id, pack_id, message_id, direcao, texto, data_ml, lida, lida_ml_em)
  select v_user, v_org, '8' || g, 'tst-z' || g, 'enviada', 'x', '2099-01-01'::timestamptz + g * interval '1 minute', true, now()
  from generate_series(1, 1100) g;

  set local role authenticated;
  select * into b from public.resumo_mensagens_posvenda();
  reset role;
  if b.nao_lidas_total - a.nao_lidas_total <> 1 or b.a_preparar - a.a_preparar <> 1
     or b.a_caminho <> a.a_caminho or b.entregues <> a.entregues then
    raise exception 'nao lidas: antes=% depois=%', a, b;
  end if;
  if b.respondidas - a.respondidas <> 1100 or b.sem_responder <> a.sem_responder then
    raise exception 'lidas: antes=% depois=%', a, b;
  end if;

  -- Ler no ML move de não lidas para lidas; como a última é recebida e não dispensada → sem responder.
  update public.ml_mensagens set lida_ml_em = coalesce(lida_ml_em, now()) where message_id = 'tst-a1';
  set local role authenticated;
  select * into b from public.resumo_mensagens_posvenda();
  reset role;
  if b.nao_lidas_total <> a.nao_lidas_total or b.sem_responder - a.sem_responder <> 1 then
    raise exception 'apos leitura: antes=% depois=%', a, b;
  end if;
  -- Dispensar (lida local) tira de sem responder, sem mexer em lida_ml_em.
  update public.ml_mensagens set lida = true where message_id = 'tst-a1';
  set local role authenticated;
  select * into b from public.resumo_mensagens_posvenda();
  reset role;
  if b.sem_responder <> a.sem_responder then raise exception 'dispensar nao tirou: %', b; end if;

  -- Monotônico: preenchido + coalesce com snapshot antigo (read=null) → continua; upsert sem a coluna idem.
  select lida_ml_em into v_lida from public.ml_mensagens where message_id = 'tst-a1';
  update public.ml_mensagens set lida_ml_em = coalesce(lida_ml_em, null::timestamptz) where message_id = 'tst-a1';
  select count(*) into n from public.ml_mensagens where message_id = 'tst-a1' and lida_ml_em = v_lida;
  if n <> 1 then raise exception 'lida_ml_em regrediu'; end if;
  insert into public.ml_mensagens (user_id, org_id, pack_id, message_id, direcao, texto, data_ml, lida)
  values (v_user, v_org, '9000001', 'tst-a1', 'recebida', 'oi', '2000-01-01', true)
  on conflict (user_id, message_id) do update set texto = excluded.texto;
  select count(*) into n from public.ml_mensagens where message_id = 'tst-a1' and lida_ml_em = v_lida;
  if n <> 1 then raise exception 'upsert apagou lida_ml_em'; end if;
end $$;
rollback;
