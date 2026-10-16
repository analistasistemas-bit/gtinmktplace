\set ON_ERROR_STOP on
-- ADR-0181 Plano 2b-2, Task 3: `estoque_movimentos.ordem` e `inventario_calcular` (custo médio
-- ponderado móvel de aquisição). Cenários e valores do brief da Task 3; replay da spec
-- §Critério de avaliação. Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/inventario_calculo.sql <migration>
begin;
insert into public.organizations (id, nome, slug) values
  ('93300000-0000-0000-0000-000000000001', 'Inventario test', 'inventario-test');
insert into auth.users (id, email, raw_user_meta_data) values
  ('93300000-0000-0000-0000-000000000101', 'inventario@test.local',
   '{"org_id":"93300000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('93300000-0000-0000-0000-000000000101', '93300000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;

-- Relógio da fixture: `now()` é fixo na transação, então famílias e movimentos recebem
-- `criado_em` explícito e estritamente crescente (empate com o marco conta como "antes").
create temp sequence inv_relogio;
create function pg_temp.ts() returns timestamptz language sql as
  $$ select timestamptz '2026-01-01 00:00:00+00' + nextval('inv_relogio') * interval '1 minute' $$;

-- Família nova (lote próprio: unique (lote_id, codigo_pai)) com uma variação. 'planilha' = marco;
-- 'manual' CREATE = cadastro (saldo 0); 'manual' UPDATE = clone do "adicionar variação".
create function pg_temp.fam(p_pai text, p_codigo text, p_origem text, p_estoque int,
  p_operacao text default 'CREATE', p_ncm text default '62034900') returns uuid language plpgsql as $$
declare v_lote uuid := gen_random_uuid(); v_fam uuid := gen_random_uuid();
begin
  insert into public.lotes (id, user_id, org_id, status, origem) values (v_lote,
    '93300000-0000-0000-0000-000000000101', '93300000-0000-0000-0000-000000000001', 'processando', p_origem);
  insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem,
    chave_cadastro, ncm, unidade, criado_em)
  values (v_fam, v_lote, '93300000-0000-0000-0000-000000000101', '93300000-0000-0000-0000-000000000001',
    p_pai, 'Produto ' || p_pai, p_operacao::public.operacao_ml, 'nacional', gen_random_uuid(), p_ncm, 'UN', pg_temp.ts());
  if p_codigo is not null then
    insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, tamanho, preco, estoque)
    values (v_fam, '93300000-0000-0000-0000-000000000101', '93300000-0000-0000-0000-000000000001',
      p_codigo, 'Azul M', 'Azul', 'M', 50, p_estoque);
  end if;
  return v_fam;
end $$;

create function pg_temp.carimbar(p_ref text, p_ts timestamptz default null) returns void language sql as $$
  update public.estoque_movimentos set criado_em = coalesce(p_ts, pg_temp.ts())
   where org_id = '93300000-0000-0000-0000-000000000001' and referencia_externa = p_ref $$;

-- "Nota": linhas de nota importada + a entrada `nfe:{chave}:{n_item}:{codigo}` no ledger (p_mov).
-- Devolve a ref.
create function pg_temp.nota(p_codigo text, p_chave text, p_n int, p_qtd int, p_custo numeric,
  p_mov boolean default true, p_ts timestamptz default null) returns text language plpgsql as $$
declare v_nota uuid; v_item uuid; v_ref text := 'nfe:' || p_chave || ':' || p_n || ':' || p_codigo;
begin
  select id into v_nota from public.notas_compra
   where org_id = '93300000-0000-0000-0000-000000000001' and chave = p_chave;
  if v_nota is null then
    insert into public.notas_compra (org_id, chave, numero, serie, emitente_cnpj, emitente_nome, emitida_em,
      valor_total, assinada, xml_path)
    values ('93300000-0000-0000-0000-000000000001', p_chave, 1, 1, '11222333000181', 'Fornecedor Teste', now(),
      0, false, '93300000-0000-0000-0000-000000000001/x.xml')
    returning id into v_nota;
  end if;
  insert into public.notas_compra_itens (nota_id, org_id, n_item, cprod, xprod, cfop, ucom, qcom, v_prod, codigo_pai)
  values (v_nota, '93300000-0000-0000-0000-000000000001', p_n, 'REF', 'Item', '5102', 'UN', p_qtd,
    p_qtd * p_custo, 'X')
  returning id into v_item;
  insert into public.notas_compra_distribuicao (item_id, org_id, codigo, quantidade, custo_aquisicao_unit,
    custo_precificacao_unit)
  values (v_item, '93300000-0000-0000-0000-000000000001', p_codigo, p_qtd, p_custo, round(p_custo * 1.4, 2));
  if p_mov then
    perform public.registrar_entrada('93300000-0000-0000-0000-000000000001', p_codigo, p_qtd, null, 'NF', null,
      '93300000-0000-0000-0000-000000000101', v_ref);
    perform pg_temp.carimbar(v_ref, p_ts);
  end if;
  return v_ref;
