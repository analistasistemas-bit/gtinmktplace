\set ON_ERROR_STOP on
-- ADR-0197 (Task 9): inventário (ADR-0181) em peças com kit com variação. Montar, trânsito, desmontar e
-- cancelar transferência não mexem em quantidade, custo nem nota; venda e estorno do kit contam em peças
-- (saldo do kit × composição). Prova principal: cada componente fica IGUAL a um SKU de controle comum que
-- recebe só as operações não-kit equivalentes (mesma nota, venda e estorno em peças).
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/kit_variacao_inventario.sql \
--   <migrations da branch em ordem> supabase/migrations/20261108031720_kit_variacao_inventario.sql
begin;

insert into public.organizations (id, nome, slug, modulos_habilitados, is_test) values
  ('97900000-0000-0000-0000-000000000001', 'Kit inventario', 'kit-inventario-teste', array['kit_variacao'], true);
insert into auth.users (id, email, raw_user_meta_data) values
  ('97900000-0000-0000-0000-000000000101', 'kit-inventario@teste.local',
   '{"org_id":"97900000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('97900000-0000-0000-0000-000000000101', '97900000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('97900000-0000-0000-0000-000000000201', '97900000-0000-0000-0000-000000000101',
   '97900000-0000-0000-0000-000000000001', 'processando', 'manual');
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro,
  ncm, unidade) values
  ('97900000-0000-0000-0000-000000000301', '97900000-0000-0000-0000-000000000201',
   '97900000-0000-0000-0000-000000000101', '97900000-0000-0000-0000-000000000001',
   '09790000', 'Blusa', 'CREATE', 'nacional', gen_random_uuid(), '62034900', 'UN'),
  ('97900000-0000-0000-0000-000000000302', '97900000-0000-0000-0000-000000000201',
   '97900000-0000-0000-0000-000000000101', '97900000-0000-0000-0000-000000000001',
   '09791000', 'Kit blusa', 'CREATE', 'nacional', gen_random_uuid(), '62034900', 'UN');
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, tamanho, preco, estoque)
select f, '97900000-0000-0000-0000-000000000101', '97900000-0000-0000-0000-000000000001', c, c, c, 'M', 50, 0
from (values
  ('97900000-0000-0000-0000-000000000301'::uuid, '09790001'),   -- P: preto
  ('97900000-0000-0000-0000-000000000301'::uuid, '09790002'),   -- B: branco
  ('97900000-0000-0000-0000-000000000301'::uuid, '09790003'),   -- A: azul (2 por kit)
  ('97900000-0000-0000-0000-000000000301'::uuid, '09790011'),   -- controle de P, fora de kit
  ('97900000-0000-0000-0000-000000000301'::uuid, '09790012'),   -- controle de B
  ('97900000-0000-0000-0000-000000000301'::uuid, '09790013'),   -- controle de A
  ('97900000-0000-0000-0000-000000000302'::uuid, '09791001'),   -- K1 = P + B
  ('97900000-0000-0000-0000-000000000302'::uuid, '09791002')    -- K2 = 2 × A
) x(f, c);

insert into public.kits_variacao (id, org_id, codigo_pai_base, codigo_pai_kit, pecas_por_kit, preco) values
  ('97900000-0000-0000-0000-000000000401', '97900000-0000-0000-0000-000000000001', '09790000', '09791000', 2, 99.90);
insert into public.kit_variacao_skus (id, org_id, kit_id, codigo, tamanho, cores, rotulo_cor) values
  ('97900000-0000-0000-0000-000000000501', '97900000-0000-0000-0000-000000000001',
   '97900000-0000-0000-0000-000000000401', '09791001', 'M', array['Preto','Branco'], 'Preto + Branco'),
  ('97900000-0000-0000-0000-000000000502', '97900000-0000-0000-0000-000000000001',
   '97900000-0000-0000-0000-000000000401', '09791002', 'M', array['Azul','Azul'], 'Azul + Azul');
