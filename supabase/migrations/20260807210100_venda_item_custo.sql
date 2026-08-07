-- ADR-0109 — custo do produto congelado no instante da venda.
--
-- Por que tabela satélite e não uma coluna em ml_vendas_itens: `upsertVenda`
-- (_shared/faturamento/io.ts) APAGA e reinsere todos os itens a cada sync do pedido, e um pedido
-- sincroniza várias vezes (pago → enviado → entregue). Uma coluna ali seria destruída e regravada
-- a cada notificação, descongelando o custo. Esta tabela o DELETE dos itens não alcança.

create table public.venda_item_custo (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid references public.organizations(id),
  user_id        uuid not null references auth.users(id) on delete cascade,
  venda_id       uuid not null references public.ml_vendas(id) on delete cascade,
  ml_item_id     text,
  variation_id   bigint,
  -- SKU casado no momento do congelamento, só para auditoria: permite conferir depois com qual
  -- variação o item casou, sem depender do estado atual do catálogo.
  codigo         text,
  custo_unitario numeric not null check (custo_unitario > 0),
  congelado_em   timestamptz not null default now(),
  -- 'sync' = capturado no instante da venda; 'backfill' = reconstruído pelo lote vigente na data.
  -- O reconstruído é aproximação (não capta mudança de custo por recebimento entre lote e venda),
  -- e a coluna deixa isso explícito no dado em vez de na memória de quem fez.
  fonte          text not null check (fonte in ('sync', 'backfill')),

  -- nulls not distinct (PG15+): no Postgres NULL não colide com NULL num índice único, então sem
  -- isto um item sem variação (variation_id null — o caso comum) duplicaria à vontade. ml_item_id
  -- também é nullable em VendaItemRow. Mesmo padrão de ml_vendas_itens (20260627095025).
  -- NÃO usar índice de expressão (COALESCE): o ON CONFLICT do supabase-js/PostgREST só infere o
  -- arbiter por lista de colunas, e o insert-once falharia calado.
  constraint venda_item_custo_uniq unique nulls not distinct (venda_id, ml_item_id, variation_id)
);

create index venda_item_custo_venda_idx on public.venda_item_custo (venda_id);

alter table public.venda_item_custo enable row level security;

create policy "venda_item_custo: select org" on public.venda_item_custo
  for select to authenticated using (org_id = (select public.current_org_id()));
-- Sem policy de escrita: só service_role (que bypassa RLS), via upsertVenda e o backfill.

-- GRANT é obrigatório além da policy: privilégio de tabela e RLS são checagens independentes,
-- e sem ele a policy vira letra morta (mesmo padrão de estoque_movimentos).
grant select on public.venda_item_custo to authenticated;

-- Trava: congelado é congelado. Qualquer UPDATE que mude o custo FALHA — inclusive vindo do
-- service_role. Uma correção legítima existe, mas exige `alter table ... disable trigger`
-- explícito: possível, nunca acidental. Caminho financeiro não muda em silêncio.
create or replace function public.bloquear_update_custo_congelado()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.custo_unitario is distinct from old.custo_unitario then
    raise exception 'custo congelado da venda nao pode ser alterado (ADR-0109)';
  end if;
  return new;
end $$;

create trigger venda_item_custo_bloquear_update
  before update on public.venda_item_custo
  for each row execute procedure public.bloquear_update_custo_congelado();

comment on table public.venda_item_custo is
  'ADR-0109: custo unitario congelado no instante da venda. Insert-once (ON CONFLICT DO NOTHING) '
  '+ trigger que barra UPDATE. DELETE permitido para o cascade da venda.';