end $$;

create function pg_temp.venda(p_codigo text, p_qtd int) returns text language plpgsql as $$
declare v_ref text := 'teste-venda:' || gen_random_uuid();
begin
  perform public.baixar_estoque('93300000-0000-0000-0000-000000000001', p_codigo, p_qtd, 'mercado_livre', v_ref);
  perform pg_temp.carimbar(v_ref);
  return v_ref;
end $$;

create function pg_temp.entrada(p_codigo text, p_qtd int, p_ref text default null) returns text language plpgsql as $$
declare v_ref text := coalesce(p_ref, 'teste-entrada:' || gen_random_uuid());
begin
  perform public.registrar_entrada('93300000-0000-0000-0000-000000000001', p_codigo, p_qtd, 9, 'Entrada manual',
    null, '93300000-0000-0000-0000-000000000101', v_ref);
  perform pg_temp.carimbar(v_ref);
  return v_ref;
end $$;

create function pg_temp.excluir(p_fam uuid) returns void language sql as
  $$ delete from public.familias where id = p_fam $$;

-- Confere uma linha de inventario_calcular. Marcas: conjunto EXATO ("—" = vazio).
create function pg_temp.confere(p_codigo text, p_qv int, p_qsn int, p_custo numeric, p_valor numeric,
  p_marcas text[]) returns void language plpgsql as $$
declare r record;
begin
  select * into r from public.inventario_calcular('93300000-0000-0000-0000-000000000001') i where i.codigo = p_codigo;
  if not found then raise exception '% ausente do inventário', p_codigo; end if;
  if r.qtd_valorizada is distinct from p_qv or r.qtd_sem_nota is distinct from p_qsn
     or r.custo_medio is distinct from p_custo or r.valor_total is distinct from p_valor
     or (select coalesce(array_agg(x order by x), '{}') from unnest(r.marcas) x)
        is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(p_marcas) x) then
    raise exception '% esperado qv=% qsn=% custo=% valor=% marcas=%, veio %', p_codigo, p_qv, p_qsn, p_custo,
      p_valor, p_marcas, row_to_json(r);
  end if;
end $$;

-- Cenário G precisa assumir o papel das RPCs (desfeito no rollback, como 20260903002527:18).
grant estoque_rpc_executor to postgres;

