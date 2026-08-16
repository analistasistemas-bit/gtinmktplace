-- Pulse: EAN/GTIN do produto monitorado, exibido na lista do radar sob o nome (ADR-0119).
-- A ficha de catálogo corresponde a UMA variação (uma cor), então o GTIN vem de
-- `variacoes.catalog_product_id` — não do código da família, que agrupa várias fichas.
alter table public.pulse_produtos add column gtin text;

-- Backfill: 221 dos 222 produtos já no radar casam com uma variação com GTIN.
update public.pulse_produtos p
   set gtin = (
     select v.gtin from public.variacoes v
      where v.catalog_product_id = p.catalog_product_id
        and v.org_id = p.org_id
        and v.gtin is not null
      limit 1
   )
 where p.gtin is null;
