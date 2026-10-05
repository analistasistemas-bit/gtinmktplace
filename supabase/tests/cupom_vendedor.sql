-- ADR-0180: colunas do cupom do vendedor e receita da vitrine sem o cupom.
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/cupom_vendedor.sql supabase/migrations/20261005143525_cupom_vendedor.sql
begin;
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'ml_vendas' and column_name = 'cupom_vendedor' and is_nullable = 'YES') then
    raise exception 'ml_vendas.cupom_vendedor ausente ou not null';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'ml_vendas_itens' and column_name = 'cupom_vendedor'
                 and is_nullable = 'NO' and column_default = '0') then
    raise exception 'ml_vendas_itens.cupom_vendedor sem not null default 0';
  end if;
  if exists (select 1 from public.ml_vendas_itens where cupom_vendedor is null) then
    raise exception 'itens existentes ficaram com cupom null';
  end if;
  if position('i.unit_price - i.cupom_vendedor' in pg_get_functiondef('public.vitrine_resumo(date,date)'::regprocedure)) = 0 then
    raise exception 'vitrine_resumo sem o cupom na receita';
  end if;
end $$;
rollback;
