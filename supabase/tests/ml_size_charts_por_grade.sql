-- ADR-0182 D6: ml_size_charts por grade. Rodar com scripts/teste-sql-desfeito.py (transacao desfeita).
begin;

-- Backfill nas linhas REAIS: nenhuma sem grade, e cada uma com a grade da sua regra.
do $$ declare n int; total int; begin
  select count(*) into total from public.ml_size_charts;
  if total = 0 then raise exception 'esperava linhas reais em ml_size_charts'; end if;
  select count(*) into n from public.ml_size_charts where grade_tamanho is null;
  if n > 0 then raise exception '% linhas sem grade_tamanho', n; end if;
  select count(*) into n from public.ml_size_charts where
    (domain_id in ('SNEAKERS', 'SANDALS_AND_CLOGS') and grade_tamanho <> 'calcado')
    or (domain_id not in ('SNEAKERS', 'SANDALS_AND_CLOGS')
        and genero in ('meninos', 'meninas', 'sem_genero_infantil') and grade_tamanho <> 'infantil')
    or (domain_id not in ('SNEAKERS', 'SANDALS_AND_CLOGS')
        and genero not in ('meninos', 'meninas', 'sem_genero_infantil') and grade_tamanho <> 'letras');
  if n > 0 then raise exception '% linhas com grade errada no backfill', n; end if;
end $$;

-- Charts infantis criados no ensaio de 2026-10-16.
do $$ declare n int; begin
  select count(*) into n from public.ml_size_charts
   where chart_id in ('10161653', '10161579') and grade_tamanho = 'infantil' and domain_id = 'SHORTS';
  if n <> 2 then raise exception 'charts 10161653/10161579 deviam ser SHORTS/infantil (achou %)', n; end if;
end $$;

-- PK nova com as 4 colunas, sem default na coluna.
do $$ declare d text; def text; begin
  select pg_get_constraintdef(oid) into d from pg_constraint
   where conname = 'ml_size_charts_pkey' and conrelid = 'public.ml_size_charts'::regclass and contype = 'p';
  if d is distinct from 'PRIMARY KEY (connection_id, domain_id, genero, grade_tamanho)' then
    raise exception 'PK inesperada: %', d;
  end if;
  select column_default into def from information_schema.columns
   where table_schema = 'public' and table_name = 'ml_size_charts' and column_name = 'grade_tamanho';
  if def is not null then raise exception 'grade_tamanho nao devia ter default: %', def; end if;
end $$;

-- Mesma (conexao, dominio, genero) com grades diferentes coexistem; repetir a chave falha.
do $$ declare c uuid; begin
  select connection_id into c from public.ml_size_charts limit 1;
  insert into public.ml_size_charts (connection_id, domain_id, genero, grade_tamanho, chart_id, linhas)
  values (c, 'TESTE_ADR182', 'masculino', 'letras', 't1', '{}'),
         (c, 'TESTE_ADR182', 'masculino', 'calca', 't2', '{}');
  begin
    insert into public.ml_size_charts (connection_id, domain_id, genero, grade_tamanho, chart_id, linhas)
    values (c, 'TESTE_ADR182', 'masculino', 'calca', 't3', '{}');
    raise exception 'chave repetida deveria falhar';
  exception when unique_violation then null;
  end;
  begin
    insert into public.ml_size_charts (connection_id, domain_id, genero, chart_id, linhas)
    values (c, 'TESTE_ADR182', 'feminino', 't4', '{}');
    raise exception 'insert sem grade deveria falhar';
  exception when not_null_violation then null;
  end;
  begin
    insert into public.ml_size_charts (connection_id, domain_id, genero, grade_tamanho, chart_id, linhas)
    values (c, 'TESTE_ADR182', 'feminino', 'xg', 't5', '{}');
    raise exception 'grade invalida deveria falhar';
  exception when check_violation then null;
  end;
end $$;
rollback;
