-- ADR-0193 D-8 (Fatia 1): cache de meses fechados ganha versão e os componentes do lucro por item
-- calculável (`resultadoPorItem`, ADR-0190). Linha com `cache_version` < 2 é miss (recalcula ao vivo e
-- regrava v2) — nunca vira zero. Colunas novas são nuláveis: `null` = não calculado (linha v1) ou
-- indisponível (ex.: `profit_cents` sem nenhum item calculável), nunca "zero".
--
-- `refunds_cents` é estorno pela data do estorno (ADR-0106). A validação do cache só olha
-- `ml_vendas` por `date_closed`, então um estorno tardio de venda de outro mês NÃO invalida esta
-- linha: o leitor não consome a coluna (KPIs do mês são ao vivo). Ver metrics-repository.ts.
alter table public.platform_org_month_metrics
  add column cache_version       smallint not null default 1,
  add column units               integer,
  add column net_cents           bigint,
  add column tax_cents           bigint,
  add column cost_cents          bigint,   -- Σ custo dos itens com lucro calculável (base do markup)
  add column profit_cents        bigint,   -- Σ lucro dos itens calculáveis; null = nenhum calculável
  add column covered_gross_cents bigint,   -- Σ faturamento dos itens calculáveis
  add column item_gross_cents    bigint,   -- Σ faturamento dos itens faturáveis (base da cobertura)
  add column excluded_items      integer,  -- nº de itens faturáveis sem lucro calculável
  add column refunds_cents       bigint;
