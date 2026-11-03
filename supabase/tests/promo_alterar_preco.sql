-- Emenda ADR-0174 (2026-11-03): ação alterar_preco. Rodar com scripts/teste-sql-desfeito.py (transação desfeita).
begin;
do $$
declare v_org uuid; v_op uuid; v_reaj uuid;
begin
  select id into v_org from public.organizations limit 1;

  -- alterar_preco exige promoção (como aderir/sair)
  insert into public.operacoes_massa (org_id, acao, promocao_id, promocao_tipo, status)
  values (v_org, 'alterar_preco', 'P-TESTE', 'DEAL', 'executando') returning id into v_op;
  begin
    insert into public.operacoes_massa (org_id, acao, status) values (v_org, 'alterar_preco', 'executando');
    raise exception 'FALHOU: alterar_preco sem promoção foi aceito';
  exception when check_violation then null;
  end;

  -- claim de alterar_preco barra anúncio com reajuste em andamento (mesma barreira do aderir)
  insert into public.operacoes_massa (org_id, acao, status) values (v_org, 'reajustar', 'executando') returning id into v_reaj;
  insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status) values (v_reaj, v_org, 'MLBTESTE1', 'pendente');
  insert into public.operacoes_massa_itens (operacao_id, org_id, promocao_id, ml_item_id, preco, status)
  values (v_op, v_org, 'P-TESTE', 'MLBTESTE1', 10, 'pendente');
  if public.operacoes_massa_reivindicar(v_org, v_op, 'MLBTESTE1') then
    raise exception 'FALHOU: alterar_preco reivindicou com reajuste em andamento';
  end if;
  if (select status from public.operacoes_massa_itens where operacao_id = v_op and ml_item_id = 'MLBTESTE1') <> 'mudou' then
    raise exception 'FALHOU: item de alterar_preco não virou mudou';
  end if;

  -- barreira do reajuste enxerga alterar_preco em andamento
  if position('''alterar_preco''' in pg_get_functiondef('public.reajuste_reivindicar(uuid,uuid,text)'::regprocedure)) = 0 then
    raise exception 'FALHOU: reajuste_reivindicar não considera alterar_preco';
  end if;
end $$;
rollback;
