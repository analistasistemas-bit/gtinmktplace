-- ADR-0021: vinculação automática ao Catálogo do ML (opt-in por variação).
-- Colunas aditivas em variacoes. catalog_product_id = produto de catálogo casado por GTIN;
-- catalog_listing_id = MLB do anúncio de catálogo paralelo criado pelo opt-in (idempotência);
-- catalog_status = estado do vínculo; catalog_erro = última mensagem de erro do opt-in.
alter table public.variacoes
  add column if not exists catalog_product_id text,
  add column if not exists catalog_listing_id text,
  add column if not exists catalog_status text not null default 'pendente',
  add column if not exists catalog_erro text;

-- Valores válidos de catalog_status (texto, padrão do projeto p/ estados de domínio simples).
alter table public.variacoes drop constraint if exists variacoes_catalog_status_check;
alter table public.variacoes add constraint variacoes_catalog_status_check
  check (catalog_status in ('pendente','vinculado','sem_produto','family_diff','nao_elegivel','erro'));
