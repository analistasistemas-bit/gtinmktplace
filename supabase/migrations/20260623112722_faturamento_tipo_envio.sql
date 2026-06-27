-- Faturamento (ADR-0037): tipo logístico do envio (Full/Flex/Agência/Coleta) p/ KPI por tipo.
alter table public.ml_vendas add column if not exists shipping_logistic text;
