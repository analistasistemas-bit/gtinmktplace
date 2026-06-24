-- Preço de atacado (PxQ B2B do ML) por família. Faixas em jsonb; status/erro da aplicação.
-- Colunas já existiam no remoto (criadas fora de migration em 2026-06-23); aqui formaliza-se
-- o schema de forma idempotente. Ver ADR-0041.
alter table public.familias
  add column if not exists atacado jsonb,
  add column if not exists atacado_status text,
  add column if not exists atacado_erro text;

comment on column public.familias.atacado is
  'Faixas de preço de atacado (PxQ B2B do ML): [{"min_unidades":int>=2,"desconto_pct":1..99}], máx 5, crescente. null/[] = sem atacado.';
comment on column public.familias.atacado_status is
  'Aplicação do PxQ no ML: null | pendente | aplicado | erro. Independe do status de publicação.';
comment on column public.familias.atacado_erro is
  'Mensagem do último erro ao aplicar o PxQ no ML.';
