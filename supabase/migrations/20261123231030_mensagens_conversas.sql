-- Emenda ADR-0067 (23/11/2026): pedido cancelado não encerra a conversa; quem encerra é o ML.
-- Medido na API do ML: parte das conversas de pedido cancelado segue `conversation_status.status =
-- 'active'` (o comprador escreve e o vendedor pode responder). O estado é do PACK, não da mensagem:
-- fica em `ml_conversas`, uma linha por (org, pack), gravada só por `registrar_estado_conversa`, que
-- nunca deixa uma observação mais antiga sobrescrever uma mais nova (sync atrasado não desfaz um
-- bloqueio confirmado). Conversa ENCERRADA ⇔ order_status da mensagem mais recente = 'cancelled' E
-- ml_conversas.status distinto de 'active' (sem linha = ainda não observado, mantém o comportamento
-- anterior). Resto das RPCs idêntico a 20261101214140. `create or replace` mantém os grants.

create table public.ml_conversas (
  org_id       uuid not null references public.organizations(id) on delete cascade,
  pack_id      text not null,
  status       text not null,
  observado_em timestamptz not null,
  primary key (org_id, pack_id)
);

comment on table public.ml_conversas is
  'Estado da conversa pós-venda por pack, como o ML informa em conversation_status (emenda ADR-0067, 23/11/2026). Escrita só por registrar_estado_conversa (service role).';
comment on column public.ml_conversas.status is
  'conversation_status.status do ML (active/blocked). Com pedido cancelado, só active mantém a conversa aberta.';
comment on column public.ml_conversas.observado_em is
  'Instante em que COMEÇOU a requisição ao ML que observou o estado. Guarda temporal: observação mais antiga não sobrescreve.';

alter table public.ml_conversas enable row level security;

-- Grants explícitos: as default privileges dão TRUNCATE, que RLS não cobre. Leitura do app como
-- `authenticated`, filtrada por org; escrita só do service role (sem policy de escrita).
revoke all on public.ml_conversas from anon, authenticated;
grant select on public.ml_conversas to authenticated;

create policy "ml_conversas: select org" on public.ml_conversas
  for select to authenticated using (org_id = (select public.current_org_id()));

create or replace function public.registrar_estado_conversa(
  p_org_id uuid, p_pack_id text, p_status text, p_observado_em timestamptz
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.ml_conversas (org_id, pack_id, status, observado_em)
  values (p_org_id, p_pack_id, p_status, p_observado_em)
  on conflict (org_id, pack_id) do update
    set status = excluded.status, observado_em = excluded.observado_em
    where ml_conversas.observado_em < excluded.observado_em;
$$;

revoke all on function public.registrar_estado_conversa(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.registrar_estado_conversa(uuid, text, text, timestamptz) to service_role;

create or replace function public.contar_conversas_aguardando()
returns integer
language sql
security definer
set search_path = public
as $$
  with ultimas as (
    select distinct on (pack_id) pack_id, direcao, order_status, lida
    from public.ml_mensagens
    where org_id = public.current_org_id()
    order by pack_id, data_ml desc nulls last, message_id desc
  ), em_reclamacao as (
    select distinct m.pack_id
    from public.ml_mensagens m
    join public.ml_devolucoes d
      on d.org_id = m.org_id
     and (d.order_id::text = m.order_id or d.order_id::text = m.pack_id)
    where m.org_id = public.current_org_id()
      and d.status = 'opened' and d.type = 'mediations'
  )
  select count(*)::int
  from ultimas u
  left join public.ml_conversas c on c.org_id = public.current_org_id() and c.pack_id = u.pack_id
  where u.direcao = 'recebida'
    and not (coalesce(u.order_status, '') = 'cancelled' and c.status is distinct from 'active')
    and not u.lida
    and u.pack_id not in (select pack_id from em_reclamacao);
$$;

create or replace function public.resumo_mensagens_posvenda()
returns table(nao_lidas_total integer, a_preparar integer, a_caminho integer, entregues integer, sem_responder integer, respondidas integer)
language sql
stable security definer
set search_path = public
as $$
  with p as (
    select pack_id,
      bool_or(direcao = 'recebida' and lida_ml_em is null) as nao_lida_ml,
      (array_agg(direcao order by data_ml desc nulls last, message_id desc))[1] as ult_dir,
      (array_agg(lida order by data_ml desc nulls last, message_id desc))[1] as ult_lida,
      (array_agg(order_status order by data_ml desc nulls last, message_id desc))[1] as status_pedido
    from public.ml_mensagens
    where org_id = public.current_org_id()
    group by pack_id
  ), em_reclamacao as (
    select distinct m.pack_id
    from public.ml_mensagens m
    join public.ml_devolucoes d
      on d.org_id = m.org_id
     and (d.order_id::text = m.order_id or d.order_id::text = m.pack_id)
    where m.org_id = public.current_org_id()
      and d.status = 'opened' and d.type = 'mediations'
  ), v as (
    select p.*, (
      select ev.shipping_status from public.ml_vendas ev
      where ev.org_id = public.current_org_id()
        and (ev.pack_id::text = p.pack_id or ev.order_id::text = p.pack_id)
      order by ev.date_closed desc nulls last limit 1
    ) as envio,
    p.pack_id in (select pack_id from em_reclamacao) as reclamacao
    from p
    left join public.ml_conversas c on c.org_id = public.current_org_id() and c.pack_id = p.pack_id
    where not (coalesce(status_pedido, '') = 'cancelled' and c.status is distinct from 'active')
  )
  select
    (count(*) filter (where nao_lida_ml))::int,
    (count(*) filter (where nao_lida_ml and envio in ('pending', 'handling', 'ready_to_ship')))::int,
    (count(*) filter (where nao_lida_ml and envio = 'shipped'))::int,
    (count(*) filter (where nao_lida_ml and envio = 'delivered'))::int,
    (count(*) filter (where not nao_lida_ml and ult_dir = 'recebida' and not ult_lida and not reclamacao))::int,
    (count(*) filter (where not nao_lida_ml and ult_dir = 'enviada'))::int
  from v;
$$;
