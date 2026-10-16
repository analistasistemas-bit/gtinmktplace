-- ADR-0181 Plano 2b-2, Task 3: fixture que roda ANTES da migration (o runner concatena os
-- argumentos na ordem), para provar o backfill de `ordem` e o preenchimento do corte por SQL.
-- Não é um teste sozinho. Uso:
--   python3 scripts/teste-sql-desfeito.py supabase/tests/inventario_calculo_corte.sql \
--     supabase/tests/inventario_calculo_corte_pre.sql supabase/migrations/<ts>_adr181_inventario_calculo.sql
insert into public.organizations (id, nome, slug) values
  ('93400000-0000-0000-0000-000000000001', 'Inventario corte test', 'inventario-corte-test');
insert into auth.users (id, email, raw_user_meta_data) values
  ('93400000-0000-0000-0000-000000000101', 'inventario-corte@test.local',
   '{"org_id":"93400000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('93400000-0000-0000-0000-000000000101', '93400000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('93400000-0000-0000-0000-000000000201', '93400000-0000-0000-0000-000000000101',
   '93400000-0000-0000-0000-000000000001', 'processando', 'manual');
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, ncm, criado_em)
values
  ('93400000-0000-0000-0000-000000000301', '93400000-0000-0000-0000-000000000201',
   '93400000-0000-0000-0000-000000000101', '93400000-0000-0000-0000-000000000001',
   '09340100', 'Com nota e venda', 'CREATE', 'nacional', gen_random_uuid(), '62034900', '2026-01-01 00:00:00+00'),
  ('93400000-0000-0000-0000-000000000302', '93400000-0000-0000-0000-000000000201',
   '93400000-0000-0000-0000-000000000101', '93400000-0000-0000-0000-000000000001',
   '09340200', 'Só nota', 'CREATE', 'nacional', gen_random_uuid(), '62034900', '2026-01-01 00:00:00+00');
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, preco, estoque) values
  ('93400000-0000-0000-0000-000000000301', '93400000-0000-0000-0000-000000000101',
   '93400000-0000-0000-0000-000000000001', '09340101', 'U', 50, 0),
  ('93400000-0000-0000-0000-000000000302', '93400000-0000-0000-0000-000000000101',
   '93400000-0000-0000-0000-000000000001', '09340201', 'U', 50, 0);

-- Nota importada com os dois SKUs (10 @ 10 cada).
insert into public.notas_compra (id, org_id, chave, numero, serie, emitente_cnpj, emitente_nome, emitida_em,
  valor_total, assinada, xml_path)
values ('93400000-0000-0000-0000-000000000401', '93400000-0000-0000-0000-000000000001',
  '93400000000000000000000000000000000000000001', 1, 1, '11444777000161', 'Fornecedor Teste', now(), 200, false, 'x.xml');
insert into public.notas_compra_itens (id, nota_id, org_id, n_item, cprod, xprod, cfop, ucom, qcom, v_prod, codigo_pai) values
  ('93400000-0000-0000-0000-000000000501', '93400000-0000-0000-0000-000000000401',
   '93400000-0000-0000-0000-000000000001', 1, 'A', 'A', '5102', 'UN', 10, 100, '09340100'),
  ('93400000-0000-0000-0000-000000000502', '93400000-0000-0000-0000-000000000401',
   '93400000-0000-0000-0000-000000000001', 2, 'B', 'B', '5102', 'UN', 10, 100, '09340200');
insert into public.notas_compra_distribuicao (item_id, org_id, codigo, quantidade, custo_aquisicao_unit,
  custo_precificacao_unit) values
  ('93400000-0000-0000-0000-000000000501', '93400000-0000-0000-0000-000000000001', '09340101', 10, 10, 14),
  ('93400000-0000-0000-0000-000000000502', '93400000-0000-0000-0000-000000000001', '09340201', 10, 10, 14);

do $$
begin
  perform public.registrar_entrada('93400000-0000-0000-0000-000000000001', '09340101', 10, null, 'NF', null,
    '93400000-0000-0000-0000-000000000101', 'nfe:93400000000000000000000000000000000000000001:1:09340101');
  perform public.registrar_entrada('93400000-0000-0000-0000-000000000001', '09340201', 10, null, 'NF', null,
    '93400000-0000-0000-0000-000000000101', 'nfe:93400000000000000000000000000000000000000001:2:09340201');
  perform public.baixar_estoque('93400000-0000-0000-0000-000000000001', '09340101', 3, 'mercado_livre', 'corte-venda-1');
  -- Tombstone (cancelamento antes da baixa): sem estoque_resultante, também recebe ordem (Ruling 4).
  perform public.estornar_estoque('93400000-0000-0000-0000-000000000001', 'mercado_livre', 'corte-venda-x', '09340101');
end $$;
-- Ordem temporal explícita (now() é fixo na transação).
update public.estoque_movimentos set criado_em = case referencia_externa
    when 'nfe:93400000000000000000000000000000000000000001:1:09340101' then timestamptz '2026-01-02 00:00:00+00'
    when 'nfe:93400000000000000000000000000000000000000001:2:09340201' then timestamptz '2026-01-02 00:01:00+00'
    when 'corte-venda-1' then timestamptz '2026-01-02 00:02:00+00'
    else timestamptz '2026-01-02 00:03:00+00' end
 where org_id = '93400000-0000-0000-0000-000000000001';
