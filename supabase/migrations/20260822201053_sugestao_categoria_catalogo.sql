-- Sugestão de categoria pela ficha de catálogo (spec 2026-08-22, estende ADR-0057).
-- Aditivas e nullable: nenhum fluxo existente passa a exigir as colunas.
-- `vendedores` alimenta o rótulo "N vendedores competindo" do card sem chamada de rede.
alter table familias
  add column if not exists catalogo_categoria_sugerida_id text,
  add column if not exists catalogo_categoria_sugerida_nome text,
  add column if not exists catalogo_categoria_sugerida_vendedores integer;
