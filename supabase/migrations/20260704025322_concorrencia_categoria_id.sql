-- ============================================================================
-- category_id do concorrente (ADR-0057) — hoje calculado em process-familia e
-- descartado; persistido para virar sugestão não-vinculante no seletor de categoria.
-- ============================================================================

alter table public.familias
  add column if not exists concorrencia_categoria_id text;
