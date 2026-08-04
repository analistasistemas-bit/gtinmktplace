-- Regressão do incidente de 2026-08-03: uma gravação administrativa direta
-- criou na DSA um produto de lote manual sem chave de cadastro, com códigos de
-- sete dígitos e estoque inicial fora do ledger.
\set ON_ERROR_STOP on

begin;

do $$
begin
  if pg_has_role('postgres', 'estoque_rpc_executor', 'set')
     or pg_has_role('postgres', 'estoque_rpc_executor', 'usage') then
    raise exception 'postgres ainda pode assumir ou herdar o papel interno de estoque';
  end if;
end;
$$;

insert into public.organizations (id, nome, slug) values
  ('91000000-0000-0000-0000-000000000001', 'Manual product test', 'manual-product-test'),
  ('91000000-0000-0000-0000-000000000002', 'Other product tenant', 'other-product-tenant');

insert into auth.users (id, email, raw_user_meta_data) values
  ('91000000-0000-0000-0000-000000000101', 'manual-product@test.local',
   '{"org_id":"91000000-0000-0000-0000-000000000001"}'::jsonb);

insert into public.lotes (id, user_id, org_id, status, origem) values
  ('91000000-0000-0000-0000-000000000201',
   '91000000-0000-0000-0000-000000000101',
   '91000000-0000-0000-0000-000000000001',
   'processando', 'manual');

-- Família manual sem chave idempotente é sempre inválida.
do $$
begin
  begin
    insert into public.familias (
      id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem
    ) values (
      '91000000-0000-0000-0000-000000000301',
      '91000000-0000-0000-0000-000000000201',
      '91000000-0000-0000-0000-000000000101',
      '91000000-0000-0000-0000-000000000001',
      '02710170', 'Produto copiado indevidamente', 'CREATE', 'importado'
    );
  exception when check_violation then
    return;
  end;
  raise exception 'lote manual aceitou família sem chave de cadastro';
end;
$$;

-- Código de sete dígitos também precisa falhar, independentemente da chave.
do $$
begin
  begin
    insert into public.familias (
      id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro
    ) values (
      '91000000-0000-0000-0000-000000000303',
      '91000000-0000-0000-0000-000000000201',
      '91000000-0000-0000-0000-000000000101',
      '91000000-0000-0000-0000-000000000001',
      '2710170', 'Produto com código inválido', 'CREATE', 'importado',
      '91000000-0000-0000-0000-000000000403'
    );
  exception when check_violation then
    return;
  end;
  raise exception 'lote manual aceitou código de família com 7 dígitos';
end;
$$;

-- Mesmo com uma família válida, estoque inicial direto contorna o ledger e deve falhar.
insert into public.familias (
  id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro
) values (
  '91000000-0000-0000-0000-000000000302',
  '91000000-0000-0000-0000-000000000201',
  '91000000-0000-0000-0000-000000000101',
  '91000000-0000-0000-0000-000000000001',
  '02710170', 'Produto válido', 'CREATE', 'importado',
  '91000000-0000-0000-0000-000000000401'
);

do $$
begin
  begin
    insert into public.variacoes (
      familia_id, user_id, org_id, codigo, nome, estoque, preco
    ) values (
      '91000000-0000-0000-0000-000000000302',
      '91000000-0000-0000-0000-000000000101',
      '91000000-0000-0000-0000-000000000001',
      '02743639', 'Variação copiada', 200, 48
    );
  exception when check_violation then
    return;
  end;
  raise exception 'variação de lote manual aceitou estoque inicial fora do ledger';
end;
$$;

-- A forma permitida nasce zerada; nem SQL administrativo pode preencher estoque depois.
insert into public.variacoes (
  id, familia_id, user_id, org_id, codigo, nome, estoque, preco
) values (
  '91000000-0000-0000-0000-000000000501',
  '91000000-0000-0000-0000-000000000302',
  '91000000-0000-0000-0000-000000000101',
  '91000000-0000-0000-0000-000000000001',
  '02743639', 'Variação válida', 0, 48
);

do $$
begin
  begin
    update public.variacoes set estoque = 200
    where id = '91000000-0000-0000-0000-000000000501';
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'SQL administrativo atualizou estoque fora do ledger';
end;
$$;

-- A capacidade interna continua permitindo o caminho oficial e deixa auditoria.
set local role service_role;
select public.registrar_entrada(
  '91000000-0000-0000-0000-000000000001',
  '02743639', 10, 26, 'Teste', null,
  '91000000-0000-0000-0000-000000000101', 'teste:entrada-oficial'
);
reset role;
do $$
begin
  if (select estoque from public.variacoes
      where id = '91000000-0000-0000-0000-000000000501') <> 10
     or not exists (
       select 1 from public.estoque_movimentos
       where org_id = '91000000-0000-0000-0000-000000000001'
         and referencia_externa = 'teste:entrada-oficial'
     ) then
    raise exception 'RPC oficial não atualizou estoque e ledger juntos';
  end if;
end;
$$;

-- Não pode criar como planilha e converter a árvore inválida para manual depois.
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('91000000-0000-0000-0000-000000000202',
   '91000000-0000-0000-0000-000000000101',
   '91000000-0000-0000-0000-000000000001',
   'processando', 'planilha');
insert into public.familias (
  id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem
) values (
  '91000000-0000-0000-0000-000000000304',
  '91000000-0000-0000-0000-000000000202',
  '91000000-0000-0000-0000-000000000101',
  '91000000-0000-0000-0000-000000000001',
  '123', 'Família de planilha legada', 'CREATE', 'nacional'
);
insert into public.variacoes (
  familia_id, user_id, org_id, codigo, nome, estoque, preco
) values (
  '91000000-0000-0000-0000-000000000304',
  '91000000-0000-0000-0000-000000000101',
  '91000000-0000-0000-0000-000000000001',
  '456', 'Variação de planilha legada', 200, 48
);
do $$
begin
  begin
    update public.lotes set origem = 'manual'
    where id = '91000000-0000-0000-0000-000000000202';
  exception when check_violation then
    return;
  end;
  raise exception 'lote com árvore inválida foi convertido de planilha para manual';
end;
$$;

-- A raiz da árvore não pode trocar de tenant depois que os filhos existem.
do $$
begin
  begin
    update public.lotes
    set org_id = '91000000-0000-0000-0000-000000000002'
    where id = '91000000-0000-0000-0000-000000000202';
  exception when check_violation then
    return;
  end;
  raise exception 'lote trocou de organização depois de criar os filhos';
end;
$$;

rollback;
