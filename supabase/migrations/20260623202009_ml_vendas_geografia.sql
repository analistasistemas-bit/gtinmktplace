-- Geografia das vendas (ADR-0039 Fase 2): cidade/UF de entrega do comprador.
-- Vêm do receiver_address do shipment do ML (/shipments/{id}), já buscado no
-- backfill/webhook/reconciliação. UF sem o prefixo "BR-" (ex.: "SP").
alter table ml_vendas add column if not exists cidade text;
alter table ml_vendas add column if not exists uf text;
