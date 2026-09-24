-- ADR-0169 — Monitor de frete: liga/desliga por organização (nasce desligado).
alter table public.configuracoes
  add column if not exists monitor_frete_ativo boolean not null default false;

-- A tabela tem SELECT concedido coluna a coluna desde 20260822131053 (token do Telegram fora).
-- Coluna nova sem este grant fica invisível ao front (PostgREST devolve 401/erro de permissão).
grant select (monitor_frete_ativo) on public.configuracoes to authenticated;

-- Busca da venda anterior por item (antes só havia índice por venda_id).
create index if not exists ml_vendas_itens_org_item_idx
  on public.ml_vendas_itens (org_id, ml_item_id);

-- Venda de referência do monitor: a mais recente ANTES da atual (por data e, no empate, order_id),
-- mesmo item+variação, pedido de 1 linha e 1 unidade, fora de pack (em pack o frete é do envio e se
-- repete em cada pedido — ADR-0042), não cancelada, com frete > 0. Elegibilidade ANTES do limit.
-- Reusada pela medição do plano: código e medição aplicam a mesma regra.
create or replace function public.frete_venda_anterior(
  p_org_id uuid, p_ml_item_id text, p_variation_id bigint, p_antes timestamptz, p_order_id bigint
) returns table (order_id bigint, frete_vendedor numeric)
language sql stable security invoker set search_path = public as $$
  select v.order_id, v.frete_vendedor
  from ml_vendas v
  join ml_vendas_itens i on i.venda_id = v.id
  where v.org_id = p_org_id
    and i.org_id = p_org_id
    and i.ml_item_id = p_ml_item_id
    and i.variation_id is not distinct from p_variation_id
    and i.quantity = 1
    and v.pack_id is null
    and v.status <> 'cancelled'
    and v.frete_vendedor > 0
    and (coalesce(v.date_closed, v.date_created), v.order_id) < (p_antes, p_order_id)
    and not exists (select 1 from ml_vendas_itens x where x.venda_id = v.id and x.id <> i.id)
  order by coalesce(v.date_closed, v.date_created) desc, v.order_id desc
  limit 1
$$;

-- Função em public nasce com EXECUTE para PUBLIC: só o worker (service_role) chama.
revoke execute on function public.frete_venda_anterior(uuid, text, bigint, timestamptz, bigint) from public, anon, authenticated;
grant execute on function public.frete_venda_anterior(uuid, text, bigint, timestamptz, bigint) to service_role;
