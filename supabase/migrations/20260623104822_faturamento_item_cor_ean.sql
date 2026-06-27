-- Faturamento (ADR-0037): cor vendida (da variação) e EAN no item da venda.
alter table public.ml_vendas_itens add column if not exists cor text;
alter table public.ml_vendas_itens add column if not exists ean text;
