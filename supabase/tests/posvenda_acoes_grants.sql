-- ADR-0192. Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/posvenda_acoes_grants.sql supabase/migrations/20261028154949_posvenda_ml.sql
begin;
do $$
begin
  if has_table_privilege('authenticated','public.ml_posvenda_acoes','TRUNCATE') then raise exception 'authenticated com TRUNCATE'; end if;
  if has_table_privilege('authenticated','public.ml_posvenda_acoes','INSERT') then raise exception 'authenticated com INSERT'; end if;
  if has_table_privilege('authenticated','public.ml_posvenda_acoes','UPDATE') then raise exception 'authenticated com UPDATE'; end if;
  if has_table_privilege('authenticated','public.ml_posvenda_acoes','DELETE') then raise exception 'authenticated com DELETE'; end if;
  if not has_table_privilege('authenticated','public.ml_posvenda_acoes','SELECT') then raise exception 'authenticated sem SELECT'; end if;
  if has_table_privilege('anon','public.ml_posvenda_acoes','SELECT') then raise exception 'anon com SELECT'; end if;
  if exists (select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
              where c.conrelid = 'public.ml_posvenda_acoes'::regclass and c.contype = 'f' and a.attname = 'user_id') then
    raise exception 'FK em ml_posvenda_acoes.user_id (R6: não pode existir)';
  end if;
  if (select count(*) from pg_indexes where tablename='ml_posvenda_acoes'
        and indexname in ('ml_posvenda_acoes_operacao_uniq','ml_posvenda_acoes_trava_uniq')) <> 2 then
    raise exception 'índices únicos ausentes';
  end if;
  if (select count(*) from information_schema.columns where table_name='ml_devolucoes'
        and column_name in ('return_id','detalhe','prazo','vez_de','revisao_pendente','revisao_status','afeta_reputacao','rastreio','pedidos_devolucao','enriquecido_em','lido_em')) <> 11 then
    raise exception 'colunas de ml_devolucoes faltando';
  end if;
  if not exists (select 1 from information_schema.columns where table_name='ml_mensagens' and column_name='lida_ml_em') then
    raise exception 'lida_ml_em ausente';
  end if;
end $$;
rollback;