insert into public.kit_variacao_componentes (kit_sku_id, org_id, codigo, quantidade) values
  ('97900000-0000-0000-0000-000000000501', '97900000-0000-0000-0000-000000000001', '09790001', 1),
  ('97900000-0000-0000-0000-000000000501', '97900000-0000-0000-0000-000000000001', '09790002', 1),
  ('97900000-0000-0000-0000-000000000502', '97900000-0000-0000-0000-000000000001', '09790003', 2);

-- Nota importada (uma linha de item por SKU). A entrada no ledger vem depois, pela RPC.
create function pg_temp.nota(p_codigo text, p_chave text, p_n int, p_qtd int, p_custo numeric) returns text
language plpgsql as $$
declare v_nota uuid; v_item uuid;
begin
  select id into v_nota from public.notas_compra
   where org_id = '97900000-0000-0000-0000-000000000001' and chave = p_chave;
  if v_nota is null then
    insert into public.notas_compra (org_id, chave, numero, serie, emitente_cnpj, emitente_nome, emitida_em,
      valor_total, assinada, xml_path)
    values ('97900000-0000-0000-0000-000000000001', p_chave, 1, 1, '11222333000181', 'Fornecedor Teste', now(),
      0, false, '97900000-0000-0000-0000-000000000001/x.xml')
    returning id into v_nota;
  end if;
  insert into public.notas_compra_itens (nota_id, org_id, n_item, cprod, xprod, cfop, ucom, qcom, v_prod, codigo_pai)
  values (v_nota, '97900000-0000-0000-0000-000000000001', p_n, 'REF', 'Item', '5102', 'UN', p_qtd,
    p_qtd * p_custo, '09790000')
  returning id into v_item;
  insert into public.notas_compra_distribuicao (item_id, org_id, codigo, quantidade, custo_aquisicao_unit,
    custo_precificacao_unit)
  values (v_item, '97900000-0000-0000-0000-000000000001', p_codigo, p_qtd, p_custo, round(p_custo * 1.4, 2));
  return 'nfe:' || p_chave || ':' || p_n || ':' || p_codigo;
end $$;

create temp table refs (codigo text primary key, ref text, qtd int);
grant select on refs to service_role;
insert into refs values
  ('09790001', pg_temp.nota('09790001', '97900000000000000000000000000000000000000001', 1, 2, 10), 2),
  ('09790002', pg_temp.nota('09790002', '97900000000000000000000000000000000000000001', 2, 2, 20), 2),
  ('09790003', pg_temp.nota('09790003', '97900000000000000000000000000000000000000001', 3, 4, 5), 4),
  ('09790011', pg_temp.nota('09790011', '97900000000000000000000000000000000000000002', 1, 2, 10), 2),
  ('09790012', pg_temp.nota('09790012', '97900000000000000000000000000000000000000002', 2, 2, 20), 2),
  ('09790013', pg_temp.nota('09790013', '97900000000000000000000000000000000000000002', 3, 4, 5), 4);

create function pg_temp.linha(p_codigo text) returns jsonb language sql as $$
  select to_jsonb(i) - 'codigo' - 'cor' from public.inventario_calcular('97900000-0000-0000-0000-000000000001') i
   where i.codigo = p_codigo
$$;

-- Componente igual ao controle, nos valores literais esperados, e nenhum SKU de kit vira linha.
create function pg_temp.confere(p_passo text, p_codigo text, p_controle text, p_qtd int, p_qv int,
  p_custo numeric, p_valor numeric) returns void language plpgsql as $$
