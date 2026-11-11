\set ON_ERROR_STOP on
-- ADR-0201 (Galeria da cor), Task 16: galeria_retencao_listar — só `imagens`/`<org>/galeria-ia/`, mais de 1 dia,
-- depois do cursor (created_at, id), em ordem; execução só service_role. Rodar:
--   python3 scripts/teste-sql-desfeito.py supabase/tests/galeria_retencao.sql \
--     supabase/migrations/20261111111558_galeria_retencao.sql
begin;
set local lock_timeout = '5s';
insert into storage.objects (id, bucket_id, name, created_at) values
  ('97800000-0000-0000-0000-000000000001', 'imagens', '97800000-0000-0000-0000-0000000000aa/galeria-ia/f/rosa/1-1-a-b.png', now() - interval '3 days'),
  ('97800000-0000-0000-0000-000000000002', 'imagens', '97800000-0000-0000-0000-0000000000aa/galeria-ia/f/finais/a-b.jpg', now() - interval '2 days'),
  ('97800000-0000-0000-0000-000000000003', 'imagens', '97800000-0000-0000-0000-0000000000aa/galeria-ia/f/rosa/1-2-a-c.png', now() - interval '2 hours'),
  ('97800000-0000-0000-0000-000000000004', 'imagens', '97800000-0000-0000-0000-0000000000aa/lotes/x.jpg', now() - interval '3 days');

do $$
declare
  v_ids uuid[];
  v_c timestamptz;
begin
  if has_function_privilege('anon', 'public.galeria_retencao_listar(timestamptz, uuid, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.galeria_retencao_listar(timestamptz, uuid, integer)', 'execute') then
    raise exception 'anon/authenticated executam a listagem da retenção';
  end if;
  if not has_function_privilege('service_role', 'public.galeria_retencao_listar(timestamptz, uuid, integer)', 'execute') then
    raise exception 'service_role sem execute';
  end if;
  select array_agg(l.id order by l.created_at, l.id) into v_ids
    from public.galeria_retencao_listar(null, null, 1000) l where l.name like '97800000-%';
  if v_ids is distinct from array['97800000-0000-0000-0000-000000000001', '97800000-0000-0000-0000-000000000002']::uuid[] then
    raise exception 'listagem errada (só galeria-ia, > 1 dia, em ordem): %', v_ids;
  end if;
  select created_at into v_c from storage.objects where id = '97800000-0000-0000-0000-000000000001';
  select array_agg(l.id) into v_ids
    from public.galeria_retencao_listar(v_c, '97800000-0000-0000-0000-000000000001', 1000) l where l.name like '97800000-%';
  if v_ids is distinct from array['97800000-0000-0000-0000-000000000002']::uuid[] then
    raise exception 'cursor não avançou: %', v_ids;
  end if;
end $$;
rollback;
