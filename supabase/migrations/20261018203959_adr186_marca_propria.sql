-- ADR-0186 — marca própria por organização.
-- Org com marca_propria publica BRAND/MANUFACTURER sempre com marca_padrao; o fornecedor da
-- planilha (onde a mercadoria é comprada) nunca vai para o canal. Só a Zaven liga a opção.

alter table public.organizations
  add column marca_propria boolean not null default false;

comment on column public.organizations.marca_propria is
  'ADR-0186: true = BRAND/MANUFACTURER sempre = marca_padrao; o fornecedor nunca vira marca no canal.';

do $$
declare
  n int;
begin
  update public.organizations
     set marca_propria = true
   where id = 'b95a1c97-8477-4e3a-89b8-04f735549072'
     and btrim(coalesce(marca_padrao, '')) <> '';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'ADR-0186: esperado ligar marca_propria em 1 org (Zaven), afetou %', n;
  end if;
end $$;

-- Data fix: famílias da Zaven gravadas com BRAND/MANUFACTURER = fornecedor. Só linhas que têm o
-- atributo (array vazio agregaria NULL e violaria o NOT NULL); value_id/values saem junto.
update public.familias f
   set atributos_ml = (
     select jsonb_agg(
              case when e->>'id' in ('BRAND', 'MANUFACTURER')
                   then jsonb_build_object('id', e->>'id', 'value_name', 'Zaven')
                   else e end
              order by o)
       from jsonb_array_elements(f.atributos_ml) with ordinality x(e, o))
 where f.org_id = 'b95a1c97-8477-4e3a-89b8-04f735549072'
   and exists (select 1 from jsonb_array_elements(f.atributos_ml) e
                where e->>'id' in ('BRAND', 'MANUFACTURER'));