declare l jsonb := pg_temp.linha(p_codigo); c jsonb := pg_temp.linha(p_controle);
begin
  if l is null then raise exception '%: % ausente do inventário', p_passo, p_codigo; end if;
  if l is distinct from c then
    raise exception '%: % difere do controle %: % <> %', p_passo, p_codigo, p_controle, l, c;
  end if;
  if (l->>'quantidade_sistema')::int is distinct from p_qtd or (l->>'qtd_valorizada')::int is distinct from p_qv
     or (l->>'qtd_sem_nota')::int is distinct from p_qtd - p_qv
     or (l->>'custo_medio')::numeric is distinct from p_custo or (l->>'valor_total')::numeric is distinct from p_valor
     or l->'marcas' is distinct from (case when p_qtd > p_qv then '["sem_nota"]' else '[]' end)::jsonb then
    raise exception '%: % esperado qtd=% qv=% custo=% valor=%, veio %', p_passo, p_codigo, p_qtd, p_qv,
      p_custo, p_valor, l;
  end if;
  if exists (select 1 from public.inventario_calcular('97900000-0000-0000-0000-000000000001') i
             where i.codigo in ('09791001', '09791002')) then
    raise exception '%: SKU de kit apareceu como linha do inventário', p_passo;
  end if;
end $$;

create function pg_temp.transf(p_tipo text, p_itens jsonb) returns uuid language sql as $$
  insert into public.kit_transferencias (org_id, kit_id, tipo, versao_politica, itens)
  values ('97900000-0000-0000-0000-000000000001', '97900000-0000-0000-0000-000000000401', p_tipo, 1, p_itens)
  returning id
$$;

create function pg_temp.ok(p_r jsonb, p_msg text) returns void language plpgsql as $$
begin
  if p_r->>'ok' is distinct from 'true' or p_r->>'aplicado' is distinct from 'true' then
    raise exception '%: %', p_msg, p_r;
  end if;
end $$;

set local role service_role;
do $$
declare o constant uuid := '97900000-0000-0000-0000-000000000001';
  u constant uuid := '97900000-0000-0000-0000-000000000101';
  P constant text := '09790001'; B constant text := '09790002'; A constant text := '09790003';
  CP constant text := '09790011'; CB constant text := '09790012'; CA constant text := '09790013';
  K1 constant text := '09791001'; K2 constant text := '09791002';
  r record; t uuid;
