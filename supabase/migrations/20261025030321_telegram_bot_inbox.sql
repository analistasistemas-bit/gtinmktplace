-- ADR-0190 D-8/D-9: comandos do bot com inbox durável.
-- O webhook do bot de cada org grava o update em `telegram_updates` (PK bot+update = dedup) e
-- publica um job QStash; o worker reivindica com lease (CAS por `lease_id`, molde de
-- worker_rodadas) e responde. Uma varredura republica linhas paradas.

-- 1) Bot ligado à org: id do bot (getMe), gravado só pelo servidor (registrar_webhook_telegram).
--    O secret do webhook depende de (org, bot_id); `unique` impede o mesmo bot em duas orgs.
alter table public.configuracoes add column telegram_bot_id bigint unique;

-- Há UPDATE concedido à tabela inteira para authenticated (20260725224000_support_access.sql:306),
-- então só o trigger protege a coluna (padrão de familias_proteger_fiscal). Trocar o token invalida
-- o webhook antigo (secret depende do bot_id): zera o bot_id e exige reativar os comandos.
create or replace function public.configuracoes_proteger_bot_id()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if ((tg_op = 'INSERT' and new.telegram_bot_id is not null)
      or (tg_op = 'UPDATE' and new.telegram_bot_id is distinct from old.telegram_bot_id))
     and (coalesce(auth.role(), 'service_role') <> 'service_role' or current_user in ('authenticated', 'anon')) then
    raise exception 'telegram_bot_id só é gravado pelo servidor' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.telegram_bot_token is distinct from old.telegram_bot_token then
    new.telegram_bot_id := null;
  end if;
  return new;
end $$;
revoke all on function public.configuracoes_proteger_bot_id() from public, anon, authenticated;

create trigger configuracoes_proteger_bot_id
  before insert or update on public.configuracoes
  for each row execute function public.configuracoes_proteger_bot_id();

-- 2) Inbox durável dos updates do Telegram.
create table public.telegram_updates (
  bot_id        bigint not null,
  update_id     bigint not null,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  payload       jsonb not null,
  status        text not null default 'recebido' check (status in ('recebido', 'processando', 'respondido', 'falhou')),
  tentativas    int not null default 0,
  lease_ate     timestamptz,
  lease_id      uuid,
  publicado_em  timestamptz,
  recebido_em   timestamptz not null default now(),
  processado_em timestamptz,
  erro          text,
  primary key (bot_id, update_id)
);

create index telegram_updates_status_recebido_em on public.telegram_updates (status, recebido_em);

-- Estado interno de worker: só service role (bypassa RLS). RLS ligada e nenhuma policy.
alter table public.telegram_updates enable row level security;

-- 3) Lease (CAS por lease_id). `p_agora` vem do worker (relógio da execução) e deixa o teste
--    simular o vencimento sem dormir. 0 linhas = outra execução tem a posse.
create function public.telegram_update_reivindicar(p_bot bigint, p_update bigint, p_agora timestamptz)
returns setof public.telegram_updates
language sql security definer set search_path = '' as $$
  update public.telegram_updates
     set status = 'processando', lease_id = gen_random_uuid(), lease_ate = p_agora + interval '60 seconds',
         tentativas = tentativas + 1
   where bot_id = p_bot and update_id = p_update
     and (status = 'recebido' or (status = 'processando' and lease_ate < p_agora))
  returning *;
$$;

-- Chamado imediatamente antes do envio: renova e prova que a posse ainda é desta execução.
create function public.telegram_update_confirmar_posse(p_bot bigint, p_update bigint, p_lease uuid, p_agora timestamptz)
returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.telegram_updates set lease_ate = p_agora + interval '60 seconds'
     where bot_id = p_bot and update_id = p_update and lease_id = p_lease
       and status = 'processando' and lease_ate >= p_agora
    returning 1)
  select exists (select 1 from u);
$$;

create function public.telegram_update_concluir(p_bot bigint, p_update bigint, p_lease uuid, p_status text, p_erro text)
returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.telegram_updates
       set status = p_status, erro = p_erro, processado_em = now(), lease_id = null, lease_ate = null
     where bot_id = p_bot and update_id = p_update and lease_id = p_lease and status = 'processando'
       and p_status in ('respondido', 'falhou')
    returning 1)
  select exists (select 1 from u);
$$;

-- Devolve para nova tentativa; com 5 tentativas vira `falhou` (encerra).
create function public.telegram_update_devolver(p_bot bigint, p_update bigint, p_lease uuid, p_erro text)
returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.telegram_updates
       set status = case when tentativas >= 5 then 'falhou' else 'recebido' end,
           processado_em = case when tentativas >= 5 then now() end,
           erro = p_erro, lease_id = null, lease_ate = null
     where bot_id = p_bot and update_id = p_update and lease_id = p_lease and status = 'processando'
    returning 1)
  select exists (select 1 from u);
$$;

-- Varredura: `recebido` sem publicação há > 90 s, ou `processando` com lease vencido.
-- Cursor (bot_id, update_id); só seleciona — quem chama republica.
create function public.telegram_updates_parados(p_agora timestamptz, p_depois_bot bigint, p_depois_update bigint, p_limite int)
returns table (bot_id bigint, update_id bigint, tentativas int)
language sql stable security definer set search_path = '' as $$
  select t.bot_id, t.update_id, t.tentativas
    from public.telegram_updates t
   where ((t.status = 'recebido' and coalesce(t.publicado_em, t.recebido_em) < p_agora - interval '90 seconds')
          or (t.status = 'processando' and t.lease_ate < p_agora))
     and (p_depois_bot is null or (t.bot_id, t.update_id) > (p_depois_bot, p_depois_update))
   order by t.bot_id, t.update_id
   limit p_limite;
$$;

revoke all on function public.telegram_update_reivindicar(bigint, bigint, timestamptz)           from public, anon, authenticated;
revoke all on function public.telegram_update_confirmar_posse(bigint, bigint, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.telegram_update_concluir(bigint, bigint, uuid, text, text)        from public, anon, authenticated;
revoke all on function public.telegram_update_devolver(bigint, bigint, uuid, text)              from public, anon, authenticated;
revoke all on function public.telegram_updates_parados(timestamptz, bigint, bigint, int)        from public, anon, authenticated;
grant execute on function public.telegram_update_reivindicar(bigint, bigint, timestamptz)           to service_role;
grant execute on function public.telegram_update_confirmar_posse(bigint, bigint, uuid, timestamptz) to service_role;
grant execute on function public.telegram_update_concluir(bigint, bigint, uuid, text, text)        to service_role;
grant execute on function public.telegram_update_devolver(bigint, bigint, uuid, text)              to service_role;
grant execute on function public.telegram_updates_parados(timestamptz, bigint, bigint, int)        to service_role;
