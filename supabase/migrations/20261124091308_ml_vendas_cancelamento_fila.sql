-- ADR-0211: obrigação de tratar cancelamento, armada na própria linha da venda.
-- Colunas nascem nulas e nada é preenchido aqui: o acervo (já `cancelled` em raw) nunca arma.
-- Teste: supabase/tests/ml_vendas_cancelamento_fila.sql (esquema de ensaio, transação desfeita).
set local lock_timeout = '3s';   -- falha rápido em vez de enfileirar atrás de gravação longa

alter table public.ml_vendas
  add column cancelamento_geracao      uuid,
  add column cancelamento_versao       text,
  add column cancelamento_armado_em    timestamptz,
  add column cancelamento_lote         text,
  add column cancelamento_tentativas   integer not null default 0,
  add column cancelamento_tentado_em   timestamptz,
  add column cancelamento_desfecho     text,
  add column cancelamento_concluido_em timestamptz;
create index ml_vendas_cancelamento_fila_idx on public.ml_vendas (org_id, cancelamento_lote)
  where cancelamento_geracao is not null;

-- Só arma ou renova a geração. Só atribui em NEW, sem conversão de tipo: não cria falha nova no upsert.
-- Versão = raw.last_updated como texto. Em produção o formato é único (29 caracteres, `.000-04:00`,
-- 10.543 linhas em 24/11), então a ordem do texto é a ordem do tempo.
create function public.ml_vendas_cancelamento_fila()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_nova     text    := new.raw->>'last_updated';
  v_pendente boolean := new.cancelamento_geracao is not null and new.cancelamento_concluido_em is null;
begin
  if new.cancelamento_geracao is null then
    -- Nunca armada: só arma na transição. Venda do acervo, já cancelada, não arma.
    if coalesce(old.raw->>'status', old.status, '') = 'cancelled' then
      return new;
    end if;
  elsif ((v_nova collate "C") > (new.cancelamento_versao collate "C")) is not true then
    -- Já armada, e este cancelled não é mais novo que o já visto: nada muda.
    return new;
  end if;
  -- Geração nova: qualquer conclusão em andamento com a geração antiga deixa de valer.
  new.cancelamento_geracao := pg_catalog.gen_random_uuid();
  new.cancelamento_versao  := v_nova;
  if not v_pendente then
    new.cancelamento_armado_em    := clock_timestamp();
    new.cancelamento_tentativas   := 0;
    new.cancelamento_tentado_em   := null;
    new.cancelamento_desfecho     := null;
    new.cancelamento_concluido_em := null;
  end if;
  -- cancelamento_lote fica como está: o teto do ciclo conta por ele.
  return new;
end;
$$;
revoke all on function public.ml_vendas_cancelamento_fila() from public, anon, authenticated;

-- `of raw`: marcarConversaCancelada grava só a coluna status. Só update: venda inédita não arma.
-- Dispara em todo cancelled gravado (inclusive cancelled → cancelled); a função decide.
create trigger ml_vendas_cancelamento_fila
  before update of raw on public.ml_vendas
  for each row
  when (coalesce(new.raw->>'status', '') = 'cancelled')
  execute function public.ml_vendas_cancelamento_fila();

