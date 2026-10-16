\set ON_ERROR_STOP on
-- ADR-0181 Plano 2b-2, Task 3, Step 5: orçamento de inventario_calcular no maior volume medido em
-- produção (medições (a): 11.717 variações / 3.756 movimentos numa org). Critério: ≤ 10 s.
-- Pior caso de recursão: um SKU com cadeia de 1.000 movimentos + 689 SKUs com 4 cada.
-- Segura o lock da migration até o rollback: rodar uma vez, não em laço.
begin;
insert into public.organizations (id, nome, slug) values
  ('93500000-0000-0000-0000-000000000001', 'Inventario volume test', 'inventario-volume-test');
insert into auth.users (id, email, raw_user_meta_data) values
  ('93500000-0000-0000-0000-000000000101', 'inventario-volume@test.local',
   '{"org_id":"93500000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('93500000-0000-0000-0000-000000000101', '93500000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('93500000-0000-0000-0000-000000000201', '93500000-0000-0000-0000-000000000101',
   '93500000-0000-0000-0000-000000000001', 'processando', 'planilha');

-- 2.930 famílias × 4 variações (as 3 últimas ficam de fora: 11.717 variações).
insert into public.familias (lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, ncm, criado_em)
select '93500000-0000-0000-0000-000000000201', '93500000-0000-0000-0000-000000000101',
       '93500000-0000-0000-0000-000000000001', 'P' || lpad(f::text, 5, '0'), 'Produto ' || f, 'CREATE', 'nacional',
       '62034900', timestamptz '2026-01-01 00:00:00+00'
  from generate_series(0, 2929) f;

-- Movimentos: SKU 0 com 1.000; SKUs 1..689 com 4. Ciclo: +10 (nota), −2, −2, −2, −2.
create temp table vol_mov as
select codigo, j, delta,
       sum(delta) over (partition by codigo order by j) - delta as ant,
       sum(delta) over (partition by codigo order by j) as res,
       row_number() over (partition by (j % 5 = 1) order by codigo, j) as n_nota
  from (select 'S' || lpad(s::text, 5, '0') as codigo, j, case when j % 5 = 1 then 10 else -2 end as delta
          from generate_series(0, 689) s
          cross join lateral generate_series(1, case when s = 0 then 1000 else 4 end) j) t;

-- Os triggers de insert de variacoes (guards de tenant/kit) varrem familias por linha e estouram o
-- statement_timeout do runner em 11.717 linhas; a fixture é sintética e válida, então pula os
-- triggers só neste insert (sem lock de tabela, ao contrário de `disable trigger`).
set local session_replication_role = replica;
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, preco, estoque)
select f.id, '93500000-0000-0000-0000-000000000101', '93500000-0000-0000-0000-000000000001',
       'S' || lpad(v::text, 5, '0'), 'V', 50, coalesce(u.res, 0)
  from generate_series(0, 11716) v
  join public.familias f on f.org_id = '93500000-0000-0000-0000-000000000001'
   and f.codigo_pai = 'P' || lpad((v / 4)::text, 5, '0')
  left join (select distinct on (codigo) codigo, res from vol_mov order by codigo, j desc) u
    on u.codigo = 'S' || lpad(v::text, 5, '0');
set local session_replication_role = origin;

insert into public.notas_compra (id, org_id, chave, numero, serie, emitente_cnpj, emitente_nome, emitida_em,
  valor_total, assinada, xml_path)
values ('93500000-0000-0000-0000-000000000401', '93500000-0000-0000-0000-000000000001',
  '93500000000000000000000000000000000000000001', 1, 1, '11222333000181', 'Fornecedor Teste', now(), 0, false, 'x.xml');
insert into public.notas_compra_itens (id, nota_id, org_id, n_item, cprod, xprod, cfop, ucom, qcom, v_prod, codigo_pai)
select gen_random_uuid(), '93500000-0000-0000-0000-000000000401', '93500000-0000-0000-0000-000000000001',
       m.n_nota, 'R', 'R', '5102', 'UN', 10, 100, 'X'
  from vol_mov m where m.j % 5 = 1;
insert into public.notas_compra_distribuicao (item_id, org_id, codigo, quantidade, custo_aquisicao_unit,
  custo_precificacao_unit)
select i.id, '93500000-0000-0000-0000-000000000001', m.codigo, 10, 10 + m.j % 7, 14
  from vol_mov m join public.notas_compra_itens i
    on i.nota_id = '93500000-0000-0000-0000-000000000401' and i.n_item = m.n_nota
 where m.j % 5 = 1;

insert into public.estoque_movimentos (org_id, codigo, codigo_pai, quantidade, motivo, referencia_externa,
  estoque_anterior, estoque_resultante, criado_em, ordem)
select '93500000-0000-0000-0000-000000000001', m.codigo, 'X', m.delta,
       case when m.j % 5 = 1 then 'entrada' else 'venda' end,
       case when m.j % 5 = 1 then 'nfe:93500000000000000000000000000000000000000001:' || m.n_nota || ':' || m.codigo
            else 'vol-venda:' || m.codigo || ':' || m.j end,
       m.ant, m.res, timestamptz '2026-02-01 00:00:00+00' + m.j * interval '1 minute',
       nextval('public.estoque_movimentos_ordem_seq')
  from (select * from vol_mov order by codigo, j) m;

do $$
declare v_plano json; v_ms numeric; v_n int;
begin
  if (select count(*) from public.estoque_movimentos where org_id = '93500000-0000-0000-0000-000000000001') <> 3756
     or (select count(*) from public.variacoes where org_id = '93500000-0000-0000-0000-000000000001') <> 11717 then
    raise exception 'volume sintético fora do medido';
  end if;
  execute 'explain (analyze, format json) select * from public.inventario_calcular(''93500000-0000-0000-0000-000000000001'')'
    into v_plano;
  v_ms := (v_plano->0->>'Execution Time')::numeric;
  select count(*) into v_n from public.inventario_calcular('93500000-0000-0000-0000-000000000001');
  if v_n <> 11717 then raise exception 'esperado 11717 linhas, veio %', v_n; end if;
  if v_ms > 10000 then raise exception 'inventario_calcular levou % ms (> 10 s)', v_ms; end if;
end $$;
rollback;
