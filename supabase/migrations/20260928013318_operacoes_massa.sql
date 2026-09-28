-- ADR-0174 — motor de operações em massa (primeira operação: aderir/sair de promoção DEAL/SMART).
create table public.operacoes_massa (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  acao          text not null check (acao in ('aderir','sair')),
  promocao_id   text not null,
  promocao_tipo text not null check (promocao_tipo in ('DEAL','SMART')),
  promocao_nome text,
  origem_id     uuid references public.operacoes_massa(id) on delete set null, -- Reverter
  status        text not null default 'executando' check (status in ('executando','concluida')),
  criado_por    uuid references auth.users(id) on delete set null,
  criado_em     timestamptz not null default now(),
  concluido_em  timestamptz
);
create index operacoes_massa_org_criado on public.operacoes_massa (org_id, criado_em desc);

create table public.operacoes_massa_itens (
  operacao_id       uuid not null references public.operacoes_massa(id) on delete cascade,
  org_id            uuid not null references public.organizations(id) on delete cascade,
  promocao_id       text not null,
  ml_item_id        text not null,
  titulo            text,
  preco             numeric,               -- DEAL: deal_price pedido; SMART: preço da oferta (informativo)
  semaforo          text check (semaforo in ('verde','amarelo','vermelho','indisponivel')),
  confirmado_risco  boolean not null default false,
  offer_id          text,                  -- SMART: OFFER-... devolvido pelo POST (usado pelo Reverter)
  status            text not null default 'pendente'
                    check (status in ('pendente','enviando','aplicado','ja_estava','mudou','bloqueado','erro','saida_solicitada')),
  mensagem          text,
  conferencias      integer not null default 0,
  proxima_conferencia timestamptz,
  atualizado_em     timestamptz not null default now(),
  primary key (operacao_id, ml_item_id)
);
create index operacoes_massa_itens_org on public.operacoes_massa_itens (org_id);
-- Anti-duplicidade: o mesmo anúncio não fica em andamento em duas operações da mesma promoção
-- (inclui saída pedida e ainda não confirmada — um aderir não pode correr junto do DELETE).
create unique index operacoes_massa_itens_andamento_unico
  on public.operacoes_massa_itens (org_id, promocao_id, ml_item_id)
  where status in ('pendente','enviando','saida_solicitada');

alter table public.operacoes_massa enable row level security;
alter table public.operacoes_massa_itens enable row level security;

-- Leitura para membros da org; escrita só pela edge (service role, que ignora RLS).
-- Forma `(select current_org_id())` igual a 20260924184220_central_promocoes.sql (avaliada 1x por query).
create policy operacoes_massa_select on public.operacoes_massa
  for select to authenticated using (org_id = (select public.current_org_id()));
create policy operacoes_massa_itens_select on public.operacoes_massa_itens
  for select to authenticated using (org_id = (select public.current_org_id()));

revoke all on public.operacoes_massa, public.operacoes_massa_itens from anon, authenticated;
grant select on public.operacoes_massa, public.operacoes_massa_itens to authenticated;
grant all on public.operacoes_massa, public.operacoes_massa_itens to service_role;
