-- ADR-0182: grade de tamanho da familia (Letras/Infantil/Calca/Calcado) e generos infantis.
--
-- grade_tamanho NASCE NULL em toda linha existente. Sem backfill e sem default: null = inferencia
-- legada (so Letras/Calcado), e o estado de toda org sem tipo de produto habilitado (INV-1).
-- Nenhuma familia/anuncio existente muda.
--
-- Generos infantis (meninos/meninas/sem_genero_infantil) entram no mesmo CHECK de familias e no
-- cache ml_size_charts: o ML exige que o GENDER do anuncio bata com o da tabela de medidas.
-- Constraints recriados com o MESMO nome (conferidos em prod 2026-10-16) para a prova por
-- pg_constraint continuar achando-os.

alter table public.familias
  add column if not exists grade_tamanho text
  constraint familias_grade_tamanho_valida
  check (grade_tamanho is null or grade_tamanho in ('letras', 'infantil', 'calca', 'calcado'));

comment on column public.familias.grade_tamanho is
  'ADR-0182: grade de tamanho da familia (letras/infantil/calca/calcado). NULL = inferencia legada (so Letras/Calcado), estado de toda familia anterior ao ADR-0182 e de org sem tipo de produto habilitado.';

-- familias continua aceitando genero null (ADR-0166).
alter table public.familias drop constraint familias_genero_valido;
alter table public.familias add constraint familias_genero_valido
  check (genero is null or genero in ('masculino', 'feminino', 'unissex', 'meninos', 'meninas', 'sem_genero_infantil'));

-- ml_size_charts.genero e not null: o CHECK continua sem ramo null.
alter table public.ml_size_charts drop constraint ml_size_charts_genero_check;
alter table public.ml_size_charts add constraint ml_size_charts_genero_check
  check (genero in ('masculino', 'feminino', 'unissex', 'meninos', 'meninas', 'sem_genero_infantil'));
