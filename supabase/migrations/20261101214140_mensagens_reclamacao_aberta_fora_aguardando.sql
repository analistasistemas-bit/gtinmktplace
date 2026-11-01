-- Emenda ADR-0067 (01/11/2026): conversa cujo pedido tem reclamação (mediations) aberta não é
-- respondível — o ML devolve 403 blocked_by_claim e a conversa segue pela reclamação. Sai de
-- "aguardando" (badge do avatar) e de "Sem responder" (cards do Pós-venda). Pack casa pelo
-- order_id de qualquer mensagem do pack ou pelo próprio pack_id (pedido solo). Mesma regra de
-- `preencherReclamacao` em src/lib/mensagens.ts. `create or replace` mantém os grants.

create or replace function public.contar_conversas_aguardando()
returns integer
language sql
security definer
set search_path = public
as $$
  with ultimas as (
    select distinct on (pack_id) pack_id, direcao, order_status, lida
    from public.ml_mensagens
    where org_id = public.current_org_id()
    order by pack_id, data_ml desc nulls last, message_id desc
  ), em_reclamacao as (
    select distinct m.pack_id
    from public.ml_mensagens m
    join public.ml_devolucoes d
      on d.org_id = m.org_id
     and (d.order_id::text = m.order_id or d.order_id::text = m.pack_id)
    where m.org_id = public.current_org_id()
      and d.status = 'opened' and d.type = 'mediations'
  )
  select count(*)::int
  from ultimas u
  where u.direcao = 'recebida'
    and coalesce(u.order_status, '') <> 'cancelled'
    and not u.lida
    and u.pack_id not in (select pack_id from em_reclamacao);
$$;

create or replace function public.resumo_mensagens_posvenda()
returns table(nao_lidas_total integer, a_preparar integer, a_caminho integer, entregues integer, sem_responder integer, respondidas integer)
language sql
stable security definer
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
  ), em_reclamacao as (
    select distinct m.pack_id
    from public.ml_mensagens m
    join public.ml_devolucoes d
      on d.org_id = m.org_id
     and (d.order_id::text = m.order_id or d.order_id::text = m.pack_id)
    where m.org_id = public.current_org_id()
      and d.status = 'opened' and d.type = 'mediations'
  ), v as (
    select p.*, (
      select ev.shipping_status from public.ml_vendas ev
      where ev.org_id = public.current_org_id()
        and (ev.pack_id::text = p.pack_id or ev.order_id::text = p.pack_id)
      order by ev.date_closed desc nulls last limit 1
    ) as envio,
    p.pack_id in (select pack_id from em_reclamacao) as reclamacao
    from p
    where coalesce(status_pedido, '') <> 'cancelled'
  )
  select
    (count(*) filter (where nao_lida_ml))::int,
    (count(*) filter (where nao_lida_ml and envio in ('pending', 'handling', 'ready_to_ship')))::int,
    (count(*) filter (where nao_lida_ml and envio = 'shipped'))::int,
    (count(*) filter (where nao_lida_ml and envio = 'delivered'))::int,
    (count(*) filter (where not nao_lida_ml and ult_dir = 'recebida' and not ult_lida and not reclamacao))::int,
    (count(*) filter (where not nao_lida_ml and ult_dir = 'enviada'))::int
  from v;
$$;
