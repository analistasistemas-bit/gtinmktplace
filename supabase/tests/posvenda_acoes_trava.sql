-- ADR-0192 / Task 5: trava e idempotência de ml_posvenda_acoes (índices únicos).
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/posvenda_acoes_trava.sql
begin;
do $$
declare
  v_org uuid := (select id from public.organizations order by id limit 1);
  v_user uuid := gen_random_uuid();
  v_op uuid := gen_random_uuid();
  v_c text;
begin
  insert into public.ml_posvenda_acoes (org_id, user_id, operacao_id, claim_id, recurso, acao, payload, payload_hash, estado)
  values (v_org, v_user, v_op, 900000000001, 'claim:900000000001:resolucao', 'reembolsar', '{}', 'h1', 'reservada');

  -- 1) mesmo (org, recurso) com outra tentativa ativa → 23505 na trava.
  begin
    insert into public.ml_posvenda_acoes (org_id, user_id, operacao_id, claim_id, recurso, acao, payload, payload_hash, estado)
    values (v_org, v_user, gen_random_uuid(), 900000000001, 'claim:900000000001:resolucao', 'abrir_disputa', '{}', 'h2', 'reservada');
    raise exception 'trava não barrou o segundo ativo';
  exception when unique_violation then
    get stacked diagnostics v_c = constraint_name;
    if v_c <> 'ml_posvenda_acoes_trava_uniq' then raise exception 'violou % em vez da trava', v_c; end if;
  end;

  -- 2) mesmo operacao_id (outro recurso) → 23505 na idempotência.
  begin
    insert into public.ml_posvenda_acoes (org_id, user_id, operacao_id, claim_id, recurso, acao, payload, payload_hash, estado)
    values (v_org, v_user, v_op, 900000000001, 'claim:900000000001:msg', 'responder', '{}', 'h3', 'recusada');
    raise exception 'operacao_id repetido passou';
  exception when unique_violation then
    get stacked diagnostics v_c = constraint_name;
    if v_c <> 'ml_posvenda_acoes_operacao_uniq' then raise exception 'violou % em vez de operacao_uniq', v_c; end if;
  end;

  -- 3) estados ativos que travam: enviada e desconhecido também.
  update public.ml_posvenda_acoes set estado = 'desconhecido' where operacao_id = v_op;
  begin
    insert into public.ml_posvenda_acoes (org_id, user_id, operacao_id, claim_id, recurso, acao, payload, payload_hash, estado)
    values (v_org, v_user, gen_random_uuid(), 900000000001, 'claim:900000000001:resolucao', 'reembolsar', '{}', 'h4', 'reservada');
    raise exception 'desconhecido não travou';
  exception when unique_violation then null;
  end;

  -- 4) após recusada, novo insert no mesmo recurso passa.
  update public.ml_posvenda_acoes set estado = 'recusada' where operacao_id = v_op;
  insert into public.ml_posvenda_acoes (org_id, user_id, operacao_id, claim_id, recurso, acao, payload, payload_hash, estado)
  values (v_org, v_user, gen_random_uuid(), 900000000001, 'claim:900000000001:resolucao', 'reembolsar', '{}', 'h5', 'reservada');

  -- 5) update condicional que perdeu a corrida casa 0 linhas (não erra).
  update public.ml_posvenda_acoes set estado = 'cancelada'
   where operacao_id = v_op and estado = 'reservada' and post_em is null;
  if found then raise exception 'update condicional casou linha recusada'; end if;
end $$;
rollback;
