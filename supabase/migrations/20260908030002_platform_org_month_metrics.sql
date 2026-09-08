-- Perf FASE 3 (ADR-0159, plano docs/superpowers/plans/2026-09-07-perf-central-organizacoes.md).
--
-- `platform_org_month_metrics` e cache reconstituivel de OrgMetrics para meses FECHADOS -- nao e
-- demonstrativo de cobranca. O imutavel/auditavel continua sendo platform_billing_statements /
-- platform_billing_sale_facts (ADR-0155, append-only). Nao guarda markup como verdade congelada:
-- ele e razao (liquido-custo-imposto)/custo, recalculavel a qualquer momento dos componentes.
--
-- Fechamento de mes em BRT (America/Fortaleza), identico a `startOf` (metrics-repository.ts).
-- Invalidacao por (source_count, source_max_updated_at, tax_config_stamp) -- ver
-- `platform_org_month_validation` abaixo e `readOrgMetrics`/`materializeMonth`
-- (_shared/platform-admin/metrics-repository.ts). Sem trigger em ml_vendas/ml_vendas_itens/
-- variacoes: o watermark `ml_vendas.atualizado_em` + `count(*)` ja cobrem INSERT/UPDATE/DELETE de
-- vendas (upsertVenda, devolucoes-io.ts, migration 20260720013021), e a deriva de `variacoes` sem
-- custo congelado e aceita e medida (ADR-0159).

create table public.platform_org_month_metrics (
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  month                  date not null check (month = date_trunc('month', month)::date),
  gross_cents            bigint  not null,
  orders                 integer not null,
  ticket_cents           bigint  not null,
  markup                 numeric,                 -- null = sem custo OU config nao confirmada
  cost_covered_orders    integer not null,
  total_orders           integer not null,
  updated_at             timestamptz,             -- max(ml_vendas.atualizado_em) do mes
  source_count           integer not null,        -- count(*) da janela lida
  source_max_updated_at  timestamptz,
  tax_config_stamp       text not null,           -- config tributaria usada, ou 'unconfirmed'
  computed_at            timestamptz not null default now(),
  primary key (org_id, month)
);
alter table public.platform_org_month_metrics enable row level security;
revoke all on public.platform_org_month_metrics from anon, authenticated;
-- sem policy: so service_role (padrao de 20260906170200_platform_billing.sql:52-56)

-- Perf FASE 3.3: validacao em lote, UMA query por carteira inteira (p_org nulo) ou por organizacao
-- (p_org informado, usado pelo fallback de leitura avulsa em `organization`/`metrics`). Agrupa por
-- (org_id, mes fechado em BRT) desde p_since -- index scan em ml_vendas_org_data_idx, medido em
-- producao (~10 ms). O leitor compara (source_count, source_max_updated_at) com a linha
-- materializada; nao bater invalida o cache e cai no calculo ao vivo (nunca zero silencioso).
create or replace function public.platform_org_month_validation(p_org uuid, p_since timestamptz)
returns table (org_id uuid, month date, source_count bigint, source_max_updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    v.org_id,
    (date_trunc('month', v.date_closed at time zone 'America/Fortaleza'))::date as month,
    count(*) as source_count,
    max(v.atualizado_em) as source_max_updated_at
  from public.ml_vendas v
  where v.date_closed >= p_since
    and (p_org is null or v.org_id = p_org)
  group by v.org_id, month
$$;

comment on function public.platform_org_month_validation(uuid, timestamptz) is
  'ADR-0159/FASE 3.3: count(*) e max(atualizado_em) por (org_id, mes fechado em BRT) desde p_since, para validar platform_org_month_metrics. p_org nulo cobre a carteira inteira numa unica ida. Somente service_role.';

revoke all on function public.platform_org_month_validation(uuid, timestamptz) from public;
revoke all on function public.platform_org_month_validation(uuid, timestamptz) from anon;
revoke all on function public.platform_org_month_validation(uuid, timestamptz) from authenticated;
grant execute on function public.platform_org_month_validation(uuid, timestamptz) to service_role;
