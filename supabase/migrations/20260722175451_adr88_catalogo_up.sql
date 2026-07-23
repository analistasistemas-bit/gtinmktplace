-- ADR-0088 Fase 2 — vinculação de catálogo (ADR-0021) para o caminho User Products.
-- O item técnico UP (anuncios_externos_itens) é um item ML sem `variations[]`, então precisa
-- persistir o estado de catálogo POR ITEM FILHO — o que hoje só existe em `variacoes` (modelo
-- Legacy). Espelha as 4 colunas de catálogo de `variacoes`, mesmos tipos e mesmo check de status.
-- GTIN NÃO é duplicado aqui: é lido via join com `variacoes` no momento da vinculação.
alter table public.anuncios_externos_itens
  add column if not exists catalog_product_id text,
  add column if not exists catalog_listing_id text,
  add column if not exists catalog_status     text,
  add column if not exists catalog_erro        text;

-- Mesmo check de `variacoes` (20260615123507_catalogo_ficha_divergente.sql). Nullable: NULL passa
-- no CHECK e é o estado "ainda não avaliado".
alter table public.anuncios_externos_itens
  add constraint anuncios_externos_itens_catalog_status_check
  check (catalog_status in ('pendente','vinculado','sem_produto','family_diff','nao_elegivel','erro','ficha_divergente'));

comment on column public.anuncios_externos_itens.catalog_status is
  'Estado de vinculação ao catálogo do item técnico UP (ADR-0021/0088). Espelha variacoes.catalog_status.';
