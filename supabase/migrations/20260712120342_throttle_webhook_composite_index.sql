-- Índice composto para o throttle do ml-webhook (INT-018/033).
-- A query do throttle filtra `user_id = ? AND recebido_em >= ?` (janela de 60s).
-- O índice single `ml_webhook_eventos_user_idx (user_id)` cobre só a igualdade; o composto
-- resolve também o range de tempo em index scan. Substitui o single — o prefixo (user_id)
-- continua coberto pelo composto, então nenhuma query regride e evita-se manter 2 índices
-- sobrepostos na hot path de insert do webhook.
drop index if exists public.ml_webhook_eventos_user_idx;
create index if not exists ml_webhook_eventos_user_recebido_idx
  on public.ml_webhook_eventos (user_id, recebido_em);
