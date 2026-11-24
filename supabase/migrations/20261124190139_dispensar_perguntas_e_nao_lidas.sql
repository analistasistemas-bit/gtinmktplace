-- Dispensar (emendas 24/11/2026 aos ADR-0067 e ADR-0037).
-- 1) Mensagens: "Dispensar" grava só `lida` (local). O contador de não lidas olhava só `lida_ml_em`
--    (leitura no ML), então a conversa dispensada sem ter sido aberta saía da lista e ficava no badge.
--    Não lida passa a exigir também `not lida`; mensagem nova entra com `lida = false` e volta a contar.
-- 2) Perguntas: ganham `dispensada_em`. O ML recusa resposta em anúncio pausado/finalizado
--    (`not_active_item`) e a pergunta ficava presa em Pendentes. O worker não envia a coluna no upsert,
--    então o sync não desfaz. `status` continua espelho do ML. Nada é escrito no ML.
-- Resto da RPC idêntico a 20261123231030. `create or replace` mantém os grants.

-- Não enfileira leituras/escritas atrás do ACCESS EXCLUSIVE se houver transação longa na tabela.
set local lock_timeout = '3s';

alter table public.ml_perguntas add column dispensada_em timestamptz;
comment on column public.ml_perguntas.dispensada_em is
  'Quando a org dispensou a pergunta (sai de Pendentes e do badge). Local, não é estado do ML. Escrita só por dispensar_perguntas.';

create or replace function public.dispensar_perguntas(p_question_ids bigint[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  if not public.can_write_current_org() then raise exception 'not allowed'; end if;
  update public.ml_perguntas set dispensada_em = now()
  where org_id = public.current_org_id() and question_id = any(p_question_ids)
    and status = 'UNANSWERED' and dispensada_em is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.dispensar_perguntas(bigint[]) from public, anon;
grant execute on function public.dispensar_perguntas(bigint[]) to authenticated;

create or replace function public.resumo_mensagens_posvenda()
returns table(nao_lidas_total integer, a_preparar integer, a_caminho integer, entregues integer, sem_responder integer, respondidas integer)
language sql
stable security definer
set search_path = public
as $$
  with p as (
    select pack_id,
      bool_or(direcao = 'recebida' and lida_ml_em is null and not lida) as nao_lida_ml,
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
    left join public.ml_conversas c on c.org_id = public.current_org_id() and c.pack_id = p.pack_id
    where not (coalesce(status_pedido, '') = 'cancelled' and c.status is distinct from 'active')
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