-- ---------------------------------------------------------------------------------------------
-- Cenários (um produto por cenário: pai 0933XX00, SKU 0933XX01)
-- ---------------------------------------------------------------------------------------------
do $$
declare v_fam uuid; v_ref text; v_ref2 text; v_ts timestamptz; v_ordem bigint; v_nota uuid;
begin
  -- ordem: mesmo SKU nos itens 1 e 2 da nota, mesma transação (mesmo criado_em).
  perform pg_temp.fam('09330100', '09330101', 'manual', 0);
  v_ts := pg_temp.ts();
  v_ref := pg_temp.nota('09330101', '93300000000000000000000000000000000000000001', 1, 10, 10, true, v_ts);
  v_ref2 := pg_temp.nota('09330101', '93300000000000000000000000000000000000000001', 2, 10, 20, true, v_ts);
  if (select ordem from public.estoque_movimentos where referencia_externa = v_ref)
     >= (select ordem from public.estoque_movimentos where referencia_externa = v_ref2) then
    raise exception 'ordem: item 1 deveria vir antes do item 2 (mesmo criado_em)';
  end if;

  -- A: planilha 5 → nota 10 @ 10 → venda 7
  perform pg_temp.fam('09330200', '09330201', 'planilha', 5);
  perform pg_temp.nota('09330201', '93300000000000000000000000000000000000000002', 1, 10, 10);
  perform pg_temp.venda('09330201', 7);

  -- B: nota 10 @ 10 → venda 10 → entrada manual 10
  perform pg_temp.fam('09330300', '09330301', 'manual', 0);
  perform pg_temp.nota('09330301', '93300000000000000000000000000000000000000003', 1, 10, 10);
  perform pg_temp.venda('09330301', 10);
  perform pg_temp.entrada('09330301', 10);

  -- C: nota 10 @ 10 → venda 5 → nota 10 @ 20
  perform pg_temp.fam('09330400', '09330401', 'manual', 0);
  perform pg_temp.nota('09330401', '93300000000000000000000000000000000000000004', 1, 10, 10);
  perform pg_temp.venda('09330401', 5);
  perform pg_temp.nota('09330401', '93300000000000000000000000000000000000000014', 1, 10, 20);

  -- D: nota 10 @ 10 → venda 10 → nota 4 @ 30
  perform pg_temp.fam('09330500', '09330501', 'manual', 0);
  perform pg_temp.nota('09330501', '93300000000000000000000000000000000000000005', 1, 10, 10);
  perform pg_temp.venda('09330501', 10);
  perform pg_temp.nota('09330501', '93300000000000000000000000000000000000000015', 1, 4, 30);

  -- E: nota 10 @ 10 → planilha 0 → planilha 10
  perform pg_temp.fam('09330600', '09330601', 'manual', 0);
  perform pg_temp.nota('09330601', '93300000000000000000000000000000000000000006', 1, 10, 10);
  perform pg_temp.fam('09330600', '09330601', 'planilha', 0);
  perform pg_temp.fam('09330600', '09330601', 'planilha', 10);

  -- F: nota 10 @ 10 → planilha −5 → nota 10 @ 20
  perform pg_temp.fam('09330700', '09330701', 'manual', 0);
  perform pg_temp.nota('09330701', '93300000000000000000000000000000000000000007', 1, 10, 10);
  perform pg_temp.fam('09330700', '09330701', 'planilha', -5);
  perform pg_temp.nota('09330701', '93300000000000000000000000000000000000000017', 1, 10, 20);

  -- G: nota 10 @ 10 → update direto estoque = 3 (lacuna) → venda 1
  perform pg_temp.fam('09330800', '09330801', 'manual', 0);
  perform pg_temp.nota('09330801', '93300000000000000000000000000000000000000008', 1, 10, 10);
  set local role estoque_rpc_executor;   -- o guard só libera este papel (20260804113000:56-60)
  update public.variacoes set estoque = 3 where org_id = '93300000-0000-0000-0000-000000000001' and codigo = '09330801';
  reset role;
  perform pg_temp.venda('09330801', 1);

  -- H1: nota 10 @ 10 → exclui a família → planilha 10 (sem limpeza)
  v_fam := pg_temp.fam('09330900', '09330901', 'manual', 0);
  perform pg_temp.nota('09330901', '93300000000000000000000000000000000000000009', 1, 10, 10);
  perform pg_temp.excluir(v_fam);
  perform pg_temp.fam('09330900', '09330901', 'planilha', 10);

  -- H2: nota 10 @ 10 → exclui → cadastro manual (saldo 0) + entrada 10 ref cadastro:x:y
  v_fam := pg_temp.fam('09331000', '09331001', 'manual', 0);
  perform pg_temp.nota('09331001', '93300000000000000000000000000000000000000010', 1, 10, 10);
  perform pg_temp.excluir(v_fam);
  v_fam := pg_temp.fam('09331000', '09331001', 'manual', 0);
  perform pg_temp.entrada('09331001', 10, 'cadastro:' || v_fam || ':09331001');

  -- I: nota 10 @ 10 → clone (lote 'manual', UPDATE, copia estoque 10) → venda 2
  perform pg_temp.fam('09331100', '09331101', 'manual', 0);
  perform pg_temp.nota('09331101', '93300000000000000000000000000000000000000011', 1, 10, 10);
  perform pg_temp.fam('09331100', '09331101', 'manual', 10, 'UPDATE');
  perform pg_temp.venda('09331101', 2);

  -- J: nota 10 @ 10 + corte do backfill com ate_ordem = ordem da entrada
  perform pg_temp.fam('09331200', '09331201', 'manual', 0);
  v_ref := pg_temp.nota('09331201', '93300000000000000000000000000000000000000012', 1, 10, 10);
  insert into public.inventario_corte_backfill (org_id, codigo, ate_ordem)
  select org_id, codigo, ordem from public.estoque_movimentos
   where org_id = '93300000-0000-0000-0000-000000000001' and referencia_externa = v_ref;

  -- K: nota 10 @ 10 → desfazer
  perform pg_temp.fam('09331300', '09331301', 'manual', 0);
  perform pg_temp.nota('09331301', '93300000000000000000000000000000000000000013', 1, 10, 10);
  select id into v_nota from public.notas_compra where chave = '93300000000000000000000000000000000000000013';
  perform public.desfazer_nota_compra('93300000-0000-0000-0000-000000000001',
    '93300000-0000-0000-0000-000000000101', v_nota, 'desfeita');
  perform pg_temp.carimbar('nfe-desfazer:93300000000000000000000000000000000000000013:09331301');

  -- L: entrada pendente de nota (antes das linhas) → depois as linhas, custo 12
  perform pg_temp.fam('09331400', '09331401', 'manual', 0);
  v_ref := 'nfe:93300000000000000000000000000000000000000020:1:09331401';
  perform public.registrar_entrada_nota_pendente('93300000-0000-0000-0000-000000000001',
    '93300000000000000000000000000000000000000020', '09331401', 10, 16.8, 'NF',
    '93300000-0000-0000-0000-000000000101', v_ref);
  perform pg_temp.carimbar(v_ref);
  perform pg_temp.nota('09331401', '93300000000000000000000000000000000000000020', 1, 10, 12, false);

  -- M: linhas de nota importada sem o movimento nfe: + planilha 3
  perform pg_temp.fam('09331500', '09331501', 'planilha', 3);
  perform pg_temp.nota('09331501', '93300000000000000000000000000000000000000021', 1, 10, 10, false);

  -- N: planilha 7 (com descrição fiscal); O: planilha −3
  v_fam := pg_temp.fam('09331600', '09331601', 'planilha', 7);
  update public.familias set descricao_fiscal = 'Descricao fiscal N' where id = v_fam;
  perform pg_temp.fam('09331700', '09331701', 'planilha', -3);

  -- P: nota 10 @ 1 → planilha 10 → nota 10 @ 100 → venda 10
  perform pg_temp.fam('09331800', '09331801', 'manual', 0);
  perform pg_temp.nota('09331801', '93300000000000000000000000000000000000000022', 1, 10, 1);
  perform pg_temp.fam('09331800', '09331801', 'planilha', 10);
  perform pg_temp.nota('09331801', '93300000000000000000000000000000000000000023', 1, 10, 100);
  perform pg_temp.venda('09331801', 10);

  -- Q: família com 1 variação + família mais nova do mesmo codigo_pai sem variação
  perform pg_temp.fam('09331900', '09331901', 'manual', 0);
  perform pg_temp.fam('09331900', null, 'manual', 0);

  -- Kit vinculado (fora do inventário) e NCM ausente.
  v_fam := pg_temp.fam('09332000', '09332001', 'manual', 0);
  update public.familias set kit_base_codigo_pai = '09330200', kit_multiplicador = 2 where id = v_fam;
  perform pg_temp.fam('09332100', '09332101', 'planilha', 2, 'CREATE', null);
