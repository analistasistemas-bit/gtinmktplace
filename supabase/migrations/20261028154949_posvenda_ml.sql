-- ADR-0192: ações de pós-venda no ML (devolução/revisão, mensagens com leitura no ML).
-- Idempotente. Escrita nas tabelas novas só pelo service_role (edges).

-- 1) ml_devolucoes: detalhe lido do ML + estado para a UI e para o enriquecimento.
alter table public.ml_devolucoes
  add column if not exists return_id          bigint,
  add column if not exists detalhe            jsonb,        -- {title, description, problem, due_date, action_responsible}
  add column if not exists prazo              timestamptz,
  add column if not exists vez_de             text,
  add column if not exists revisao_pendente   boolean not null default false,
  add column if not exists revisao_status     text,         -- último seller_status lido
  add column if not exists afeta_reputacao    text,
  add column if not exists rastreio           text,
  add column if not exists pedidos_devolucao  jsonb,        -- order_ids da devolução (carrinho)
  add column if not exists enriquecido_em     timestamptz,  -- null = falta enriquecer
  add column if not exists lido_em            timestamptz;  -- versão do snapshot

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ml_devolucoes_vez_de_check') then
    alter table public.ml_devolucoes add constraint ml_devolucoes_vez_de_check
      check (vez_de is null or vez_de in ('vendedor','comprador','ml'));
  end if;
end $$;

-- 2) Auditoria/trava das escritas no ML.
create table if not exists public.ml_posvenda_acoes (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  user_id       uuid not null,  -- quem clicou; sem FK de propósito: excluir usuário não pode apagar tentativa em aberto (soltaria a trava)
  operacao_id   uuid not null,
  claim_id      bigint not null,
  return_id     bigint,
  recurso       text not null,
  acao          text not null,
  payload       jsonb not null,
  payload_hash  text not null,
  antes         jsonb,                 -- snapshot relido antes do POST
  estado        text not null check (estado in
                  ('reservada','enviada','confirmada','recusada','desconhecido','inconclusiva','cancelada')),
  post_em       timestamptz,           -- gravado ANTES do fetch
  http_status   int,                   -- null se não houve resposta
  resposta_ml   jsonb,
  sync_pendente boolean not null default false,
  erro          text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists ml_posvenda_acoes_operacao_uniq
  on public.ml_posvenda_acoes (org_id, operacao_id);
-- Trava: no máximo uma tentativa em aberto por recurso.
create unique index if not exists ml_posvenda_acoes_trava_uniq
  on public.ml_posvenda_acoes (org_id, recurso) where estado in ('reservada','enviada','desconhecido');
create index if not exists ml_posvenda_acoes_claim_idx
  on public.ml_posvenda_acoes (org_id, claim_id, criado_em desc);

alter table public.ml_posvenda_acoes enable row level security;
drop policy if exists "ml_posvenda_acoes: select org" on public.ml_posvenda_acoes;
create policy "ml_posvenda_acoes: select org" on public.ml_posvenda_acoes
  for select to authenticated using (org_id = (select public.current_org_id()));
-- Default privileges do Supabase dão ALL (inclui TRUNCATE, que RLS não cobre). Precedente: 20260924184220_central_promocoes.sql.
revoke all on public.ml_posvenda_acoes from anon, authenticated;
grant select on public.ml_posvenda_acoes to authenticated;

-- 3) Recibo de leitura no ML (monotônico: só sai de null; escrito via coalesce, nunca pelo upsert de raw).
alter table public.ml_mensagens add column if not exists lida_ml_em timestamptz;

update public.ml_mensagens
   set lida_ml_em = (raw->'message_date'->>'read')::timestamptz
 where lida_ml_em is null and raw->'message_date'->>'read' is not null;
