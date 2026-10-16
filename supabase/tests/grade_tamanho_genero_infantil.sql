-- ADR-0182: grade_tamanho + generos infantis. Rodar com scripts/teste-sql-desfeito.py (transacao desfeita).
begin;
insert into public.organizations (id, nome, slug) values
  ('93000000-0000-0000-0000-000000000001', 'Grade182 test', 'grade182-test');
insert into auth.users (id, email, raw_user_meta_data) values
  ('93000000-0000-0000-0000-000000000101', 'grade182@test.local',
   '{"org_id":"93000000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('93000000-0000-0000-0000-000000000201', '93000000-0000-0000-0000-000000000101',
   '93000000-0000-0000-0000-000000000001', 'processando', 'manual');

-- passa: calca + meninos
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, grade_tamanho, genero)
values ('93000000-0000-0000-0000-000000000301', '93000000-0000-0000-0000-000000000201',
  '93000000-0000-0000-0000-000000000101', '93000000-0000-0000-0000-000000000001',
  '09300001', 'Calca teste', 'CREATE', 'nacional', gen_random_uuid(), 'calca', 'meninos');

-- falha: grade invalida
do $$ begin
  insert into public.familias (lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, grade_tamanho)
  values ('93000000-0000-0000-0000-000000000201', '93000000-0000-0000-0000-000000000101',
    '93000000-0000-0000-0000-000000000001', '09300002', 'X', 'CREATE', 'nacional', gen_random_uuid(), 'xg');
  raise exception 'grade_tamanho=xg deveria falhar';
exception when check_violation then null;
end $$;

-- falha: genero invalido
do $$ begin
  insert into public.familias (lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro, genero)
  values ('93000000-0000-0000-0000-000000000201', '93000000-0000-0000-0000-000000000101',
    '93000000-0000-0000-0000-000000000001', '09300003', 'X', 'CREATE', 'nacional', gen_random_uuid(), 'menino');
  raise exception 'genero=menino deveria falhar';
exception when check_violation then null;
end $$;

-- ml_size_charts aceita os 6 generos e nao aceita null/invalido (checado pela definicao do CHECK)
do $$ declare d text; begin
  select pg_get_constraintdef(oid) into d from pg_constraint
   where conname = 'ml_size_charts_genero_check' and conrelid = 'public.ml_size_charts'::regclass;
  if d is null or d not like '%sem_genero_infantil%' or d not like '%meninas%' or d like '%IS NULL%' then
    raise exception 'ml_size_charts_genero_check inesperado: %', d;
  end if;
end $$;
rollback;