end $$;

do $$
declare r record; v_n int;
begin
  perform pg_temp.confere('09330101', 20, 0, 15.000000, 300.00, '{}');
  perform pg_temp.confere('09330201', 8, 0, 10.000000, 80.00, '{}');
  perform pg_temp.confere('09330301', 0, 10, null, 0.00, '{sem_nota}');
  perform pg_temp.confere('09330401', 15, 0, 16.666667, 250.00, '{}');
  perform pg_temp.confere('09330501', 4, 0, 30.000000, 120.00, '{}');
  perform pg_temp.confere('09330601', 0, 10, null, 0.00, '{historico_incompleto,sem_nota}');
  perform pg_temp.confere('09330701', 5, 0, 20.000000, 100.00, '{historico_incompleto}');
  perform pg_temp.confere('09330801', 0, 2, null, 0.00, '{historico_incompleto,sem_nota}');
  perform pg_temp.confere('09330901', 0, 10, null, 0.00, '{historico_incompleto,sem_nota}');
  perform pg_temp.confere('09331001', 0, 10, null, 0.00, '{historico_incompleto,sem_nota}');
  perform pg_temp.confere('09331101', 8, 0, 10.000000, 80.00, '{}');
  perform pg_temp.confere('09331201', 0, 10, null, 0.00, '{historico_incompleto,sem_nota}');
  perform pg_temp.confere('09331301', 0, 0, null, 0.00, '{}');
  perform pg_temp.confere('09331401', 10, 0, 12.000000, 120.00, '{}');
  perform pg_temp.confere('09331501', 0, 3, null, 0.00, '{historico_incompleto,sem_nota}');
  perform pg_temp.confere('09331601', 0, 7, null, 0.00, '{sem_nota}');
  perform pg_temp.confere('09331701', 0, 0, null, 0.00, '{saldo_negativo}');
  perform pg_temp.confere('09331801', 10, 0, 100.000000, 1000.00, '{historico_incompleto}');
  perform pg_temp.confere('09331901', 0, 0, null, 0.00, '{}');
  perform pg_temp.confere('09332101', 0, 2, null, 0.00, '{sem_nota,ncm_ausente}');

  -- H1′/H2′: limpar_movimentos_orfaos preserva (o código existe de novo) e o resultado não muda.
  perform public.limpar_movimentos_orfaos('93300000-0000-0000-0000-000000000001');
  if (select count(*) from public.estoque_movimentos where org_id = '93300000-0000-0000-0000-000000000001'
       and codigo in ('09330901', '09331001') and referencia_externa like 'nfe:%') <> 2 then
    raise exception 'limpar_movimentos_orfaos apagou o histórico de código recriado';
  end if;
  perform pg_temp.confere('09330901', 0, 10, null, 0.00, '{historico_incompleto,sem_nota}');
  perform pg_temp.confere('09331001', 0, 10, null, 0.00, '{historico_incompleto,sem_nota}');

  -- Q: o SKU sai com o codigo_pai, e só uma vez. Kit vinculado fora.
  select count(*) into v_n from public.inventario_calcular('93300000-0000-0000-0000-000000000001') i
   where i.codigo = '09331901' and i.codigo_pai = '09331900';
  if v_n <> 1 then raise exception 'Q: SKU da família anterior deveria aparecer 1 vez (veio %)', v_n; end if;
  if exists (select 1 from public.inventario_calcular('93300000-0000-0000-0000-000000000001') i
              where i.codigo = '09332001') then
    raise exception 'kit vinculado não pode entrar no inventário';
  end if;

  -- Colunas descritivas: descrição = coalesce(descricao_fiscal, nome_pai); NCM, unidade, cor, tamanho, saldo.
  select * into r from public.inventario_calcular('93300000-0000-0000-0000-000000000001') i where i.codigo = '09331601';
  if r.descricao is distinct from 'Descricao fiscal N' then raise exception 'descrição fiscal: %', row_to_json(r); end if;
  select * into r from public.inventario_calcular('93300000-0000-0000-0000-000000000001') i where i.codigo = '09331701';
  if r.descricao is distinct from 'Produto 09331700' or r.ncm is distinct from '62034900'
     or r.unidade is distinct from 'UN' or r.cor is distinct from 'Azul' or r.tamanho is distinct from 'M'
     or r.quantidade_sistema is distinct from -3 or r.codigo_pai is distinct from '09331700' then
    raise exception 'colunas descritivas: %', row_to_json(r);
  end if;
  select * into r from public.inventario_calcular('93300000-0000-0000-0000-000000000001') i where i.codigo = '09332101';
  if r.ncm is not null then raise exception 'NCM ausente deveria vir nulo: %', row_to_json(r); end if;

  -- Propriedades em todas as linhas: qv ≤ unidades de nota importada do código; qv + qsn = max(saldo, 0);
  -- custo médio entre o menor e o maior custo de aquisição das notas do código.
  for r in
    select i.*, (select sum(d.quantidade) from public.notas_compra_distribuicao d
                   join public.notas_compra_itens it on it.id = d.item_id
                   join public.notas_compra n on n.id = it.nota_id
                  where d.org_id = i_org.id and d.codigo = i.codigo and n.status = 'importada') as q_notas,
           (select min(d.custo_aquisicao_unit) from public.notas_compra_distribuicao d
             where d.org_id = i_org.id and d.codigo = i.codigo) as u_min,
           (select max(d.custo_aquisicao_unit) from public.notas_compra_distribuicao d
             where d.org_id = i_org.id and d.codigo = i.codigo) as u_max
      from (select '93300000-0000-0000-0000-000000000001'::uuid as id) i_org
      cross join public.inventario_calcular(i_org.id) i
  loop
    if r.qtd_valorizada > coalesce(r.q_notas, 0)
       or r.qtd_valorizada + r.qtd_sem_nota <> greatest(r.quantidade_sistema, 0)
       or r.qtd_valorizada < 0 or r.qtd_sem_nota < 0
       or (r.custo_medio is not null and (r.custo_medio < r.u_min or r.custo_medio > r.u_max))
       or ((r.qtd_valorizada = 0) <> (r.custo_medio is null))
       or (r.qtd_valorizada = 0 and r.valor_total <> 0) then
      raise exception 'propriedade violada: %', row_to_json(r);
    end if;
  end loop;
  select count(*) into v_n from public.inventario_calcular('93300000-0000-0000-0000-000000000001');
  if v_n <> 20 then raise exception 'esperado 20 SKUs no inventário da fixture, veio %', v_n; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- `ordem` pelas 4 RPCs (entrada, venda, estorno, ajuste), crescente e acima do backfill.
