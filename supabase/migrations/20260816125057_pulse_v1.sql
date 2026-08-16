-- Pulse v1 (ADR-0119): radar dirigido de mercado.
-- 4 tabelas Grupo B (select org via RLS; escrita só service_role, org_id explícito).

create table public.pulse_produtos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  catalog_product_id text not null,
  codigo_pai text,                        -- anúncio nosso que originou (null quando manual)
  titulo text,
  origem text not null default 'auto' check (origem in ('auto','manual')),
  status text not null default 'ativo' check (status in ('ativo','pausado','arquivado')),
  ptw_status text,                        -- price-to-win do NOSSO item (suggestions API)
  ptw_preco_sugerido numeric(12,2),
  ptw_custos jsonb,                       -- {"comissao": 3.78, "frete": 6.65}
  ptw_atualizado_em timestamptz,
  ultimo_snapshot_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index pulse_produtos_org_cpid_uniq on public.pulse_produtos (org_id, catalog_product_id);
create index pulse_produtos_org_status_idx on public.pulse_produtos (org_id, status, ultimo_snapshot_em asc);

create table public.pulse_ofertas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  produto_id uuid not null references public.pulse_produtos(id) on delete cascade,
  item_id text not null,
  seller_id bigint not null,
  preco numeric(12,2) not null,
  tier text,
  frete_gratis boolean not null default false,
  loja_oficial boolean not null default false,
  ativo boolean not null default true,    -- false = oferta sumiu do catálogo neste dia
  dia date not null default (now() at time zone 'America/Sao_Paulo')::date,
  criado_em timestamptz not null default now()
);
create unique index pulse_ofertas_prod_item_dia_uniq on public.pulse_ofertas (produto_id, item_id, dia);
create index pulse_ofertas_org_prod_dia_idx on public.pulse_ofertas (org_id, produto_id, dia desc);

create table public.pulse_vendedores (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  seller_id bigint not null,
  nickname text,
  power_seller text,
  nivel text,
  transactions_total bigint,
  dia date not null default (now() at time zone 'America/Sao_Paulo')::date,
  criado_em timestamptz not null default now()
);
create unique index pulse_vendedores_org_seller_dia_uniq on public.pulse_vendedores (org_id, seller_id, dia);
create index pulse_vendedores_org_seller_idx on public.pulse_vendedores (org_id, seller_id, dia desc);

create table public.pulse_alertas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  produto_id uuid references public.pulse_produtos(id) on delete cascade,
  tipo text not null check (tipo in ('preco_caiu','novo_concorrente','concorrente_saiu')),
  payload jsonb not null default '{}',
  lido boolean not null default false,
  criado_em timestamptz not null default now()
);
create index pulse_alertas_org_lido_idx on public.pulse_alertas (org_id, lido, criado_em desc);

-- RLS (Grupo B) + grants — privilégio e policy são checagens independentes.
alter table public.pulse_produtos  enable row level security;
alter table public.pulse_ofertas   enable row level security;
alter table public.pulse_vendedores enable row level security;
alter table public.pulse_alertas   enable row level security;

create policy "pulse_produtos: select org"  on public.pulse_produtos  for select to authenticated using (org_id = (select public.current_org_id()));
create policy "pulse_ofertas: select org"   on public.pulse_ofertas   for select to authenticated using (org_id = (select public.current_org_id()));
create policy "pulse_vendedores: select org" on public.pulse_vendedores for select to authenticated using (org_id = (select public.current_org_id()));
create policy "pulse_alertas: select org"   on public.pulse_alertas   for select to authenticated using (org_id = (select public.current_org_id()));
grant select on public.pulse_produtos, public.pulse_ofertas, public.pulse_vendedores, public.pulse_alertas to authenticated;

-- Marcar alerta como lido e pausar/reativar produto direto do app (únicos updates do membro).
create policy "pulse_alertas: update org" on public.pulse_alertas for update to authenticated
  using (org_id = (select public.current_org_id())) with check (org_id = (select public.current_org_id()));
grant update (lido) on public.pulse_alertas to authenticated;
create policy "pulse_produtos: update org" on public.pulse_produtos for update to authenticated
  using (org_id = (select public.current_org_id())) with check (org_id = (select public.current_org_id()));
grant update (status) on public.pulse_produtos to authenticated;

create trigger pulse_produtos_set_updated_at before update on public.pulse_produtos
  for each row execute procedure extensions.moddatetime (atualizado_em);

-- Categoria de notificação 'pulse' (sincronia manual com os dois categorias.ts — Tasks 3 e 6).
alter table public.notificacoes drop constraint notificacoes_categoria_check;
alter table public.notificacoes add constraint notificacoes_categoria_check
  check (categoria in ('vendas','perguntas','pos_venda','financeiro','moderacao','mensagens','integracao','pulse'));

-- Backfill 1: chave de menu 'pulse' para não-admins existentes (precedente: menus_multicanal/canais).
update public.profiles set allowed_menus = array_append(allowed_menus, 'pulse')
  where 'configuracoes' = any(allowed_menus) and not ('pulse' = any(allowed_menus));

-- `profiles.telegram_categorias` tem CHECK de contenção (profiles_telegram_categorias_validas):
-- sem liberar 'pulse' aqui, o backfill 2 abaixo violaria o constraint e abortaria a migration.
-- Precedente: 20260712171337_integracao_categoria_notificacao.sql.
alter table public.profiles
  drop constraint if exists profiles_telegram_categorias_validas;
alter table public.profiles
  add constraint profiles_telegram_categorias_validas
  check (telegram_categorias <@ array['vendas','perguntas','pos_venda','financeiro','moderacao','mensagens','integracao','pulse']::text[]);

-- Backfill 2: admins ativos assinam a categoria (lerAssinantes exige; sem assinante o alerta não grava).
update public.profiles set telegram_categorias = array_append(telegram_categorias, 'pulse')
  where is_admin and is_active and not ('pulse' = any(coalesce(telegram_categorias, '{}')));
