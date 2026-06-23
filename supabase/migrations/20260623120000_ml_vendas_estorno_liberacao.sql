-- Fonte única ml_vendas (ADR-0038): guarda também o estorno e a data de liberação do recebimento,
-- antes exclusivos do menu Financeiro (Mercado Pago). Assim os 3 menus leem tudo da mesma tabela.
-- Populados pelo enriquecimento MP no webhook/backfill/reconciliação (ver _shared/faturamento).
alter table public.ml_vendas
  add column if not exists estorno numeric,
  add column if not exists money_release_date timestamptz;

comment on column public.ml_vendas.estorno is 'Total estornado na venda (MP transaction_amount_refunded). null = sem dado do MP.';
comment on column public.ml_vendas.money_release_date is 'Data de liberação do recebimento (MP money_release_date). null = sem dado do MP.';
