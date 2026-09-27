-- ADR-0173: estado das rodadas por (job, org) dos workers agendados em fan-out.
-- A linha é a fonte da verdade (ciclo, params, cursor, acumulado, notificação pendente); a mensagem
-- QStash só aponta (job, org, ciclo). Cada execução toma uma posse curta com identidade própria
-- (lease), faz o CAS do cursor com ela e a solta no fim. Escrita só pelo service_role.

-- 1) Colunas/tabelas primeiro.
alter table public.pulse_produtos
  add column coleta_tentativa_em timestamptz,
  add column coleta_falhas_seguidas integer not null default 0 check (coleta_falhas_seguidas >= 0);

alter table public.notificacoes add column chave text;
create unique index notificacoes_user_chave_key on public.notificacoes (user_id, chave);

create table public.worker_rodadas (
  job                text not null check (job in ('pulse-completo','pulse-quente','backfill','backfill-recuperacao','reconciliar')),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  ciclo              text not null,     -- um formato por job, ordenável como texto (ver plano)
  estado             text not null check (estado in ('rodando','ok','parcial','sem_acesso')),
  params             jsonb not null default '{}'::jsonb,   -- janela/tier gravados na abertura do ciclo
  cursor             text,              -- 'etapa|pos'; null = início
  acumulado          jsonb not null default '{}'::jsonb,
  lease_id           uuid,
  lease_ate          timestamptz,
  notificar_pendente boolean not null default false,
  iniciado_em        timestamptz not null,
  ultimo_ok_em       timestamptz,
  ultimo_erro_em     timestamptz,
  erro               text,
  primary key (job, org_id)
);

-- Pedido que falhou no upsert, por org (qualquer job que processa pedido lê e grava aqui).
-- Descarte NÃO apaga: `descartado_em` preenchido tira da fila automática e deixa a falha terminal
-- visível e recuperável (limpar `descartado_em`/`tentativas` volta o pedido para a fila).
create table public.worker_pendencias (
  org_id        uuid not null references public.organizations(id) on delete cascade,
  order_id      text not null,
  tentativas    integer not null default 1 check (tentativas >= 1),
  ultimo_erro   text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  descartado_em timestamptz,
  primary key (org_id, order_id)
);
create index worker_pendencias_ativas_idx on public.worker_pendencias (org_id, order_id) where descartado_em is null;

alter table public.worker_rodadas    enable row level security;
alter table public.worker_pendencias enable row level security;
create policy "worker_rodadas: select org"    on public.worker_rodadas    for select to authenticated using (org_id = (select public.current_org_id()));
create policy "worker_pendencias: select org" on public.worker_pendencias for select to authenticated using (org_id = (select public.current_org_id()));
revoke all on public.worker_rodadas, public.worker_pendencias from anon;
revoke insert, update, delete, truncate, references, trigger on public.worker_rodadas, public.worker_pendencias from authenticated;
grant select on public.worker_rodadas, public.worker_pendencias to authenticated;

