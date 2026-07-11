-- Módulo Faturamento — mensagens pós-venda do comprador (ADR-0067).
-- Espelha ml_perguntas: read-only para o app, escrita só do worker (service role).
create table public.ml_mensagens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  org_id        uuid,
  pack_id       text not null,
  order_id      text,
  message_id    text not null,
  direcao       text not null check (direcao in ('recebida', 'enviada')),
  texto         text not null default '',
  item_titulo   text,
  data_ml       timestamptz,
  lida          boolean not null default false,
  raw           jsonb,
  atualizado_em timestamptz not null default now()
);

-- Idempotência: 1 linha por mensagem do ML.
create unique index ml_mensagens_uniq on public.ml_mensagens (user_id, message_id);
-- Listagem por conversa (pack) e ordenação temporal.
create index ml_mensagens_user_pack_idx on public.ml_mensagens (user_id, pack_id, data_ml);
-- Badge de não-lidas.
create index ml_mensagens_user_lida_idx on public.ml_mensagens (user_id, lida) where direcao = 'recebida';

alter table public.ml_mensagens enable row level security;

-- Leitura própria; escrita só do worker (service role bypassa RLS).
create policy "ml_mensagens: select own" on public.ml_mensagens
  for select using ((select auth.uid()) = user_id);

-- Marcar como lidas as mensagens recebidas de um pack (badge). Estreita: toca só `lida`,
-- só nas linhas do próprio usuário. Escrita geral continua bloqueada (sem policy de update aberta).
create or replace function public.marcar_mensagens_lidas(p_pack_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.ml_mensagens
     set lida = true, atualizado_em = now()
   where user_id = auth.uid()
     and pack_id = p_pack_id
     and direcao = 'recebida'
     and lida = false;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.marcar_mensagens_lidas(text) from public;
grant execute on function public.marcar_mensagens_lidas(text) to authenticated;
