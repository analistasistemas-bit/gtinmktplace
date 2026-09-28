\set ON_ERROR_STOP on
begin;
insert into public.organizations (id, nome, slug) values
  ('93000000-0000-0000-0000-000000000001', 'SKU test', 'sku-test'),
  ('93000000-0000-0000-0000-000000000002', 'Outra org', 'outra-org');
insert into auth.users (id, email, raw_user_meta_data) values
  ('93000000-0000-0000-0000-000000000101', 'sku@test.local', '{"org_id":"93000000-0000-0000-0000-000000000001"}'::jsonb),
  ('93000000-0000-0000-0000-000000000102', 'outra@test.local', '{"org_id":"93000000-0000-0000-0000-000000000002"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', true),
  ('93000000-0000-0000-0000-000000000102', '93000000-0000-0000-0000-000000000002', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('93000000-0000-0000-0000-000000000201', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 'processando', 'planilha'),
  ('93000000-0000-0000-0000-000000000202', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 'processando', 'planilha'),
  ('93000000-0000-0000-0000-000000000203', '93000000-0000-0000-0000-000000000102', '93000000-0000-0000-0000-000000000002', 'processando', 'planilha');
-- Família antiga e família nova do mesmo produto: a RPC tem que devolver a NOVA (estoque 9, fornecedor B).
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, fornecedor, chave_cadastro, criado_em) values
  ('93000000-0000-0000-0000-000000000301', '93000000-0000-0000-0000-000000000201', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '09300000', 'Fita antiga', 'CREATE', 'nacional', 'Fornecedor A', gen_random_uuid(), now() - interval '10 days'),
  ('93000000-0000-0000-0000-000000000302', '93000000-0000-0000-0000-000000000202', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '09300000', 'Fita nova', 'UPDATE', 'importado', 'Fornecedor B', gen_random_uuid(), now()),
  ('93000000-0000-0000-0000-000000000303', '93000000-0000-0000-0000-000000000203', '93000000-0000-0000-0000-000000000102', '93000000-0000-0000-0000-000000000002', '09400000', 'Outra org', 'CREATE', 'nacional', null, gen_random_uuid(), now());
-- Kit vinculado da org 1 (eh_kit = true).
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, kit_base_codigo_pai, kit_multiplicador, criado_em) values
  ('93000000-0000-0000-0000-000000000304', '93000000-0000-0000-0000-000000000202', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '09310000', 'Kit 2 fitas', 'CREATE', 'nacional', gen_random_uuid(), '09300000', 2, now());
insert into public.variacoes (familia_id, user_id, org_id, codigo, preco, estoque, nome) values
  ('93000000-0000-0000-0000-000000000304', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '09310001', 20, 0, 'Kit 2 fitas');
insert into public.variacoes (familia_id, user_id, org_id, codigo, preco, estoque, nome) values
  ('93000000-0000-0000-0000-000000000301', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '09300001', 10, 3, 'Fita azul'),
  ('93000000-0000-0000-0000-000000000302', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '09300001', 10, 9, 'Fita azul'),
  ('93000000-0000-0000-0000-000000000303', '93000000-0000-0000-0000-000000000102', '93000000-0000-0000-0000-000000000002', '09400001', 10, 5, 'Não pode vazar');
-- Vendas: uma paga antiga, uma paga recente, uma cancelada mais recente (não conta).
insert into public.ml_vendas (id, user_id, org_id, order_id, status, date_closed, total_amount) values
  ('93000000-0000-0000-0000-000000000401', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 930001, 'paid', '2026-07-01T12:00:00Z', 10),
  ('93000000-0000-0000-0000-000000000402', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 930002, 'paid', '2026-09-01T12:00:00Z', 10),
  ('93000000-0000-0000-0000-000000000403', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 930003, 'cancelled', '2026-09-20T12:00:00Z', 10),
  -- Venda PAGA da OUTRA org com o MESMO código e data mais antiga: não pode mexer na primeira_venda da org 1.
  ('93000000-0000-0000-0000-000000000404', '93000000-0000-0000-0000-000000000102', '93000000-0000-0000-0000-000000000002', 930004, 'paid', '2026-01-01T12:00:00Z', 10);
insert into public.ml_vendas_itens (user_id, org_id, venda_id, codigo, quantity, unit_price) values
  ('93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000401', '09300001', 1, 10),
  ('93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000402', '09300001', 1, 10),
  ('93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000403', '09300001', 1, 10),
  ('93000000-0000-0000-0000-000000000102', '93000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000404', '09300001', 1, 10);

set local role authenticated;
set local request.jwt.claims = '{"sub":"93000000-0000-0000-0000-000000000101","role":"authenticated"}';
do $$
declare r json; n int;
begin
  select count(*) into n from public.vendas_sku_catalogo() x where x->>'codigo' = '09400001';
  if n <> 0 then raise exception 'vazou SKU de outra org'; end if;
  select count(*) into n from public.vendas_sku_catalogo() x where x->>'codigo' = '09300001';
  if n <> 1 then raise exception 'código duplicado: % linhas, esperado 1 (família mais recente)', n; end if;
  select x into r from public.vendas_sku_catalogo() x where x->>'codigo' = '09300001';
  if (r->>'estoque')::int <> 9 or r->>'fornecedor' <> 'Fornecedor B' or r->>'origem' <> 'importado' or r->>'nome_familia' <> 'Fita nova'
    then raise exception 'não usou a família mais recente: %', r; end if;
  if (r->>'eh_kit')::boolean is distinct from false then raise exception 'eh_kit errado: %', r; end if;
  if (r->>'primeira_venda')::timestamptz <> '2026-07-01T12:00:00Z' or (r->>'ultima_venda')::timestamptz <> '2026-09-01T12:00:00Z'
    then raise exception 'primeira/última venda erradas (cancelada e outra org não contam): %', r; end if;
  select x into r from public.vendas_sku_catalogo() x where x->>'codigo' = '09310001';
  if (r->>'eh_kit')::boolean is distinct from true then raise exception 'kit vinculado sem eh_kit: %', r; end if;
end $$;
rollback;
