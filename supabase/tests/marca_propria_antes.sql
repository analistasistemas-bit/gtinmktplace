-- ADR-0186 — pré-condição do teste marca_propria.sql. Passar ANTES da migration:
--   python3 scripts/teste-sql-desfeito.py supabase/tests/marca_propria.sql \
--     supabase/tests/marca_propria_antes.sql supabase/migrations/<ts>_adr186_marca_propria.sql
-- Fotografa o estado antes da migration (dentro da mesma transação, desfeita no fim) e cria duas
-- famílias de borda da Zaven: atributos vazios e sem BRAND.

-- Bordas: clones de uma família real da Zaven, só com id/codigo_pai/atributos_ml trocados.
insert into public.familias
select (jsonb_populate_record(null::public.familias, to_jsonb(f)
  || jsonb_build_object('id', '86000000-0000-0000-0000-000000000001', 'codigo_pai', '99918601', 'chave_cadastro', gen_random_uuid(),
                        'atributos_ml', '[]'::jsonb))).*
from public.familias f where f.org_id = 'b95a1c97-8477-4e3a-89b8-04f735549072' order by f.id limit 1;

insert into public.familias
select (jsonb_populate_record(null::public.familias, to_jsonb(f)
  || jsonb_build_object('id', '86000000-0000-0000-0000-000000000002', 'codigo_pai', '99918602', 'chave_cadastro', gen_random_uuid(),
                        'atributos_ml', '[{"id":"MODEL","value_name":"X"}]'::jsonb))).*
from public.familias f where f.org_id = 'b95a1c97-8477-4e3a-89b8-04f735549072' order by f.id limit 1;

create temp table t186_antes on commit drop as
select
  (select md5(string_agg(atributos_ml::text, '' order by id)) from public.familias
    where org_id <> 'b95a1c97-8477-4e3a-89b8-04f735549072') as fora,
  (select md5(string_agg(coalesce((select jsonb_agg(e order by o)
      from jsonb_array_elements(f.atributos_ml) with ordinality x(e, o)
      where e->>'id' not in ('BRAND', 'MANUFACTURER')), '[]'::jsonb)::text, '' order by f.id))
    from public.familias f where f.org_id = 'b95a1c97-8477-4e3a-89b8-04f735549072') as zaven_resto;
