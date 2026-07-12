-- Badge "aguardando resposta" (avatar/menu) — conta conversas (packs) cuja última mensagem é do
-- comprador, sem baixar a tabela `ml_mensagens` inteira no browser (plan 036).
create or replace function public.contar_conversas_aguardando()
returns integer
language sql
security definer
set search_path = public
as $$
  with ultimas as (
    select distinct on (pack_id) direcao
    from public.ml_mensagens
    where user_id = auth.uid()
    order by pack_id, data_ml desc nulls last, message_id desc
  )
  select count(*)::int from ultimas where direcao = 'recebida';
$$;

revoke all on function public.contar_conversas_aguardando() from public;
grant execute on function public.contar_conversas_aguardando() to authenticated;