-- 2) Funções.
create function public.abrir_execucao(p_job text, p_org uuid, p_ciclo text, p_params jsonb)
returns table (resultado text, lease uuid, estado text, ciclo text, cursor text, acumulado jsonb,
               params jsonb, notificar_pendente boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  w public.worker_rodadas%rowtype;
  novo uuid := gen_random_uuid();
begin
  -- A linha precisa existir ANTES do lock: FOR UPDATE não trava linha inexistente, e duas primeiras
  -- aberturas concorrentes disputariam o INSERT. Com o insert idempotente, a 2ª espera o lock da 1ª.
  insert into public.worker_rodadas (job, org_id, ciclo, estado, params, iniciado_em)
  values (p_job, p_org, p_ciclo, 'rodando', coalesce(p_params, '{}'::jsonb), now())
  on conflict (job, org_id) do nothing;
  select * into strict w from public.worker_rodadas r where r.job = p_job and r.org_id = p_org for update;

  if w.ciclo > p_ciclo then
    return query select 'obsoleta'::text, null::uuid, w.estado, w.ciclo, w.cursor, w.acumulado, w.params, w.notificar_pendente;
    return;
  end if;
  if w.lease_ate is not null and w.lease_ate > now() then
    return query select 'ocupada'::text, null::uuid, w.estado, w.ciclo, w.cursor, w.acumulado, w.params, w.notificar_pendente;
    return;
  end if;
  if w.ciclo < p_ciclo and w.notificar_pendente then
    -- Entrega primeiro a notificação do ciclo anterior (o chamador responde 500 e o retry abre o novo).
    update public.worker_rodadas r set lease_id = novo, lease_ate = now() + interval '150 seconds'
     where r.job = p_job and r.org_id = p_org;
    return query select 'notificar_anterior'::text, novo, w.estado, w.ciclo, w.cursor, w.acumulado, w.params, true;
    return;
  end if;
  if w.ciclo < p_ciclo then
    -- Ciclo novo assume (o anterior terminou ou morreu com a posse vencida).
    update public.worker_rodadas r set ciclo = p_ciclo, estado = 'rodando', params = coalesce(p_params, '{}'::jsonb),
      cursor = null, acumulado = '{}'::jsonb, lease_id = novo, lease_ate = now() + interval '150 seconds',
      notificar_pendente = false, iniciado_em = now(), erro = null
     where r.job = p_job and r.org_id = p_org;
    return query select 'executar'::text, novo, 'rodando'::text, p_ciclo, null::text, '{}'::jsonb,
      coalesce(p_params, '{}'::jsonb), false;
    return;
  end if;
  -- mesmo ciclo
  if w.estado <> 'rodando' and not w.notificar_pendente then
    return query select 'concluida'::text, null::uuid, w.estado, w.ciclo, w.cursor, w.acumulado, w.params, false;
    return;
  end if;
  update public.worker_rodadas r set lease_id = novo, lease_ate = now() + interval '150 seconds'
   where r.job = p_job and r.org_id = p_org;
  return query select 'executar'::text, novo, w.estado, w.ciclo, w.cursor, w.acumulado, w.params, w.notificar_pendente;
end;
$$;

create function public.avancar_execucao(p_job text, p_org uuid, p_lease uuid, p_cursor_novo text, p_acumulado jsonb)
returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.worker_rodadas set cursor = p_cursor_novo, acumulado = p_acumulado
     where job = p_job and org_id = p_org and lease_id = p_lease and lease_ate > now() and estado = 'rodando'
    returning 1)
  select exists (select 1 from u);
$$;

-- Com p_notificar a posse é MANTIDA (renovada) até marcar_notificado: ninguém notifica em paralelo.
create function public.concluir_execucao(p_job text, p_org uuid, p_lease uuid, p_estado text, p_erro text,
                                         p_acumulado jsonb, p_notificar boolean)
returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.worker_rodadas
       set estado = p_estado,
           acumulado = coalesce(p_acumulado, acumulado),
           notificar_pendente = coalesce(p_notificar, false),
           lease_id  = case when coalesce(p_notificar, false) then lease_id else null end,
           lease_ate = case when coalesce(p_notificar, false) then now() + interval '150 seconds' else null end,
           ultimo_ok_em   = case when p_estado in ('ok','parcial') then now() else ultimo_ok_em end,
           ultimo_erro_em = case when p_estado in ('parcial','sem_acesso') then now() else ultimo_erro_em end,
           erro           = case when p_estado in ('parcial','sem_acesso') then p_erro end
     where job = p_job and org_id = p_org and lease_id = p_lease and lease_ate > now() and estado = 'rodando'
       and p_estado in ('ok','parcial','sem_acesso')
    returning 1)
  select exists (select 1 from u);
$$;

create function public.liberar_execucao(p_job text, p_org uuid, p_lease uuid, p_erro text)
returns void
language sql security definer set search_path = '' as $$
  update public.worker_rodadas
     set lease_id = null, lease_ate = null,
         ultimo_erro_em = case when p_erro is not null then now() else ultimo_erro_em end,
         erro = coalesce(p_erro, erro)
   where job = p_job and org_id = p_org and lease_id = p_lease;
$$;

-- Chamado DEPOIS do envio in-app (idempotente pela chave). Solta a posse.
create function public.marcar_notificado(p_job text, p_org uuid, p_lease uuid)
returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.worker_rodadas set notificar_pendente = false, lease_id = null, lease_ate = null
     where job = p_job and org_id = p_org and lease_id = p_lease
    returning 1)
  select exists (select 1 from u);
