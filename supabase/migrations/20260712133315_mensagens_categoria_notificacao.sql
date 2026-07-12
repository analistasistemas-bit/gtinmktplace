-- Adiciona a categoria 'mensagens' (ADR-0068) — mensagem pós-venda de comprador via ml-webhook
-- topic=messages. Antes o alerta usava lerConfigTelegram (chat único da org); agora roteia por
-- notificarCategoria como os demais tópicos.
alter table public.profiles
  drop constraint if exists profiles_telegram_categorias_validas;
alter table public.profiles
  add constraint profiles_telegram_categorias_validas
  check (telegram_categorias <@ array['vendas','perguntas','pos_venda','financeiro','moderacao','mensagens']::text[]);
