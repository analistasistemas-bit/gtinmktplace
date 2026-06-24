-- Idempotência da notificação de liberação (edge notificar-liberacao): marca quando o aviso de
-- "dinheiro liberado hoje" foi enviado para a venda, evitando reenvio se o schedule repetir.
alter table public.ml_vendas
  add column if not exists liberacao_notificada_em date;

comment on column public.ml_vendas.liberacao_notificada_em is
  'Data em que a notificação Telegram de liberação foi enviada para esta venda (null = ainda não).';
