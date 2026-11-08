\set ON_ERROR_STOP on
-- ADR-0199 (migration kit_variacao_schema): composição imutável, exclusão única por SKU, faixas,
-- ledger com transferencia_id, RLS por org e recusa de desligar o módulo.
-- Fixtures só dentro da transação desfeita (scripts/teste-sql-desfeito.py).
begin;

-- Org A = org de uma variação real com saldo; usuário A (mesma org), usuário B (outra org ativa).
create temp table ctx on commit drop as
select v.org_id as org_a, v.codigo as sku_com_saldo,
  (select p.id from public.profiles p where p.is_active and p.org_id = v.org_id limit 1) as user_a,
  (select p.id from public.profiles p where p.is_active and p.org_id is not null and p.org_id <> v.org_id
     and not p.is_super_admin limit 1) as user_b,
  gen_random_uuid() as kit, gen_random_uuid() as sku, gen_random_uuid() as transf
from public.variacoes v
where v.org_id is not null and v.estoque > 0
  and exists (select 1 from public.profiles p where p.is_active and p.org_id = v.org_id)
limit 1;
grant select on ctx to authenticated, service_role;

set local role service_role;
do $$
declare c record; v text; n int; r jsonb; antes text[];
begin
  select * into c from ctx;
  if c.user_a is null or c.user_b is null then raise exception 'fixtures ausentes: %', c; end if;

  insert into public.kits_variacao (id, org_id, codigo_pai_base, codigo_pai_kit, pecas_por_kit, preco)
  values (c.kit, c.org_a, 'BASE_TESTE_0197', 'KIT_TESTE_0197', 2, 99.90);
  insert into public.kit_variacao_skus (id, org_id, kit_id, codigo, tamanho, cores, rotulo_cor)
  values (c.sku, c.org_a, c.kit, 'KITSKU_TESTE_0197', 'M', array['Preto','Branco'], 'Preto + Branco');
  insert into public.kit_variacao_componentes (org_id, kit_sku_id, codigo, quantidade)
  values (c.org_a, c.sku, 'PECA_TESTE_0197', 1);

  -- pecas_por_kit fora de 2..6 e meta negativa.
  foreach n in array array[1, 7] loop
    begin
      insert into public.kits_variacao (org_id, codigo_pai_base, codigo_pai_kit, pecas_por_kit, preco)
      values (c.org_a, 'BASE_TESTE_0197', 'KIT_FAIXA_0197', n, 99.90);
      raise exception 'pecas_por_kit = % aceito', n;
    exception when check_violation then null;
    end;
  end loop;
  begin
    update public.kits_variacao set meta = -1 where id = c.kit;
    raise exception 'meta negativa aceita';
  exception when check_violation then null;
  end;

  -- Código do SKU do kit é único por org.
  begin
    insert into public.kit_variacao_skus (org_id, kit_id, codigo, tamanho, cores, rotulo_cor)
    values (c.org_a, c.kit, 'KITSKU_TESTE_0197', 'G', array['Preto','Branco'], 'Preto + Branco');
    raise exception 'codigo de SKU do kit duplicado na org';
  exception when unique_violation then null;
  end;

  -- Composição imutável, inclusive para o service role.
  begin
    update public.kit_variacao_componentes set quantidade = 2 where kit_sku_id = c.sku;
    raise exception 'update em componente passou';
  exception when restrict_violation then null;
  end;
  begin
    delete from public.kit_variacao_componentes where kit_sku_id = c.sku;
    raise exception 'delete em componente passou';
  exception when restrict_violation then null;
  end;
  begin
    delete from public.kit_variacao_skus where id = c.sku;
    raise exception 'delete de SKU com composição passou';
  exception when foreign_key_violation or restrict_violation then null;
  end;

  -- Política, reivindicação e exclusão: uma exclusão só por SKU, de qualquer dono.
  insert into public.sku_politica_kit (org_id, codigo) values (c.org_a, 'PECA_TESTE_0197');
  begin
    update public.sku_politica_kit set estado = 'pausado' where org_id = c.org_a;
    raise exception 'estado inválido aceito';
  exception when check_violation then null;
  end;
  insert into public.sku_reivindicacoes_kit (org_id, codigo, kit_id) values (c.org_a, 'PECA_TESTE_0197', c.kit);
  insert into public.kit_exclusoes (org_id, codigo, up_id, dono_tipo, dono_id)
  values (c.org_a, 'PECA_TESTE_0197', 'MLBU_TESTE', 'transferencia', c.transf);
  begin
    insert into public.kit_exclusoes (org_id, codigo, dono_tipo, dono_id)
    values (c.org_a, 'PECA_TESTE_0197', 'publicacao', gen_random_uuid());
    raise exception 'segunda exclusão no mesmo SKU passou';
  exception when unique_violation then null;
  end;
  begin
    insert into public.kit_exclusoes (org_id, codigo, dono_tipo, dono_id)
    values (c.org_a, 'OUTRO_TESTE_0197', 'operador', gen_random_uuid());
    raise exception 'dono_tipo inválido aceito';
  exception when check_violation then null;
  end;

  -- Transferência: tipo, estado e kit obrigatório quando a operação é de um kit.
  insert into public.kit_transferencias (id, org_id, kit_id, tipo, versao_politica, itens)
  values (c.transf, c.org_a, c.kit, 'montar', 1, '[{"codigo":"PECA_TESTE_0197","quantidade":1}]');
  if (select passo || '/' || estado from public.kit_transferencias where id = c.transf) <> 'pausar/ativa' then
    raise exception 'passo/estado inicial errado';
  end if;
  insert into public.kit_transferencia_alvos (transferencia_id, org_id, up_id, item_ids)
  values (c.transf, c.org_a, 'MLBU_TESTE', array['MLB1']);
  foreach v in array array['vender', 'entrada_x'] loop
    begin
      insert into public.kit_transferencias (org_id, kit_id, tipo, versao_politica)
      values (c.org_a, c.kit, v, 1);
      raise exception 'tipo % aceito', v;
    exception when check_violation then null;
    end;
  end loop;
  begin
    update public.kit_transferencias set estado = 'pendente' where id = c.transf;
    raise exception 'estado de transferência inválido aceito';
  exception when check_violation then null;
  end;
  begin
    insert into public.kit_transferencias (org_id, tipo, versao_politica) values (c.org_a, 'montar', 1);
    raise exception 'montar sem kit aceito';
  exception when check_violation then null;
  end;
  insert into public.kit_transferencias (org_id, tipo, versao_politica) values (c.org_a, 'entrada', 1);
  delete from public.kit_transferencias where org_id = c.org_a and tipo = 'entrada' and kit_id is null;

  -- Ledger: motivos novos, idempotência por transferência, motivos antigos preservados.
  insert into public.estoque_movimentos (org_id, codigo, quantidade, motivo, transferencia_id)
  values (c.org_a, 'PECA_TESTE_0197', -1, 'kit_saida', c.transf),
         (c.org_a, 'KITSKU_TESTE_0197', 1, 'kit_entrada', c.transf);
  begin
    insert into public.estoque_movimentos (org_id, codigo, quantidade, motivo, transferencia_id)
    values (c.org_a, 'PECA_TESTE_0197', -1, 'kit_saida', c.transf);
    raise exception 'movimento repetido na mesma transferência passou';
  exception when unique_violation then null;
  end;
  begin
    insert into public.estoque_movimentos (org_id, codigo, quantidade, motivo)
    values (c.org_a, 'PECA_TESTE_0197', 1, 'kit_invalido');
    raise exception 'motivo desconhecido aceito';
  exception when check_violation then null;
  end;
  -- Movimento sem transferência segue livre do índice novo.
  insert into public.estoque_movimentos (org_id, codigo, quantidade, motivo)
  values (c.org_a, 'PECA_TESTE_0197', 0, 'ajuste'), (c.org_a, 'PECA_TESTE_0197', 0, 'ajuste');
  foreach v in array array['venda', 'entrada', 'estorno_venda', 'venda_sku_nao_encontrado',
      'estorno_sku_nao_encontrado', 'cancelamento_sem_baixa', 'venda_cancelada_antes', 'ajuste'] loop
    if position('''' || v || '''' in (select pg_get_constraintdef(oid) from pg_constraint
        where conname = 'estoque_movimentos_motivo_check')) = 0 then
      raise exception 'motivo % perdido', v;
    end if;
  end loop;

  -- Desligar o módulo: transferência aberta e saldo recusam; concluído e sem saldo liberam.
  if public.kit_variacao_recusa_desligar(c.org_a) is null then
    raise exception 'transferência ativa não recusou';
  end if;
  update public.kit_transferencias set estado = 'travada' where id = c.transf;
  if public.kit_variacao_recusa_desligar(c.org_a) is null then
    raise exception 'transferência travada não recusou';
  end if;
  select modulos_habilitados into antes from public.organizations where id = c.org_a;
  r := public.set_modulos_org_seguro(c.org_a, array['estoque']);
  if (r->>'ok')::boolean or r->>'motivo' not like '%transferência%' then
    raise exception 'RPC não recusou transferência aberta: %', r;
  end if;
  if (select modulos_habilitados from public.organizations where id = c.org_a) is distinct from antes then
    raise exception 'RPC gravou módulos mesmo recusando';
  end if;
  update public.kit_transferencias set estado = 'concluida' where id = c.transf;
  if public.kit_variacao_recusa_desligar(c.org_a) is not null then
    raise exception 'kit sem saldo nem transferência recusou: %', public.kit_variacao_recusa_desligar(c.org_a);
  end if;
  insert into public.kit_variacao_skus (org_id, kit_id, codigo, tamanho, cores, rotulo_cor)
  values (c.org_a, c.kit, c.sku_com_saldo, 'G', array['Preto','Branco'], 'Preto + Branco');
  if public.kit_variacao_recusa_desligar(c.org_a) is null then
    raise exception 'kit com saldo não recusou';
  end if;

  -- RPC: manter o módulo grava mesmo com saldo; retirá-lo com saldo recusa sem gravar.
  r := public.set_modulos_org_seguro(c.org_a, array['kit_variacao']);
  if not (r->>'ok')::boolean then raise exception 'manter o módulo recusou: %', r; end if;
  if (select modulos_habilitados from public.organizations where id = c.org_a) is distinct from array['kit_variacao'] then
    raise exception 'RPC não gravou os módulos';
  end if;
  r := public.set_modulos_org_seguro(c.org_a, array[]::text[]);
  if (r->>'ok')::boolean or r->>'motivo' not like '%saldo%' then
    raise exception 'RPC não recusou kit com saldo: %', r;
  end if;
  if (select modulos_habilitados from public.organizations where id = c.org_a) is distinct from array['kit_variacao'] then
    raise exception 'RPC gravou módulos mesmo recusando saldo';
  end if;
  r := public.set_modulos_org_seguro(gen_random_uuid(), array[]::text[]);
  if (r->>'ok')::boolean then raise exception 'org inexistente aceita: %', r; end if;

  -- Sem kit com saldo nem transferência aberta, desligar passa pela RPC. A linha do SKU com saldo
  -- sai antes: ela não tem composição, então o delete é livre.
  delete from public.kit_variacao_skus where org_id = c.org_a and codigo = c.sku_com_saldo;
  r := public.set_modulos_org_seguro(c.org_a, array[]::text[]);
  if not (r->>'ok')::boolean then raise exception 'desligar sem pendência recusou: %', r; end if;

  -- Corrida: concorrência real de duas sessões não cabe em transação desfeita. Aqui a prova é a
  -- leitura do corpo: trava a linha antes de validar, e valida antes de gravar.
  select lower(pg_get_functiondef('public.set_modulos_org_seguro(uuid, text[])'::regprocedure)) into v;
  if position('for update' in v) = 0
    or position('for update' in v) > position('kit_variacao_recusa_desligar' in v)
    or position('kit_variacao_recusa_desligar' in v) > position('update public.organizations' in v) then
    raise exception 'set_modulos_org_seguro fora da ordem trava, valida, grava';
  end if;
