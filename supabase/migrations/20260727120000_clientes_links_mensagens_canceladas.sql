alter table public.ml_perguntas
  add column if not exists comprador_nick text;

alter table public.ml_mensagens
  add column if not exists item_id text,
  add column if not exists comprador_nome text,
  add column if not exists comprador_nick text,
  add column if not exists order_status text;

update public.ml_perguntas
set comprador_nick = nullif(raw #>> '{from,nickname}', '')
where comprador_nick is null;

with meta as (
  select distinct on (m.id)
    m.id,
    i.ml_item_id::text as item_id,
    v.comprador_nome,
    v.comprador_nick,
    v.status as order_status
  from public.ml_mensagens m
  join public.ml_vendas v
    on v.user_id = m.user_id
   and (
     v.order_id::text = m.order_id
     or v.pack_id::text = m.pack_id
     or (v.pack_id is null and v.order_id::text = m.pack_id)
   )
  left join lateral (
    select vi.ml_item_id
    from public.ml_vendas_itens vi
    where vi.venda_id = v.id
    order by vi.id
    limit 1
  ) i on true
  order by m.id, v.date_created desc nulls last
)
update public.ml_mensagens m
set item_id = coalesce(m.item_id, meta.item_id),
    comprador_nome = coalesce(m.comprador_nome, meta.comprador_nome),
    comprador_nick = coalesce(m.comprador_nick, meta.comprador_nick),
    order_status = coalesce(meta.order_status, m.order_status)
from meta
where m.id = meta.id;

create or replace function public.contar_conversas_aguardando()
returns integer
language sql
security definer
set search_path = public
as $$
  with ultimas as (
    select distinct on (pack_id) direcao, order_status
    from public.ml_mensagens
    where user_id = auth.uid()
    order by pack_id, data_ml desc nulls last, message_id desc
  )
  select count(*)::int
  from ultimas
  where direcao = 'recebida'
    and coalesce(order_status, '') <> 'cancelled';
$$;