begin
  -- 1) Entrada com nota: P 2 @ 10, B 2 @ 20, A 4 @ 5 (e o mesmo nos controles).
  for r in select * from refs order by codigo loop
    perform public.registrar_entrada(o, r.codigo, r.qtd, null, 'NF', null, u, r.ref);
  end loop;
  perform pg_temp.confere('1 entrada', P, CP, 2, 2, 10, 20);
  perform pg_temp.confere('1 entrada', B, CB, 2, 2, 20, 40);
  perform pg_temp.confere('1 entrada', A, CA, 4, 4, 5, 20);

  -- 2) Montar 2 × K1 e 1 × K2. Em trânsito (saiu da origem, não chegou): nada muda.
  t := pg_temp.transf('montar', jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 2),
                                                  jsonb_build_object('codigo', K2, 'quantidade', 1)));
  perform pg_temp.ok(public.kit_reservar_transferencia(o, t), '2 reservar');
  if (select estoque from public.variacoes where org_id = o and codigo = P) <> 0 then
    raise exception '2: reserva não baixou P';
  end if;
  perform pg_temp.confere('2 trânsito', P, CP, 2, 2, 10, 20);
  perform pg_temp.confere('2 trânsito', B, CB, 2, 2, 20, 40);
  perform pg_temp.confere('2 trânsito', A, CA, 4, 4, 5, 20);

  -- 3) Chegou ao kit: P e B dentro de K1, 2 A dentro de K2 (kit de 2 peças conta 2 peças).
  perform pg_temp.ok(public.kit_creditar_transferencia(o, t), '3 creditar');
  update public.kit_transferencias set estado = 'concluida' where id = t;
  perform pg_temp.confere('3 montado', P, CP, 2, 2, 10, 20);
  perform pg_temp.confere('3 montado', B, CB, 2, 2, 20, 40);
  perform pg_temp.confere('3 montado', A, CA, 4, 4, 5, 20);

  -- 4) Venda de 1 K1 e 1 K2 = venda de 1 P, 1 B e 2 A nos controles.
  perform public.baixar_estoque(o, K1, 1, 'mercado_livre', 'kit-inv:v1');
  perform public.baixar_estoque(o, CP, 1, 'mercado_livre', 'kit-inv:c1p');
  perform public.baixar_estoque(o, CB, 1, 'mercado_livre', 'kit-inv:c1b');
  perform public.baixar_estoque(o, K2, 1, 'mercado_livre', 'kit-inv:v2');
  perform public.baixar_estoque(o, CA, 2, 'mercado_livre', 'kit-inv:c2a');
  perform pg_temp.confere('4 venda', P, CP, 1, 1, 10, 10);
  perform pg_temp.confere('4 venda', B, CB, 1, 1, 20, 20);
  perform pg_temp.confere('4 venda', A, CA, 2, 2, 5, 10);

  -- 5) Cancelamento do K1 vendido: volta 1 P e 1 B, sem nota (regra de hoje para estorno de SKU comum).
  perform public.estornar_estoque(o, 'mercado_livre', 'kit-inv:v1', K1);
  perform public.estornar_estoque(o, 'mercado_livre', 'kit-inv:c1p', CP);
  perform public.estornar_estoque(o, 'mercado_livre', 'kit-inv:c1b', CB);
  perform pg_temp.confere('5 estorno', P, CP, 2, 1, 10, 10);
  perform pg_temp.confere('5 estorno', B, CB, 2, 1, 20, 20);

  -- 6) Desmontar os 2 K1: trânsito e chegada ao individual mantêm valorizada, custo e nota.
  t := pg_temp.transf('desmontar', jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 2)));
  perform pg_temp.ok(public.kit_reservar_transferencia(o, t), '6 reservar');
  perform pg_temp.confere('6 trânsito', P, CP, 2, 1, 10, 10);
  perform pg_temp.ok(public.kit_creditar_transferencia(o, t), '6 creditar');
  update public.kit_transferencias set estado = 'concluida' where id = t;
  if (select estoque from public.variacoes where org_id = o and codigo = P) <> 2 then
    raise exception '6: desmontar não devolveu P ao individual';
  end if;
  perform pg_temp.confere('6 desmontado', P, CP, 2, 1, 10, 10);
  perform pg_temp.confere('6 desmontado', B, CB, 2, 1, 20, 20);

  -- 7) Montagem cancelada no meio: a peça volta à origem sem perder a nota.
  t := pg_temp.transf('montar', jsonb_build_array(jsonb_build_object('codigo', K1, 'quantidade', 1)));
  perform pg_temp.ok(public.kit_reservar_transferencia(o, t), '7 reservar');
  perform pg_temp.confere('7 trânsito', P, CP, 2, 1, 10, 10);
  perform pg_temp.ok(public.kit_cancelar_transferencia(o, t), '7 cancelar');
  update public.kit_transferencias set estado = 'abortada' where id = t;
  perform pg_temp.confere('7 cancelado', P, CP, 2, 1, 10, 10);
  perform pg_temp.confere('7 cancelado', B, CB, 2, 1, 20, 20);

  -- 8) Entrada nova depois de tudo: custo médio segue a regra (1 @ 10 + 2 @ 16 = 3 @ 14).
  perform public.registrar_entrada(o, P, 2, null, 'NF', null, u,
    pg_temp.nota(P, '97900000000000000000000000000000000000000003', 1, 2, 16));
  perform public.registrar_entrada(o, CP, 2, null, 'NF', null, u,
    pg_temp.nota(CP, '97900000000000000000000000000000000000000004', 1, 2, 16));
  perform pg_temp.confere('8 nova nota', P, CP, 4, 3, 14, 42);
end $$;
reset role;

rollback;