-- (Nenhum insert já com estoque_resultante: a Task 2 mediu que não existe esse caminho.)
-- ---------------------------------------------------------------------------------------------
do $$
declare v_venda text; o1 bigint; o2 bigint; o3 bigint; o4 bigint;
begin
  perform pg_temp.fam('09332400', '09332401', 'manual', 0);
  perform public.registrar_entrada('93300000-0000-0000-0000-000000000001', '09332401', 10, null, 'X', null,
    '93300000-0000-0000-0000-000000000101', 'teste-ordem-entrada');
  v_venda := 'teste-ordem-venda';
  perform public.baixar_estoque('93300000-0000-0000-0000-000000000001', '09332401', 3, 'mercado_livre', v_venda);
  perform public.estornar_estoque('93300000-0000-0000-0000-000000000001', 'mercado_livre', v_venda, '09332401');
  perform public.ajustar_estoque('93300000-0000-0000-0000-000000000001', '09332401', 5, 'aj',
    '93300000-0000-0000-0000-000000000101', 'teste-ordem-ajuste');
  select ordem into o1 from public.estoque_movimentos where referencia_externa = 'teste-ordem-entrada';
  select ordem into o2 from public.estoque_movimentos where referencia_externa = v_venda;
  select ordem into o3 from public.estoque_movimentos where referencia_externa = 'estorno:' || v_venda;
  select ordem into o4 from public.estoque_movimentos where referencia_externa = 'teste-ordem-ajuste';
  if o1 is null or o2 is null or o3 is null or o4 is null or not (o1 < o2 and o2 < o3 and o3 < o4) then
    raise exception 'ordem das RPCs: entrada=% venda=% estorno=% ajuste=%', o1, o2, o3, o4;
  end if;
  -- Backfill (Ruling 4): toda linha anterior à migration numerada; o trigger só numera depois dela.
  if exists (select 1 from public.estoque_movimentos
              where org_id <> '93300000-0000-0000-0000-000000000001' and ordem is null) then
    raise exception 'backfill deixou movimento existente sem ordem';
  end if;
  if (select min(ordem) from public.estoque_movimentos where org_id = '93300000-0000-0000-0000-000000000001')
     <= (select coalesce(max(ordem), 0) from public.estoque_movimentos
          where org_id <> '93300000-0000-0000-0000-000000000001') then
    raise exception 'movimento novo recebeu ordem <= ordem do backfill';
  end if;
end $$;

-- Privilégios: só service_role executa.
do $$
begin
  if has_function_privilege('anon', 'public.inventario_calcular(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.inventario_calcular(uuid)', 'execute') then
    raise exception 'inventario_calcular não pode ser executável por anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.inventario_calcular(uuid)', 'execute') then
    raise exception 'service_role precisa executar inventario_calcular';
  end if;
  if has_table_privilege('authenticated', 'public.inventario_corte_backfill', 'select')
     or has_table_privilege('anon', 'public.inventario_corte_backfill', 'select') then
    raise exception 'inventario_corte_backfill não pode ser legível por anon/authenticated';
  end if;
end $$;
set local role service_role;
do $$
begin
  if (select count(*) from public.inventario_calcular('93300000-0000-0000-0000-000000000001')) = 0 then
    raise exception 'service_role leu inventário vazio';
  end if;
end $$;
reset role;
rollback;
