\set ON_ERROR_STOP on
begin;
do $$
begin
  if to_regclass('public.notas_compra') is null then raise exception 'falta notas_compra'; end if;
  if to_regclass('public.notas_compra_itens') is null then raise exception 'falta notas_compra_itens'; end if;
  if to_regclass('public.notas_compra_distribuicao') is null then raise exception 'falta distribuicao'; end if;
  if to_regclass('public.vinculos_fornecedor') is null then raise exception 'falta vinculos_fornecedor'; end if;
  if not exists (select 1 from information_schema.columns
                 where table_name='familias' and column_name='descricao_fiscal') then
    raise exception 'falta familias.descricao_fiscal'; end if;
  if not exists (select 1 from information_schema.columns
                 where table_name='empresa_fiscal' and column_name='csosn_padrao_revenda') then
    raise exception 'falta empresa_fiscal.csosn_padrao_revenda'; end if;
  if not exists (select 1 from storage.buckets where id='notas-compra' and public=false) then
    raise exception 'falta bucket notas-compra privado'; end if;
  if exists (select 1 from pg_tables where schemaname='public'
             and tablename in ('notas_compra','notas_compra_itens','notas_compra_distribuicao','vinculos_fornecedor')
             and not rowsecurity) then
    raise exception 'RLS desligada em tabela nova'; end if;
  if not exists (select 1 from information_schema.columns
                 where table_name='familias' and column_name='origem_cadastro') then
    raise exception 'falta familias.origem_cadastro'; end if;
  if not exists (select 1 from information_schema.columns
                 where table_name='notas_compra' and column_name='divergencia_total_aceita') then
    raise exception 'falta notas_compra.divergencia_total_aceita'; end if;
end $$;

-- Isolamento: usuário da org B não enxerga a nota da org A (RLS por current_org_id()).
insert into public.organizations (id, nome, slug) values
  ('93100000-0000-0000-0000-00000000000a', 'NF A', 'nf-a'),
  ('93100000-0000-0000-0000-00000000000b', 'NF B', 'nf-b');
-- raw_user_meta_data.org_id: o trigger handle_new_user cria o profile e exige identidade (profiles_identity_xor).
insert into auth.users (id, email, raw_user_meta_data) values
  ('93100000-0000-0000-0000-0000000000b1', 'nfb@test.local',
   '{"org_id":"93100000-0000-0000-0000-00000000000b"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('93100000-0000-0000-0000-0000000000b1', '93100000-0000-0000-0000-00000000000b', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
insert into public.notas_compra (id, org_id, chave, numero, serie, emitente_cnpj, emitente_nome, emitida_em,
  valor_total, assinada, xml_path)
values
  ('93100000-0000-0000-0000-0000000000c1', '93100000-0000-0000-0000-00000000000a',
   '26261011222333000181550010000010511000030324', 1, 1,
   '11222333000181', 'F', now(), 1, false, '93100000-0000-0000-0000-00000000000a/x.xml'),
  ('93100000-0000-0000-0000-0000000000c2', '93100000-0000-0000-0000-00000000000b',
   '26261011222333000181550010000010511000030324', 1, 1,
   '11222333000181', 'F', now(), 1, false, '93100000-0000-0000-0000-00000000000b/x.xml');

-- A filha herda a org do pai (FK composta): item da nota A com org_id da org B tem de falhar.
do $$
begin
  begin
    insert into public.notas_compra_itens (nota_id, org_id, n_item, cprod, xprod, cfop, ucom, qcom, v_prod, codigo_pai)
    values ('93100000-0000-0000-0000-0000000000c1', '93100000-0000-0000-0000-00000000000b',
            1, 'P1', 'X', '5102', 'UN', 1, 1, 'PAI1');
    raise exception 'item com org_id diferente do da nota foi aceito';
  exception when foreign_key_violation then null;  -- 23503 esperado
  end;
end $$;
insert into storage.objects (bucket_id, name) values
  ('notas-compra', '93100000-0000-0000-0000-00000000000a/26261011222333000181550010000010511000030324/h.xml'),
  ('notas-compra', '93100000-0000-0000-0000-00000000000b/26261011222333000181550010000010511000030324/h.xml');

-- current_org_id() lê profiles.org_id do auth.uid() ativo (20260725224000_support_access.sql:183),
-- mesmo padrão de supabase/tests/estoque_rpc_tamanho.sql:70.
set local role authenticated;
set local request.jwt.claims = '{"sub":"93100000-0000-0000-0000-0000000000b1","role":"authenticated"}';
do $$
begin
  -- Controle positivo: a identidade resolve para a org B (senão "não vê A" passaria por cegueira total).
  if public.current_org_id() is distinct from '93100000-0000-0000-0000-00000000000b'::uuid then
    raise exception 'current_org_id não resolveu a org B: %', public.current_org_id(); end if;
  if (select count(*) from public.notas_compra) <> 1 then raise exception 'B deveria ver exatamente a própria nota'; end if;
  if exists (select 1 from public.notas_compra where org_id = '93100000-0000-0000-0000-00000000000a') then
    raise exception 'org B enxergou nota da org A'; end if;
  if (select count(*) from storage.objects where bucket_id = 'notas-compra') <> 1 then
    raise exception 'B deveria ver só o próprio XML no bucket'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'notas-compra'
                 and name = '93100000-0000-0000-0000-00000000000b/26261011222333000181550010000010511000030324/h.xml') then
    raise exception 'o XML visível para B não é o da org B'; end if;
  raise exception 'TESTE_OK' using errcode = 'P0001';
end $$;
rollback;
