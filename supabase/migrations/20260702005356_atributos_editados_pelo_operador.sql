alter table public.familias
  add column if not exists atributos_editados_pelo_operador boolean not null default false;

comment on column public.familias.atributos_editados_pelo_operador is
  'Atributos completados manualmente na Revisão (Camada 2B, ADR-0052). process-familia não sobrescreve quando true.';