-- Reabre o que ganhou baixa depois de concluído e fixa o lote do ciclo.
-- Teto exato: sob a trava, marca no máximo p_limite − (linhas da org já com este lote); nada apaga o lote.
-- Só o ciclo corrente reivindica: execução atrasada de um ciclo anterior sai sem marcar nada.
create function public.reivindicar_cancelamentos(p_org uuid, p_lote text, p_limite integer, p_carencia interval)
returns table (id uuid, order_id bigint, geracao uuid, versao text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_ja integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('cancelamentos|' || p_org::text, 0));
  if not exists (select 1 from public.worker_rodadas w
                  where w.job = 'reconciliar' and w.org_id = p_org and w.estado = 'rodando'
                    and w.params->>'ate' = p_lote) then
    return;
  end if;

  update public.ml_vendas v
     set cancelamento_geracao      = pg_catalog.gen_random_uuid(),
         cancelamento_armado_em    = clock_timestamp(),
         cancelamento_tentativas   = 0,
         cancelamento_tentado_em   = null,
         cancelamento_desfecho     = 'reaberto: baixa depois da conclusão',
         cancelamento_concluido_em = null
   where v.id in (
     select c.id
       from public.ml_vendas c
       join public.estoque_movimentos m
         on m.org_id = c.org_id and m.motivo = 'venda' and m.quantidade < 0
        and split_part(m.referencia_externa, ':', 1) = 'mercado_livre'
        and split_part(m.referencia_externa, ':', 2) = c.order_id::text
      where c.org_id = p_org and c.cancelamento_concluido_em is not null
        and m.criado_em > c.cancelamento_concluido_em - interval '5 minutes'
        and not exists (select 1 from public.estoque_movimentos e
                         where e.org_id = m.org_id and e.motivo = 'estorno_venda' and e.quantidade > 0
                           and e.referencia_externa = 'estorno:' || m.referencia_externa));

  select count(*) into v_ja from public.ml_vendas v
   where v.org_id = p_org and v.cancelamento_lote = p_lote;
  update public.ml_vendas v set cancelamento_lote = p_lote
   where v.id in (
     select c.id from public.ml_vendas c
      where c.org_id = p_org and c.cancelamento_geracao is not null and c.cancelamento_concluido_em is null
        and c.cancelamento_lote is distinct from p_lote
        and c.cancelamento_armado_em <= clock_timestamp() - p_carencia
      order by c.cancelamento_tentado_em asc nulls first, c.order_id
      limit greatest(p_limite - v_ja, 0));

  return query
    select v.id, v.order_id, v.cancelamento_geracao, v.cancelamento_versao
      from public.ml_vendas v
     where v.org_id = p_org and v.cancelamento_lote = p_lote
       and v.cancelamento_geracao is not null and v.cancelamento_concluido_em is null
       and v.cancelamento_armado_em <= clock_timestamp() - p_carencia;
end;
$$;

-- O que o ledger diz de cada pedido, com o instante da leitura. Uma linha por baixa; pedido sem baixa
-- devolve uma linha com codigo_ref nulo. Estorno efetivo = estorno_venda com quantidade > 0.
-- codigo_ref = referência sem o prefixo `mercado_livre:<pedido>:` (o código pode conter `:`, e em
-- venda de kit difere da coluna `codigo`).
create function public.cancelamento_baixas(p_org uuid, p_orders text[])
returns table (order_id text, lido_em timestamptz, codigo_ref text, quantidade integer, estornada boolean)
language sql security definer set search_path = '' as $$
  select o.id, statement_timestamp(),
         substr(m.referencia_externa, length('mercado_livre:' || o.id || ':') + 1),
         -m.quantidade,
         exists (select 1 from public.estoque_movimentos e
                  where e.org_id = m.org_id and e.motivo = 'estorno_venda' and e.quantidade > 0
                    and e.referencia_externa = 'estorno:' || m.referencia_externa)
    from unnest(p_orders) as o(id)
    left join public.estoque_movimentos m
      on m.org_id = p_org and m.motivo = 'venda' and m.quantidade < 0
     and starts_with(m.referencia_externa, 'mercado_livre:' || o.id || ':');
$$;

-- Desfecho por geração. concluido_em = instante da leitura do ledger que justificou a conclusão.
create function public.registrar_cancelamentos_tratados(p_org uuid, p_itens jsonb)
returns integer language sql security definer set search_path = '' as $$
  with u as (
    update public.ml_vendas v
       set cancelamento_tentativas   = v.cancelamento_tentativas + 1,
           cancelamento_tentado_em   = clock_timestamp(),
           cancelamento_desfecho     = x.desfecho,
           cancelamento_concluido_em = case when x.concluir then x.lido_em end
      from jsonb_to_recordset(coalesce(p_itens, '[]'::jsonb))
           as x(id uuid, geracao uuid, concluir boolean, desfecho text, lido_em timestamptz)
     where v.org_id = p_org and v.id = x.id and v.cancelamento_geracao = x.geracao
       and v.cancelamento_concluido_em is null
    returning 1)
  select count(*)::integer from u;
$$;

revoke all on function public.reivindicar_cancelamentos(uuid, text, integer, interval) from public, anon, authenticated;
revoke all on function public.cancelamento_baixas(uuid, text[]) from public, anon, authenticated;
revoke all on function public.registrar_cancelamentos_tratados(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.reivindicar_cancelamentos(uuid, text, integer, interval) to service_role;
grant execute on function public.cancelamento_baixas(uuid, text[]) to service_role;
grant execute on function public.registrar_cancelamentos_tratados(uuid, jsonb) to service_role;
