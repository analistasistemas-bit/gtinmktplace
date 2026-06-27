create type origem_concorrencia as enum ('gtin', 'titulo', 'nenhuma');
create type classe_concorrencia as enum ('sem', 'moderada', 'alta');

alter table familias
  add column concorrencia_vendedores integer not null default 0,
  add column concorrencia_preco_min numeric,
  add column concorrencia_origem origem_concorrencia not null default 'nenhuma',
  add column concorrencia_classe classe_concorrencia not null default 'sem';;
