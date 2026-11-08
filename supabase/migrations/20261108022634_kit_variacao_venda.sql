-- ADR-0197 (Task 8): venda e cancelamento do kit com variação.
--
-- 1) Identidade estável por item de pedido. A referência da baixa é `canal:pedido:SKU`; se duas execuções
--    resolvessem SKUs diferentes para o mesmo item (catálogo ou GTIN tolerante), nasceriam dois débitos. Na
--    primeira baixa, (org, pedido, item ML, variação) → SKU fica gravado uma vez só (PK). Baixas e estornos
--    seguintes do mesmo item usam esse SKU. Só org com o módulo grava aqui.
-- 2) Crédito de cancelamento de SKU participante é obrigação: a pendência em `worker_pendencias` marcada
--    `obrigatoria` nunca é descartada pelo contador (sai só por sucesso do pedido ou à mão).
--
-- `db push` não roda em transação: cada statement é re-executável.

create table if not exists public.kit_venda_identidade (
  org_id       uuid not null references public.organizations(id),
  canal        text not null,
  order_id     text not null,
  ml_item_id   text not null,
  variation_id text not null default '',   -- '' = item sem variação (PK não aceita nulo)
  codigo       text not null,
  criado_em    timestamptz not null default now(),
  primary key (org_id, canal, order_id, ml_item_id, variation_id)
);
alter table public.kit_venda_identidade enable row level security;
revoke all on public.kit_venda_identidade from anon, authenticated;
grant select, insert on public.kit_venda_identidade to service_role;

-- Identidade é imutável: trocar o SKU de um item já baixado reabriria o débito duplo.
create or replace function public.kit_venda_identidade_imutavel()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Identidade de item vendido é imutável (ADR-0197).' using errcode = 'restrict_violation';
end $$;
drop trigger if exists kit_venda_identidade_imutavel on public.kit_venda_identidade;
create trigger kit_venda_identidade_imutavel
  before update on public.kit_venda_identidade
  for each row execute procedure public.kit_venda_identidade_imutavel();

alter table public.worker_pendencias add column if not exists obrigatoria boolean not null default false;

-- 3) Aviso de kit zerado em modo manual. O evento é o movimento de venda que zerou o SKU do kit; esta coluna só
--    é preenchida DEPOIS do envio (notificação com chave, idempotente). Sem ela, a próxima varredura (sync-venda,
--    importação da saga ou reconciliação diária) tenta de novo, sem janela de tempo.
alter table public.estoque_movimentos add column if not exists kit_aviso_enviado_em timestamptz;
create index if not exists estoque_movimentos_zerado_sem_aviso_idx
  on public.estoque_movimentos (org_id, codigo)
  where motivo = 'venda' and estoque_resultante = 0 and kit_aviso_enviado_em is null;

-- Corpo de 20260927205804 preservado; só o descarte poupa a pendência obrigatória.
create or replace function public.registrar_pendencias_pedido(p_org uuid, p_ok text[], p_inicio timestamptz,
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
      set tentativas = p.tentativas + 1, ultimo_erro = excluded.ultimo_erro, atualizado_em = clock_timestamp(),
          descartado_em = coalesce(p.descartado_em,
                                   case when p.tentativas + 1 >= 5 and not p.obrigatoria then clock_timestamp() end)
    returning p.tentativas as tentativas_depois, p.obrigatoria as obrigatoria)
  select count(*) filter (where tentativas_depois = 5 and not obrigatoria)::int into n from u;
  return query select n;
end;
$$;

-- Registra (ou renova) a obrigação de crédito de um pedido. Reativa linha descartada antes.
create or replace function public.registrar_pendencia_kit(p_org uuid, p_order text, p_erro text)
returns void
language sql security definer set search_path = '' as $$
  insert into public.worker_pendencias as p (org_id, order_id, ultimo_erro, criado_em, atualizado_em, obrigatoria)
  values (p_org, p_order, p_erro, clock_timestamp(), clock_timestamp(), true)
  on conflict (org_id, order_id) do update
    set tentativas = p.tentativas + 1, ultimo_erro = excluded.ultimo_erro, atualizado_em = clock_timestamp(),
        obrigatoria = true, descartado_em = null;
$$;
revoke all on function public.registrar_pendencia_kit(uuid, text, text) from public, anon, authenticated;
grant execute on function public.registrar_pendencia_kit(uuid, text, text) to service_role;
