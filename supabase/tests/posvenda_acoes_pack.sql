-- Anexo nas mensagens pós-venda: ml_posvenda_acoes aceita tentativa por pack (alvo = claim XOR pack).
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/posvenda_acoes_pack.sql [migration.sql]
begin;
do $$
declare
  v_org uuid := (select id from public.organizations order by id limit 1);
  v_user uuid := gen_random_uuid();
  v_c text;
begin
  -- 1) linha com só pack_id entra.
  insert into public.ml_posvenda_acoes (org_id, user_id, operacao_id, pack_id, recurso, acao, payload, payload_hash, estado)
  values (v_org, v_user, gen_random_uuid(), '900000000001', 'mensagem:900000000001', 'mensagem', '{}', 'h1', 'reservada');

  -- 2) sem alvo → viola o check.
  begin
    insert into public.ml_posvenda_acoes (org_id, user_id, operacao_id, recurso, acao, payload, payload_hash, estado)
    values (v_org, v_user, gen_random_uuid(), 'mensagem:900000000002', 'mensagem', '{}', 'h2', 'reservada');
    raise exception 'linha sem alvo passou';
  exception when check_violation then
    get stacked diagnostics v_c = constraint_name;
    if v_c <> 'ml_posvenda_acoes_alvo_check' then raise exception 'violou % em vez do alvo_check', v_c; end if;
  end;

  -- 3) com os dois alvos → viola o check.
  begin
    insert into public.ml_posvenda_acoes (org_id, user_id, operacao_id, claim_id, pack_id, recurso, acao, payload, payload_hash, estado)
    values (v_org, v_user, gen_random_uuid(), 900000000003, '900000000003', 'mensagem:900000000003', 'mensagem', '{}', 'h3', 'reservada');
    raise exception 'linha com dois alvos passou';
  exception when check_violation then
    get stacked diagnostics v_c = constraint_name;
    if v_c <> 'ml_posvenda_acoes_alvo_check' then raise exception 'violou % em vez do alvo_check', v_c; end if;
  end;

  -- 4) segunda ativa no mesmo recurso de pack → 23505 na trava.
  begin
    insert into public.ml_posvenda_acoes (org_id, user_id, operacao_id, pack_id, recurso, acao, payload, payload_hash, estado)
    values (v_org, v_user, gen_random_uuid(), '900000000001', 'mensagem:900000000001', 'mensagem', '{}', 'h4', 'reservada');
    raise exception 'trava não barrou a segunda ativa do pack';
  exception when unique_violation then
    get stacked diagnostics v_c = constraint_name;
    if v_c <> 'ml_posvenda_acoes_trava_uniq' then raise exception 'violou % em vez da trava', v_c; end if;
  end;

  -- 5) linha de claim antiga (só claim_id) continua válida.
  insert into public.ml_posvenda_acoes (org_id, user_id, operacao_id, claim_id, recurso, acao, payload, payload_hash, estado)
  values (v_org, v_user, gen_random_uuid(), 900000000005, 'claim:900000000005:resolucao', 'reembolsar', '{}', 'h5', 'reservada');
end $$;
rollback;
