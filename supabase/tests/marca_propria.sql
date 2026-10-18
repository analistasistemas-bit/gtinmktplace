-- ADR-0186 — marca própria por organização. Rodar com a fotografia ANTES da migration:
--   python3 scripts/teste-sql-desfeito.py supabase/tests/marca_propria.sql \
--     supabase/tests/marca_propria_antes.sql supabase/migrations/<ts>_adr186_marca_propria.sql
\set ON_ERROR_STOP on
begin;
do $$
declare
  zaven constant uuid := 'b95a1c97-8477-4e3a-89b8-04f735549072';
  n int;
begin
  if not (select marca_propria from public.organizations where id = zaven) then
    raise exception 'Zaven sem marca_propria';
  end if;
  select count(*) into n from public.organizations where marca_propria;
  if n <> 1 then raise exception 'marca_propria em % orgs (esperado 1)', n; end if;

  select count(*) into n
  from public.familias f, jsonb_array_elements(f.atributos_ml) e
  where f.org_id = zaven and e->>'id' in ('BRAND', 'MANUFACTURER')
    and (e->>'value_name' is distinct from 'Zaven' or e ? 'value_id' or e ? 'values');
  if n <> 0 then raise exception '% BRAND/MANUFACTURER da Zaven fora do padrão', n; end if;

  select count(*) into n
  from public.familias f, jsonb_array_elements(f.atributos_ml) e
  where f.org_id = zaven and e->>'id' = 'BRAND';
  if n = 0 then raise exception 'nenhum BRAND da Zaven conferido (data fix não achou nada?)'; end if;

  if (select atributos_ml from public.familias where id = '86000000-0000-0000-0000-000000000001') <> '[]'::jsonb then
    raise exception 'família de atributos vazios mudou';
  end if;
  if (select atributos_ml from public.familias where id = '86000000-0000-0000-0000-000000000002')
     <> '[{"id":"MODEL","value_name":"X"}]'::jsonb then
    raise exception 'família sem BRAND mudou';
  end if;

  if (select md5(string_agg(atributos_ml::text, '' order by id)) from public.familias where org_id <> zaven)
     is distinct from (select fora from t186_antes) then
    raise exception 'atributos de outra org mudaram';
  end if;
  if (select md5(string_agg(coalesce((select jsonb_agg(e order by o)
        from jsonb_array_elements(f.atributos_ml) with ordinality x(e, o)
        where e->>'id' not in ('BRAND', 'MANUFACTURER')), '[]'::jsonb)::text, '' order by f.id))
      from public.familias f where f.org_id = zaven)
     is distinct from (select zaven_resto from t186_antes) then
    raise exception 'demais atributos da Zaven mudaram';
  end if;
end $$;
rollback;
