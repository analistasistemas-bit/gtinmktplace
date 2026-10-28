-- Pós-venda ML (Task 7): contadores dos cards da aba Mensagens. Agrega POR PACK sobre TODAS as
-- mensagens da org (o front só baixa as 1000 mais recentes). Cancelados ficam fora (como o badge).
--  Não lidas = alguma recebida ainda sem `lida_ml_em` (leitura no ML), por situação de envio.
--  Lidas = nenhuma recebida pendente no ML; "sem responder" = última é recebida e não dispensada
--  (`lida` local); "respondidas" = última é enviada.
create or replace function public.resumo_mensagens_posvenda()
returns table (
  nao_lidas_total integer, a_preparar integer, a_caminho integer, entregues integer,
  sem_responder integer, respondidas integer
)
language sql
stable
security definer
set search_path = public
as $$
  with p as (
    select pack_id,
      bool_or(direcao = 'recebida' and lida_ml_em is null) as nao_lida_ml,
      (array_agg(direcao order by data_ml desc nulls last, message_id desc))[1] as ult_dir,
      (array_agg(lida order by data_ml desc nulls last, message_id desc))[1] as ult_lida,
      (array_agg(order_status order by data_ml desc nulls last, message_id desc))[1] as status_pedido
    from public.ml_mensagens
    where org_id = public.current_org_id()
    group by pack_id
  ), v as (
    select p.*, (
      select ev.shipping_status from public.ml_vendas ev
      where ev.org_id = public.current_org_id()
        and (ev.pack_id::text = p.pack_id or ev.order_id::text = p.pack_id)
      order by ev.date_closed desc nulls last limit 1
    ) as envio
    from p
    where coalesce(status_pedido, '') <> 'cancelled'
  )
  select
    (count(*) filter (where nao_lida_ml))::int,
    (count(*) filter (where nao_lida_ml and envio in ('pending', 'handling', 'ready_to_ship')))::int,
    (count(*) filter (where nao_lida_ml and envio = 'shipped'))::int,
    (count(*) filter (where nao_lida_ml and envio = 'delivered'))::int,
    (count(*) filter (where not nao_lida_ml and ult_dir = 'recebida' and not ult_lida))::int,
    (count(*) filter (where not nao_lida_ml and ult_dir = 'enviada'))::int
  from v;
$$;

grant execute on function public.resumo_mensagens_posvenda() to authenticated;
