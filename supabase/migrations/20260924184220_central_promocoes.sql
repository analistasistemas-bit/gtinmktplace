-- ADR-0170 — Central de Promoções do ML (só leitura). Escrita só pelo worker (service_role).

create table public.ml_promocoes (
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  promocao_id            text not null,
  tipo                   text not null,
  nome                   text,
  status                 text not null,
  inicio                 timestamptz,
  fim                    timestamptz,
  prazo_adesao           timestamptz,
  beneficios             jsonb,
  bruto                  jsonb not null default '{}',
  contagem               jsonb,
  erro                   text,
  sincronizado_em        timestamptz not null default now(),
  itens_sincronizados_em timestamptz,
  rodada_em_curso        timestamptz,   -- reserva da leitura (30 min); null = nenhuma leitura em curso
  primary key (org_id, promocao_id)
);

create table public.ml_promocao_itens (
  org_id          uuid not null,
  promocao_id     text not null,
  ml_item_id      text not null,
  status          text not null,
  preco_original  numeric,
  preco_promo     numeric,
  preco_min       numeric,
  preco_max       numeric,
  preco_sugerido  numeric,
  preco_avaliado  numeric,
  ml_pct          numeric,
  vendedor_pct    numeric,
  estoque_min     integer,
  estoque_max     integer,
  titulo          text,
  thumbnail       text,
  permalink       text,
  listing_type_id text,
  projecao        jsonb not null default '[]',
  pior_semaforo   text not null check (pior_semaforo in ('verde','amarelo','vermelho','indisponivel')),
  sincronizado_em timestamptz not null default now(),
  primary key (org_id, promocao_id, ml_item_id),
  foreign key (org_id, promocao_id) references public.ml_promocoes(org_id, promocao_id) on delete cascade
);
create index ml_promocao_itens_semaforo_idx on public.ml_promocao_itens (org_id, promocao_id, pior_semaforo);

create table public.ml_promocoes_sync (
  org_id          uuid primary key references public.organizations(id) on delete cascade,
  estado          text not null check (estado in ('sincronizando','ok','sem_acesso','sem_promocoes','erro')),
  iniciado_em     timestamptz,
  ultimo_ok_em    timestamptz,
  ultimo_erro_em  timestamptz,
  erro            text
);

-- RLS: membro lê a própria org; insert/update/delete ficam só com service_role (sem grant).
alter table public.ml_promocoes      enable row level security;
alter table public.ml_promocao_itens enable row level security;
alter table public.ml_promocoes_sync enable row level security;
create policy "ml_promocoes: select org"      on public.ml_promocoes      for select to authenticated using (org_id = (select public.current_org_id()));
create policy "ml_promocao_itens: select org" on public.ml_promocao_itens for select to authenticated using (org_id = (select public.current_org_id()));
create policy "ml_promocoes_sync: select org" on public.ml_promocoes_sync for select to authenticated using (org_id = (select public.current_org_id()));
grant select on public.ml_promocoes, public.ml_promocao_itens, public.ml_promocoes_sync to authenticated;

-- Switch dos alertas (nasce desligado). SELECT de configuracoes é por coluna desde 20260822131053.
alter table public.configuracoes
  add column if not exists alertas_promocoes_ativo boolean not null default false;
grant select (alertas_promocoes_ativo) on public.configuracoes to authenticated;

-- Menu novo para não-admins que já administram a org (precedente: 20260816125057_pulse_v1.sql).
-- O menu só aparece com o módulo ligado; sem esta linha o operador existente não o veria nem com o módulo.
update public.profiles set allowed_menus = array_append(allowed_menus, 'promocoes')
  where 'configuracoes' = any(allowed_menus) and not ('promocoes' = any(allowed_menus));
