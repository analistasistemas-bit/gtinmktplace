-- Idempotência dos itens de venda: impede linhas duplicadas quando dois syncs do mesmo
-- pedido rodam concorrentes (webhook orders_v2 + shipments, ou webhook + reconciliar). Ver plans/012.

-- Dedup defensivo (no-op quando já não há duplicatas) antes de criar o índice único.
delete from public.ml_vendas_itens a
using public.ml_vendas_itens b
where a.ctid < b.ctid
  and a.venda_id = b.venda_id
  and coalesce(a.ml_item_id, '') = coalesce(b.ml_item_id, '')
  and coalesce(a.variation_id, 0) = coalesce(b.variation_id, 0);

-- nulls not distinct (PG15+): trata variation_id null como igual, para um item sem variação
-- não duplicar. ml_item_id é sempre preenchido no dado atual (verificado).
create unique index if not exists ml_vendas_itens_uniq
  on public.ml_vendas_itens (venda_id, ml_item_id, variation_id) nulls not distinct;
