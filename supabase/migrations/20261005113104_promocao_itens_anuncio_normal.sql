-- ADR-0174, emenda 2026-10-05: par normal/catálogo (mesmo User Product) vira uma linha só, a do catálogo
-- (o ML só aceita a promoção por ele), exibida com a cara do normal. Esta coluna guarda o MLB do normal.
alter table public.ml_promocao_itens add column anuncio_normal_id text;
