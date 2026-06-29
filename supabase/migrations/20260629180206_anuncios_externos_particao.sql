-- ADR-0048: split de produto em N anúncios ML (limite 100 variações + 99999 estoque).
-- anuncios_externos passa de "1 listing por produto/canal" para "N partições por produto/canal".
-- Cada partição é um anúncio ML independente (item_externo_id + título + mapa de SKUs próprios).

alter table public.anuncios_externos
  add column if not exists particao smallint not null default 0,
  add column if not exists titulo text;

comment on column public.anuncios_externos.particao is
  'Índice do anúncio dentro do produto (0,1,2…). Produto com ≤100 cores tem só a partição 0.';
comment on column public.anuncios_externos.titulo is
  'Título que a IA gerou para este anúncio (distinto por partição; o ML bloqueia títulos idênticos).';

-- A unicidade passa a incluir a partição: um produto/canal pode ter N anúncios.
alter table public.anuncios_externos
  drop constraint anuncios_externos_user_id_canal_codigo_pai_key;

alter table public.anuncios_externos
  add constraint anuncios_externos_user_canal_pai_particao_key
  unique (user_id, canal, codigo_pai, particao);
