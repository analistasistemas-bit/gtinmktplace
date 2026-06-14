-- ADR-0025 / E2: modelo de dados multicanal. Tabela anuncios_externos (1 produto -> N anúncios
-- por canal), ancorada em (user_id, canal, codigo_pai) — familias é por-lote e várias linhas
-- compartilham o mesmo ml_item_id após UPDATE, então familia_id não é âncora estável.
-- Estratégia strangler dual-write: as colunas ml_*/catalog_* em familias/variacoes seguem como
-- fonte de verdade; esta tabela é o espelho mantido pelos workers, pronto p/ o 2º canal.

create type public.canal_externo as enum ('mercado_livre');

create table public.anuncios_externos (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  canal               public.canal_externo not null,
  codigo_pai          text not null,

  item_externo_id     text,                      -- = ml_item_id
  permalink           text,
  status              text not null default 'publicado',
  erro_mensagem       text,

  -- mapa codigo(sku) -> { variation_id, catalog_product_id, catalog_listing_id, catalog_status }
  variacoes_externas  jsonb not null default '{}'::jsonb,
  -- reservados (vazios hoje — YAGNI): metadados específicos do canal e override de preço por canal
  metadados_canal     jsonb not null default '{}'::jsonb,
  preco_override      numeric,

  publicado_em        timestamptz,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),

  unique (user_id, canal, codigo_pai)
);

create index anuncios_externos_user_canal_idx on public.anuncios_externos (user_id, canal);

create trigger anuncios_externos_set_updated_at
  before update on public.anuncios_externos
  for each row execute procedure extensions.moddatetime (atualizado_em);

alter table public.anuncios_externos enable row level security;

create policy "anuncios_externos: select own" on public.anuncios_externos
  for select using ((select auth.uid()) = user_id);
create policy "anuncios_externos: insert own" on public.anuncios_externos
  for insert with check ((select auth.uid()) = user_id);
create policy "anuncios_externos: update own" on public.anuncios_externos
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "anuncios_externos: delete own" on public.anuncios_externos
  for delete using ((select auth.uid()) = user_id);

-- Backfill: 1 linha por (user_id, codigo_pai) publicado.
-- Identidade (item/permalink/publicado_em) vem da família mais recente; o mapa de variações
-- AGREGA todas as variações de TODAS as famílias do mesmo (user_id, codigo_pai), dedup por
-- código (a família mais recente vence). Isso evita truncar o mapa quando o último lote foi uma
-- reposição parcial (poucos SKUs) — ver ADR-0025 / review E2.
with ident as (
  select distinct on (f.user_id, f.codigo_pai)
    f.user_id, f.codigo_pai, f.ml_item_id, f.ml_permalink, f.publicado_em
  from public.familias f
  where f.ml_item_id is not null
  order by f.user_id, f.codigo_pai, f.publicado_em desc nulls last
),
vars as (
  select distinct on (f.user_id, f.codigo_pai, v.codigo)
    f.user_id, f.codigo_pai, v.codigo,
    v.ml_variation_id, v.catalog_product_id, v.catalog_listing_id, v.catalog_status
  from public.familias f
  join public.variacoes v on v.familia_id = f.id
  where f.ml_item_id is not null and v.ml_variation_id is not null
  order by f.user_id, f.codigo_pai, v.codigo, f.publicado_em desc nulls last
),
mapa as (
  select user_id, codigo_pai,
    jsonb_object_agg(codigo, jsonb_strip_nulls(jsonb_build_object(
      'variation_id', ml_variation_id,
      'catalog_product_id', catalog_product_id,
      'catalog_listing_id', catalog_listing_id,
      'catalog_status', nullif(catalog_status, 'pendente')
    ))) as variacoes_externas
  from vars
  group by user_id, codigo_pai
)
insert into public.anuncios_externos
  (user_id, canal, codigo_pai, item_externo_id, permalink, status, variacoes_externas, publicado_em)
select
  i.user_id, 'mercado_livre'::public.canal_externo, i.codigo_pai,
  i.ml_item_id, i.ml_permalink, 'publicado',
  coalesce(m.variacoes_externas, '{}'::jsonb),
  i.publicado_em
from ident i
left join mapa m on m.user_id = i.user_id and m.codigo_pai = i.codigo_pai
on conflict (user_id, canal, codigo_pai) do nothing;
