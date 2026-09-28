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
-- A = '09300001' (família-base do kit: estoque 3 na antiga, 9 na nova). B, C, D são códigos soltos.
insert into public.ml_vendas (id, user_id, org_id, order_id, status, date_closed, total_amount, pack_id, shipping_id) values
  ('93000000-0000-0000-0000-000000000501', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 935001, 'paid', '2026-09-01T12:00:00Z', 10, 500, null), -- V1 A
  ('93000000-0000-0000-0000-000000000502', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 935002, 'paid', '2026-09-01T12:00:00Z', 10, 500, null), -- V2 B, mesmo pack
  ('93000000-0000-0000-0000-000000000503', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 935003, 'paid', '2026-09-02T12:00:00Z', 10, null, 700), -- V3 A
  ('93000000-0000-0000-0000-000000000504', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 935004, 'paid', '2026-09-02T12:00:00Z', 10, null, 700), -- V4 C, mesmo envio
  ('93000000-0000-0000-0000-000000000505', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 935005, 'paid', '2026-09-03T12:00:00Z', 10, null, null), -- V5 só D
  ('93000000-0000-0000-0000-000000000506', '93000000-0000-0000-0000-000000000102', '93000000-0000-0000-0000-000000000002', 935006, 'paid', '2026-09-01T12:00:00Z', 10, 500, 700); -- org 2, mesmo pack/envio
insert into public.ml_vendas_itens (user_id, org_id, venda_id, codigo, quantity, unit_price, ml_item_id) values
  ('93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000501', '09300001', 1, 10, 'MLB1'),
  ('93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000502', 'B', 1, 10, 'MLB1'),
  ('93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000503', '09300001', 1, 10, null),
  ('93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000504', 'C', 1, 10, null),
  ('93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000505', 'D', 1, 10, 'MLB5'),
  ('93000000-0000-0000-0000-000000000102', '93000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000506', '09300001', 1, 10, 'MLB1');
insert into public.anuncios_externos (id, user_id, org_id, canal, codigo_pai, item_externo_id, variacoes_externas, ml_item_id_anterior, migracao_pxv_snapshot) values
  ('93000000-0000-0000-0000-000000000601', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 'mercado_livre', '09300000', 'MLB1', '{"09300001":{},"B":{}}'::jsonb, null, null),
  -- PxV concluída: MLB9 encerrado; SKUs no snapshot [{id, sku, cor}] (migrar-preco-por-variacao lerVariacoes).
  ('93000000-0000-0000-0000-000000000602', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 'mercado_livre', '09390000', 'MLB10', '{}'::jsonb, 'MLB9',
    '[{"id":"111","sku":"09300001","cor":"Azul"},{"id":"112","sku":"E","cor":null}]'::jsonb),
  ('93000000-0000-0000-0000-000000000603', '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001', 'mercado_livre', '09380000', null, '{}'::jsonb, null, null),
  -- Org 2 com o mesmo MLB1 e outro código: não pode vazar para o mapa da org 1.
  ('93000000-0000-0000-0000-000000000604', '93000000-0000-0000-0000-000000000102', '93000000-0000-0000-0000-000000000002', 'mercado_livre', '09300000', 'MLB1', '{"Z":{}}'::jsonb, null, null);
insert into public.anuncios_externos_itens (anuncio_externo_id, org_id, sku, status, item_externo_id) values
  ('93000000-0000-0000-0000-000000000603', '93000000-0000-0000-0000-000000000001', '09300001', 'ativo', 'MLB3');

set local role authenticated;
set local request.jwt.claims = '{"sub":"93000000-0000-0000-0000-000000000101","role":"authenticated"}';
do $$
declare ids uuid[]; m jsonb; r json;
begin
  ids := public.vendas_sku_dossie_ids('{09300001}');
  if ids is distinct from array['93000000-0000-0000-0000-000000000501','93000000-0000-0000-0000-000000000502',
      '93000000-0000-0000-0000-000000000503','93000000-0000-0000-0000-000000000504']::uuid[]
    then raise exception 'dossie_ids errado: %', ids; end if;
  if public.vendas_sku_dossie_ids('{nada}') <> '{}'::uuid[] then raise exception 'sem venda devia ser vazio'; end if;

  m := public.vendas_sku_mlbs('{09300001}');
  if m->'MLB1' is distinct from '["09300001","B"]'::jsonb then raise exception 'MLB1 errado (org 2 vazou?): %', m; end if;
  if m->'MLB3' is distinct from '["09300001"]'::jsonb then raise exception 'MLB3 (anuncios_externos_itens) errado: %', m; end if;
  if m->'MLB9' is distinct from '["09300001","E"]'::jsonb then raise exception 'MLB9 (PxV snapshot) errado: %', m; end if;
  if m ? 'MLB5' or m ? 'MLB10' then raise exception 'MLB não relacionado entrou: %', m; end if;

  select x into r from public.vendas_sku_catalogo() x where x->>'codigo' = '09310001';
  if (r->>'kit_multiplicador')::int is distinct from 2 or r->>'kit_base_codigo' is distinct from '09300001'
     or (r->>'estoque_kit')::int is distinct from 4
    then raise exception 'kit errado (base mais recente tem estoque 9 → 4): %', r; end if;
  select x into r from public.vendas_sku_catalogo() x where x->>'codigo' = '09300001';
  if (r::jsonb)->>'kit_multiplicador' is not null or (r::jsonb)->>'estoque_kit' is not null or (r::jsonb)->>'kit_base_codigo' is not null
    then raise exception 'não-kit devia ter campos de kit null: %', r; end if;
end $$;
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.vendas_sku_dossie_ids(text[])', 'execute')
     or has_function_privilege('anon', 'public.vendas_sku_mlbs(text[])', 'execute')
     or has_function_privilege('anon', 'public.vendas_sku_catalogo()', 'execute')
    then raise exception 'anon consegue executar RPC do dossiê'; end if;
end $$;
rollback;
