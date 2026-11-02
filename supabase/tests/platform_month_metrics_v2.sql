-- ADR-0193 Fatia 1: colunas v2 de platform_org_month_metrics.
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/platform_month_metrics_v2.sql \
--          supabase/migrations/20261102234250_platform_month_metrics_v2.sql
-- Sem a migration o teste falha (prova de vermelho): as colunas não existem.
begin;

do $$
declare
  faltando text[];
  org uuid;
  r record;
begin
  select array_agg(c) into faltando
    from unnest(array['cache_version','units','net_cents','tax_cents','cost_cents','profit_cents',
                      'covered_gross_cents','item_gross_cents','excluded_items','refunds_cents']) c
   where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'platform_org_month_metrics' and column_name = c);
  if faltando is not null then raise exception 'colunas ausentes: %', faltando; end if;

  -- linha antiga (sem as colunas novas) = v1 com componentes nulos, nunca zero
  if exists (select 1 from public.platform_org_month_metrics where cache_version <> 1) then
    raise exception 'linha existente deveria ficar com cache_version = 1';
  end if;

  select id into org from public.organizations limit 1;
  delete from public.platform_org_month_metrics where org_id = org and month = '1999-01-01';
  insert into public.platform_org_month_metrics (org_id, month, gross_cents, orders, ticket_cents, markup,
    cost_covered_orders, total_orders, source_count, tax_config_stamp)
  values (org, '1999-01-01', 0, 0, 0, null, 0, 0, 0, 'unconfirmed');
  select * into r from public.platform_org_month_metrics where org_id = org and month = '1999-01-01';
  if r.cache_version <> 1 or r.profit_cents is not null or r.excluded_items is not null
     or r.covered_gross_cents is not null or r.refunds_cents is not null then
    raise exception 'default inesperado: %', row_to_json(r);
  end if;

  -- v2 grava os componentes, inclusive profit_cents null (nenhum item calculável)
  update public.platform_org_month_metrics
     set cache_version = 2, units = 3, net_cents = 8000, tax_cents = 800, cost_cents = 5000,
         profit_cents = null, covered_gross_cents = 0, item_gross_cents = 10000, excluded_items = 2
   where org_id = org and month = '1999-01-01';
  select * into r from public.platform_org_month_metrics where org_id = org and month = '1999-01-01';
  if r.cache_version <> 2 or r.excluded_items <> 2 or r.profit_cents is not null then
    raise exception 'v2 não gravou: %', row_to_json(r);
  end if;

  -- RLS/privilégios inalterados: authenticated segue sem acesso
  if has_table_privilege('authenticated', 'public.platform_org_month_metrics', 'select') then
    raise exception 'authenticated não pode ler o cache';
  end if;
end $$;

rollback;
