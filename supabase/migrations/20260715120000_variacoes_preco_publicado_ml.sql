alter table public.variacoes
  add column if not exists preco_publicado_ml numeric null;

comment on column public.variacoes.preco_publicado_ml is
  'Preco de venda efetivamente confirmado no ML para este SKU no ultimo publish/update bem-sucedido. Base do badge "preco alterado" (Revisao). NULL = nunca publicado. ADR-0078.';
