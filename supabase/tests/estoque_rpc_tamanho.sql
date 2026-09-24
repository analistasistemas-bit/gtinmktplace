\set ON_ERROR_STOP on
begin;
insert into public.organizations (id, nome, slug) values
  ('92000000-0000-0000-0000-000000000001', 'Grade test', 'grade-test');
insert into auth.users (id, email, raw_user_meta_data) values
  ('92000000-0000-0000-0000-000000000101', 'grade@test.local',
   '{"org_id":"92000000-0000-0000-0000-000000000001"}'::jsonb);
-- current_org_id() lê public.profiles ativo, não o metadado do auth.users (Codex #10). Upsert
-- porque um trigger de signup pode já ter criado a linha.
insert into public.profiles (id, org_id, is_active) values
  ('92000000-0000-0000-0000-000000000101', '92000000-0000-0000-0000-000000000001', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('92000000-0000-0000-0000-000000000201', '92000000-0000-0000-0000-000000000101',
   '92000000-0000-0000-0000-000000000001', 'processando', 'manual');
-- ml_item_id/publicado_em: `tem_tamanho` olha a última família PUBLICADA (Codex r5 #1).
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, ml_item_id, publicado_em)
values ('92000000-0000-0000-0000-000000000301', '92000000-0000-0000-0000-000000000201',
  '92000000-0000-0000-0000-000000000101', '92000000-0000-0000-0000-000000000001',
  '09200000', 'Camiseta teste', 'CREATE', 'nacional', gen_random_uuid(), 'MLB-TESTE-GRADE', now());
-- Lote próprio para as tentativas canônicas posteriores: `unique (lote_id, codigo_pai)` (Codex r7 #1).
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('92000000-0000-0000-0000-000000000202', '92000000-0000-0000-0000-000000000101',
   '92000000-0000-0000-0000-000000000001', 'processando', 'manual');
-- Codex r6 #3: canônica ≠ publicada nos dois sentidos. `tem_tamanho` olha a última PUBLICADA; uma
-- implementação que lesse a canônica erraria os dois casos (09500000 e 09300000).
-- Produto próprio (09500000) para não mexer na canônica de 09200000, que as asserções de
-- variacoes_estoque_produto usam: 302 = publicada COM tamanho; 305 = canônica posterior SEM.
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, ml_item_id, publicado_em)
values ('92000000-0000-0000-0000-000000000302', '92000000-0000-0000-0000-000000000201',
  '92000000-0000-0000-0000-000000000101', '92000000-0000-0000-0000-000000000001',
  '09500000', 'Jaqueta teste', 'CREATE', 'nacional', gen_random_uuid(), 'MLB-TESTE-GRADE2', now());
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, criado_em)
values ('92000000-0000-0000-0000-000000000305', '92000000-0000-0000-0000-000000000202',
  '92000000-0000-0000-0000-000000000101', '92000000-0000-0000-0000-000000000001',
  '09500000', 'Jaqueta teste', 'UPDATE', 'nacional', gen_random_uuid(), now() + interval '1 minute');
-- Sentido inverso: produto 09300000 publicado SEM tamanho e canônica posterior COM tamanho → false.
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, ml_item_id, publicado_em)
values ('92000000-0000-0000-0000-000000000303', '92000000-0000-0000-0000-000000000201',
  '92000000-0000-0000-0000-000000000101', '92000000-0000-0000-0000-000000000001',
  '09300000', 'Fita teste', 'CREATE', 'nacional', gen_random_uuid(), 'MLB-TESTE-SIMPLES', now());
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, criado_em)
values ('92000000-0000-0000-0000-000000000304', '92000000-0000-0000-0000-000000000202',
  '92000000-0000-0000-0000-000000000101', '92000000-0000-0000-0000-000000000001',
  '09300000', 'Fita teste', 'UPDATE', 'nacional', gen_random_uuid(), now() + interval '1 minute');
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, tamanho, preco, estoque)
values
  ('92000000-0000-0000-0000-000000000302', '92000000-0000-0000-0000-000000000101',
   '92000000-0000-0000-0000-000000000001', '09500001', 'Preto', 'Preto', 'G', 50, 0),
  ('92000000-0000-0000-0000-000000000305', '92000000-0000-0000-0000-000000000101',
   '92000000-0000-0000-0000-000000000001', '09500011', 'Preto', 'Preto', null, 50, 0),
  ('92000000-0000-0000-0000-000000000303', '92000000-0000-0000-0000-000000000101',
   '92000000-0000-0000-0000-000000000001', '09300001', 'Azul', 'Azul', null, 50, 0),
  ('92000000-0000-0000-0000-000000000304', '92000000-0000-0000-0000-000000000101',
   '92000000-0000-0000-0000-000000000001', '09300011', 'Azul', 'Azul', 'M', 50, 0);
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, tamanho, preco, estoque)
values
  ('92000000-0000-0000-0000-000000000301', '92000000-0000-0000-0000-000000000101',
   '92000000-0000-0000-0000-000000000001', '09200001', 'Preto', 'Preto', 'M', 50, 0),
  ('92000000-0000-0000-0000-000000000301', '92000000-0000-0000-0000-000000000101',
   '92000000-0000-0000-0000-000000000001', '09200002', 'Azul', 'Azul', null, 50, 0);

set local role authenticated;
set local request.jwt.claims = '{"sub":"92000000-0000-0000-0000-000000000101","role":"authenticated"}';

do $$
declare r json; n int;
begin
  -- Sem estas contagens, uma RPC que devolve VAZIO (perfil/org não resolvidos) passaria calada.
  select count(*) into n from public.variacoes_estoque_produto('09200000');
  if n <> 2 then raise exception 'variacoes_estoque_produto devolveu % linhas, esperado 2', n; end if;
  select count(*) into n from public.skus_estoque_org() x where x->>'codigo' in ('09200001', '09200002');
  if n <> 2 then raise exception 'skus_estoque_org devolveu % linhas da fixture, esperado 2', n; end if;
  select x into r from public.variacoes_estoque_produto('09200000') x where x->>'codigo' = '09200001';
  if r->>'tamanho' is distinct from 'M' then raise exception 'variacoes_estoque_produto sem tamanho: %', r; end if;
  select x into r from public.variacoes_estoque_produto('09200000') x where x->>'codigo' = '09200002';
  if not (r::jsonb ? 'tamanho') or r->>'tamanho' is not null then raise exception 'tamanho null deveria vir como chave nula: %', r; end if;
  select x into r from public.skus_estoque_org() x where x->>'codigo' = '09200001';
  if r->>'tamanho' is distinct from 'M' then raise exception 'skus_estoque_org sem tamanho: %', r; end if;
  -- Array de produtos do resumo: chave 'produtos' (produtos_estoque_resumo, json_build_object final).
  select p into r from json_array_elements(public.produtos_estoque_resumo()->'produtos') p where p->>'codigo_pai' = '09200000';
  if (r->>'tem_tamanho')::boolean is distinct from true then raise exception 'resumo sem tem_tamanho: %', r; end if;
  select p into r from json_array_elements(public.produtos_estoque_resumo()->'produtos') p where p->>'codigo_pai' = '09500000';
  if (r->>'tem_tamanho')::boolean is distinct from true then raise exception 'tem_tamanho deveria vir da última PUBLICADA (grade): %', r; end if;
  select p into r from json_array_elements(public.produtos_estoque_resumo()->'produtos') p where p->>'codigo_pai' = '09300000';
  if (r->>'tem_tamanho')::boolean is distinct from false then raise exception 'tem_tamanho deveria vir da última PUBLICADA (simples): %', r; end if;
end $$;
rollback;
