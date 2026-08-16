-- Pulse: status do vínculo de catálogo da nossa variação com a ficha monitorada (ADR-0119).
-- Sem vínculo o ML não calcula "preço para ganhar" (404 em /suggestions), e a coluna aparecia
-- como um traço mudo — o operador não tinha como saber que a causa é a ficha divergente.
alter table public.pulse_produtos add column catalogo_status text;

update public.pulse_produtos p
   set catalogo_status = (
     select v.catalog_status from public.variacoes v
      where v.catalog_product_id = p.catalog_product_id
        and v.org_id = p.org_id
        and v.catalog_status is not null
      limit 1
   )
 where p.catalogo_status is null;
