-- Módulo Faturamento — Fase 1: vendas persistidas (ADR-0037).
-- Pedidos do ML (1 linha/pedido) + itens, alimentados por webhook/backfill/reconciliação.
-- Frontend lê daqui (rápido, resiliente à API do ML). Escrita só por worker (service role).

-- 1 linha por pedido do ML.
create table public.ml_vendas (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  order_id           bigint not null,
  pack_id            bigint,
  status             text not null,
  status_detail      text,
  date_created       timestamptz,
  date_closed        timestamptz,
  comprador_id       bigint,
  comprador_nick     text,
  total_amount       numeric not null default 0,
  paid_amount        numeric,
  sale_fee_total     numeric not null default 0,
  frete_vendedor     numeric,
  liquido            numeric,
  currency           text not null default 'BRL',
  shipping_id        bigint,
  shipping_status    text,
  shipping_substatus text,
  tracking_number    text,
  is_publiai         boolean not null default false,
  tem_devolucao      boolean not null default false,
  raw                jsonb,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);

create unique index ml_vendas_order_uniq on public.ml_vendas (user_id, order_id);
create index ml_vendas_user_data_idx on public.ml_vendas (user_id, date_closed desc);

-- Itens de cada pedido.
create table public.ml_vendas_itens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  venda_id     uuid not null references public.ml_vendas(id) on delete cascade,
  ml_item_id   text,
  variation_id bigint,
  titulo       text,
  codigo       text,
  quantity     int not null default 0,
  unit_price   numeric not null default 0,
  sale_fee     numeric not null default 0,
  is_publiai   boolean not null default false
);

create index ml_vendas_itens_venda_idx on public.ml_vendas_itens (venda_id);

-- Log/idempotência dos webhooks recebidos (dedup por topic+resource).
create table public.ml_webhook_eventos (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade,
  topic        text not null,
  resource     text not null,
  recebido_em  timestamptz not null default now(),
  processado_em timestamptz,
  erro         text
);

-- Dedup: 1 evento por (topic, resource) — upsert no insert evita reprocessar duplicata.
create unique index ml_webhook_eventos_uniq on public.ml_webhook_eventos (topic, resource);
create index ml_webhook_eventos_user_idx on public.ml_webhook_eventos (user_id);

-- RLS: operador lê o próprio; escrita é só do worker (service role, ignora RLS).
alter table public.ml_vendas enable row level security;
alter table public.ml_vendas_itens enable row level security;
alter table public.ml_webhook_eventos enable row level security;

create policy "ml_vendas: select own" on public.ml_vendas
  for select using ((select auth.uid()) = user_id);
create policy "ml_vendas_itens: select own" on public.ml_vendas_itens
  for select using ((select auth.uid()) = user_id);
create policy "ml_webhook_eventos: select own" on public.ml_webhook_eventos
  for select using ((select auth.uid()) = user_id);
