-- ADR-0190 D-2/D-4: estado durável da notificação gerencial por carrinho. Uma linha por carrinho
-- (`chave` = pack_id, ou order_id sem pack). A espera de até 600 s é estado persistido + job QStash
-- agendado (notificar-carrinho), nunca uma edge parada. A PK torna o registro idempotente
-- (sync-venda chama a cada webhook de order paga); `status` sai de 'aguardando' uma única vez
-- (update condicional no worker) — é a garantia "no máximo uma mensagem por carrinho".
create table public.notificacao_carrinho (
  org_id        uuid not null references public.organizations(id) on delete cascade,
  chave         text not null,
  pack_id       bigint,
  order_id      bigint not null,
  esperadas     bigint[],            -- orders do pack (GET /packs/{id}); null = composição não confirmada
  primeiro_em   timestamptz not null default now(),
  status        text not null default 'aguardando' check (status in ('aguardando', 'enviado', 'descartado')),
  tentativas    int not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (org_id, chave)
);

create index notificacao_carrinho_status_primeiro_em on public.notificacao_carrinho (status, primeiro_em);

-- Estado interno de worker: só service role (bypassa RLS). RLS ligada e nenhuma policy.
alter table public.notificacao_carrinho enable row level security;