end $$;
reset role;

-- Usuário A lê a própria org.
select set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true) from ctx;
set local role authenticated;
do $$
declare c record;
begin
  select * into c from ctx;
  if not exists (select 1 from public.kits_variacao where id = c.kit)
    or not exists (select 1 from public.kit_variacao_skus where id = c.sku)
    or not exists (select 1 from public.kit_variacao_componentes where kit_sku_id = c.sku)
    or not exists (select 1 from public.sku_politica_kit where org_id = c.org_a)
    or not exists (select 1 from public.sku_reivindicacoes_kit where kit_id = c.kit)
    or not exists (select 1 from public.kit_transferencias where id = c.transf)
    or not exists (select 1 from public.kit_transferencia_alvos where transferencia_id = c.transf)
    or not exists (select 1 from public.kit_exclusoes where org_id = c.org_a) then
    raise exception 'usuário A não lê a própria org';
  end if;
  -- Escrita só por service role, mesmo na própria org.
  begin
    update public.kits_variacao set meta = 1 where id = c.kit;
    raise exception 'authenticated conseguiu atualizar kit';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.kit_exclusoes where org_id = c.org_a;
    raise exception 'authenticated conseguiu soltar exclusão';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.kit_variacao_recusa_desligar(c.org_a);
    raise exception 'authenticated conseguiu executar kit_variacao_recusa_desligar';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_modulos_org_seguro(c.org_a, array[]::text[]);
    raise exception 'authenticated conseguiu executar set_modulos_org_seguro';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Usuário B (outra org) não lê nada da org A.
select set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true) from ctx;
set local role authenticated;
do $$
declare c record; n int;
begin
  select * into c from ctx;
  if public.current_org_id() is null or public.current_org_id() = c.org_a then
    raise exception 'current_org_id do usuário B inválido: %', public.current_org_id();
  end if;
  select (select count(*) from public.kits_variacao where org_id = c.org_a)
       + (select count(*) from public.kit_variacao_skus where org_id = c.org_a)
       + (select count(*) from public.kit_variacao_componentes where org_id = c.org_a)
       + (select count(*) from public.sku_politica_kit where org_id = c.org_a)
       + (select count(*) from public.sku_reivindicacoes_kit where org_id = c.org_a)
       + (select count(*) from public.kit_transferencias where org_id = c.org_a)
       + (select count(*) from public.kit_transferencia_alvos where org_id = c.org_a)
       + (select count(*) from public.kit_exclusoes where org_id = c.org_a)
  into n;
  if n <> 0 then raise exception 'B vê % linhas da org A', n; end if;
  begin
    insert into public.kit_exclusoes (org_id, codigo, dono_tipo, dono_id)
    values (public.current_org_id(), 'X', 'publicacao', gen_random_uuid());
    raise exception 'authenticated conseguiu inserir exclusão';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
