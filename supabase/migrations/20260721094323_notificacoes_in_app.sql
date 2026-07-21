-- Notificação in-app (ADR-0085) — espelha os alertas que hoje só vão por Telegram
-- (notificarCategoria). Escrita só do worker (service role bypassa RLS); mesmo padrão de
-- ml_mensagens (ADR-0067): read-only para o app via RLS por user_id.
create table public.notificacoes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  org_id     uuid not null,
  categoria  text not null check (categoria in ('vendas','perguntas','pos_venda','financeiro','moderacao','mensagens','integracao')),
  texto      text not null,
  lida       boolean not null default false,
  criada_em  timestamptz not null default now()
);

-- Badge de não-lidas (contagem) e listagem cronológica (dropdown do sino).
create index notificacoes_user_lida_idx on public.notificacoes (user_id, lida) where lida = false;
create index notificacoes_user_criada_idx on public.notificacoes (user_id, criada_em desc);

alter table public.notificacoes enable row level security;

-- Grants explícitos (não dependemos das default privileges ambientes do db push): o app lê como
-- `authenticated`, filtrado por RLS. Escrita real é só do worker (service role bypassa RLS).
grant select on public.notificacoes to authenticated;
grant all on public.notificacoes to anon, authenticated;

create policy "notificacoes: select own" on public.notificacoes
  for select using ((select auth.uid()) = user_id);

-- Marcar como lidas: todas (p_ids null) ou um subconjunto. Estreita: toca só `lida`, só nas
-- linhas do próprio usuário. Escrita geral continua bloqueada (sem policy de update aberta).
create or replace function public.marcar_notificacoes_lidas(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.notificacoes
     set lida = true
   where user_id = auth.uid()
     and lida = false
     and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.marcar_notificacoes_lidas(uuid[]) from public;
grant execute on function public.marcar_notificacoes_lidas(uuid[]) to authenticated;
