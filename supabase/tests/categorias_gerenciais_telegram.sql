-- ADR-0190: os CHECKs de notificacoes.categoria e profiles.telegram_categorias aceitam as categorias gerenciais.
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/categorias_gerenciais_telegram.sql supabase/migrations/20261025013718_categorias_gerenciais_telegram.sql
begin;
do $$
declare p record;
begin
  select id, org_id into p from public.profiles where org_id is not null limit 1;
  if p.id is null then raise exception 'sem profile para o teste'; end if;
  insert into public.notificacoes (user_id, org_id, categoria, texto)
    values (p.id, p.org_id, 'resumo_diario', 'teste ADR-0190');
  update public.profiles set telegram_categorias = '{vendas_gerencial}' where id = p.id;
end $$;
rollback;
