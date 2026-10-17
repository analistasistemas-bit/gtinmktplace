-- ADR-0182 D6 (fallback previsto): cache de chart do ML passa a ser por grade de tamanho.
-- Ensaio real 2026-10-16: o ML recusou o chart adulto misto Letras + Calca em POST /catalog/charts
-- com `value_is_not_the_same_type` ("All FILTRABLE_SIZE values must be the same type"). Cada grade
-- ganha o proprio chart: chave (connection_id, domain_id, genero, grade_tamanho).
--
-- Backfill das linhas existentes pela unica grade que cada uma pode ter: calcado pelo dominio,
-- infantil pelo genero, o resto (peito JACKETS/SPORT_T_SHIRTS) e Letras. Sem default de proposito:
-- todo insert tem que dizer a grade (garantirChart sempre manda).

alter table public.ml_size_charts add column grade_tamanho text;

update public.ml_size_charts set grade_tamanho = case
  when domain_id in ('SNEAKERS', 'SANDALS_AND_CLOGS') then 'calcado'
  when genero in ('meninos', 'meninas', 'sem_genero_infantil') then 'infantil'
  else 'letras'
end;

alter table public.ml_size_charts alter column grade_tamanho set not null;
alter table public.ml_size_charts add constraint ml_size_charts_grade_tamanho_check
  check (grade_tamanho in ('letras', 'infantil', 'calca', 'calcado'));

alter table public.ml_size_charts drop constraint ml_size_charts_pkey;
alter table public.ml_size_charts add constraint ml_size_charts_pkey
  primary key (connection_id, domain_id, genero, grade_tamanho);

comment on table public.ml_size_charts is
  'ADR-0167/ADR-0182 D6: cache do chart de guia de tamanhos do ML por conexao+dominio+genero+grade. Imutavel -- nunca dar update em linhas, so inserir novo chart.';