$$;

-- Atômico e por TENTATIVA. `p_inicio` = instante em que a tentativa bem-sucedida COMEÇOU: o sucesso só
-- apaga falha registrada ANTES disso — uma falha de outra execução registrada durante/depois (ex.: um
-- upsert concorrente que apagou itens e falhou ao reinserir, io.ts:380) sobrevive e é retomada.
-- Falha entra com 1 ou soma 1 (carimbo por chamada: clock_timestamp()); na 5ª recebe `descartado_em`
-- e continua na tabela. Devolve quantos foram descartados NESTA chamada (RETURNING do contador).
create function public.registrar_pendencias_pedido(p_org uuid, p_ok text[], p_inicio timestamptz,
                                                   p_falhas text[], p_erro text)
returns table (descartados integer)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare n integer;
begin
  delete from public.worker_pendencias
   where org_id = p_org and order_id = any(coalesce(p_ok, '{}')) and atualizado_em < p_inicio;
  with u as (
    insert into public.worker_pendencias as p (org_id, order_id, ultimo_erro, criado_em, atualizado_em)
    select p_org, x, p_erro, clock_timestamp(), clock_timestamp() from (select distinct x from unnest(coalesce(p_falhas, '{}')) as x) d
    on conflict (org_id, order_id) do update
      -- SEMPRE atualiza carimbo/erro/contador, inclusive em pendência já descartada: senão um sucesso
      -- atrasado (p_inicio anterior a esta falha) acharia o carimbo velho e apagaria a linha. O descarte,
      -- uma vez marcado, permanece (coalesce).
      set tentativas = p.tentativas + 1, ultimo_erro = excluded.ultimo_erro, atualizado_em = clock_timestamp(),
          descartado_em = coalesce(p.descartado_em, case when p.tentativas + 1 >= 5 then clock_timestamp() end)
    returning p.tentativas as tentativas_depois)
  -- Descartado NESTA chamada ⇔ o contador acabou de chegar a 5 (ele nunca para de subir).
  select count(*) filter (where tentativas_depois = 5)::int into n from u;
  return query select n;
end;
$$;

-- Falha de leitura da ficha: incremento atômico e no máximo 1 por hora por produto.
create function public.registrar_falha_coleta_pulse(p_org uuid, p_produto uuid)
returns void
language sql security definer set search_path = '' as $$
  update public.pulse_produtos
     set coleta_falhas_seguidas = coleta_falhas_seguidas + 1, coleta_tentativa_em = now()
   where org_id = p_org and id = p_produto
     and (coleta_tentativa_em is null or coleta_tentativa_em < now() - interval '1 hour' or coleta_falhas_seguidas = 0);
$$;

revoke all on function public.abrir_execucao(text, uuid, text, jsonb)                          from public, anon, authenticated;
revoke all on function public.avancar_execucao(text, uuid, uuid, text, jsonb)                  from public, anon, authenticated;
revoke all on function public.concluir_execucao(text, uuid, uuid, text, text, jsonb, boolean)  from public, anon, authenticated;
revoke all on function public.liberar_execucao(text, uuid, uuid, text)                         from public, anon, authenticated;
revoke all on function public.marcar_notificado(text, uuid, uuid)                              from public, anon, authenticated;
revoke all on function public.registrar_pendencias_pedido(uuid, text[], timestamptz, text[], text) from public, anon, authenticated;
revoke all on function public.registrar_falha_coleta_pulse(uuid, uuid)                         from public, anon, authenticated;
grant execute on function public.abrir_execucao(text, uuid, text, jsonb)                       to service_role;
grant execute on function public.avancar_execucao(text, uuid, uuid, text, jsonb)               to service_role;
grant execute on function public.concluir_execucao(text, uuid, uuid, text, text, jsonb, boolean) to service_role;
grant execute on function public.liberar_execucao(text, uuid, uuid, text)                      to service_role;
grant execute on function public.marcar_notificado(text, uuid, uuid)                           to service_role;
grant execute on function public.registrar_pendencias_pedido(uuid, text[], timestamptz, text[], text) to service_role;
grant execute on function public.registrar_falha_coleta_pulse(uuid, uuid)                      to service_role;
