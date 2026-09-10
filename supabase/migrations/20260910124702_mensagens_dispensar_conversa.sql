-- Dispensar conversa (ADR-0067): uma conversa deixa de "aguardar resposta" quando a última
-- recebida está marcada como lida — o que já acontecia ao responder pelo app. Passa a valer
-- também quando o operador dispensa a conversa à mão, único caminho para packs que o ML
-- bloqueia (403 blocked_by_mediation) e que por isso nunca teriam uma resposta enviada.
--
-- A escrita reusa `marcar_mensagens_lidas(p_pack_id)`, que já existe com grant a authenticated.
-- Aqui só a contagem do badge muda: passa a respeitar `lida`. O `aguardando` calculado no
-- frontend (src/lib/mensagens.ts) ganha a mesma exigência no mesmo commit — as duas regras
-- mudam juntas, não é o SQL se alinhando a um front que já contava assim.
-- Mensagem nova do comprador entra com `lida = false` e reabre a conversa sozinha.
--
-- Efeito no acervo existente: saem de "Aguardando" os packs cuja última mensagem é `recebida`
-- mas já está `lida` — o que só acontece quando o app respondeu com sucesso e a re-busca do
-- pack falhou (`buscarMensagensPack` devolve [] em qualquer erro do ML), deixando a `enviada`
-- fora do banco. São conversas já respondidas: sair de Aguardando é a correção, não regressão.
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
