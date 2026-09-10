-- Dispensar conversa (ADR-0067): uma conversa deixa de "aguardar resposta" quando a última
-- recebida está marcada como lida — o que já acontecia ao responder pelo app. Passa a valer
-- também quando o operador dispensa a conversa à mão, único caminho para packs que o ML
-- bloqueia (403 blocked_by_mediation) e que por isso nunca teriam uma resposta enviada.
--
-- A escrita reusa `marcar_mensagens_lidas(p_pack_id)`, que já existe com grant a authenticated.
-- Aqui só a contagem do badge muda: passa a respeitar `lida`, alinhando-se ao `aguardando`
-- calculado no frontend (src/lib/mensagens.ts). Mensagem nova do comprador entra com
-- `lida = false` e reabre a conversa sozinha.
create or replace function public.contar_conversas_aguardando()
returns integer
language sql
security definer
set search_path = public
as $$
  with ultimas as (
    select distinct on (pack_id) direcao, order_status, lida
    from public.ml_mensagens
    where user_id = auth.uid()
    order by pack_id, data_ml desc nulls last, message_id desc
  )
  select count(*)::int
  from ultimas
  where direcao = 'recebida'
    and coalesce(order_status, '') <> 'cancelled'
    and not lida;
$$;
