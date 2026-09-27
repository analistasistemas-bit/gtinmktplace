-- Vendas SKU — Fatia 2b: tráfego (visitas/dia) e preço de oferta observado por MLB. Só leitura no ML.
-- Escrita só pelo worker (service_role), via RPCs abaixo. Dia = results[].date[:10] literal (spike 052).

create table public.ml_item_visitas_dia (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  ml_item_id  text not null,
  dia         date not null,
  visitas     integer,                -- null só em falha; pendente guarda o parcial
  estado      text not null check (estado in ('ok','pendente','falha')),
  coletado_em timestamptz not null,
  rodada      timestamptz not null,   -- rodada (ml_trafego_sync.rodada) que gravou a linha
  primary key (org_id, ml_item_id, dia)  -- cobre (org_id, ml_item_id, dia desc)
);

create table public.ml_item_preco_dia (
  org_id        uuid not null references public.organizations(id) on delete cascade,
  ml_item_id    text not null,
  dia           date not null,
  preco         numeric(12,2) not null,
  preco_regular numeric(12,2),
  moeda         text not null,
  observado_em  timestamptz not null,
  origem        text not null,
  primary key (org_id, ml_item_id, dia)
);

create table public.ml_trafego_sync (
  org_id                     uuid primary key references public.organizations(id) on delete cascade,
  estado                     text not null check (estado in ('sincronizando','ok','sem_acesso','erro')),
  rodada                     timestamptz,   -- identidade da cadeia dona da posse
  posse_ate                  timestamptz,   -- posse viva enquanto > now(); renovada a cada lote
  iniciado_em                timestamptz,
  ultimo_ok_em               timestamptz,
  ultimo_erro_em             timestamptz,
  erro                       text,
  cursor                     text,          -- último MLB processado; null = início
  carga_inicial_concluida_em timestamptz    -- null = carga de 150 dias ainda não terminou
);

-- Status do anúncio (multiget /items?attributes=id,status) para tirar da coleta o encerrado há > 30 dias.
create table public.ml_trafego_item (
  org_id       uuid not null references public.organizations(id) on delete cascade,
  ml_item_id   text not null,
  status       text not null,
  status_desde timestamptz not null,
  ultimo_ok_em timestamptz,
  primary key (org_id, ml_item_id)
);

-- RLS: membro lê a própria org. Escrita só pelo service_role: os default privileges do Supabase dão ALL
-- a anon/authenticated em tabela nova do public; os revokes abaixo tiram tudo de anon e, de authenticated,
-- tudo exceto SELECT (TRUNCATE não passa por RLS). Precedente: 20260924184220_central_promocoes.sql.
alter table public.ml_item_visitas_dia enable row level security;
alter table public.ml_item_preco_dia   enable row level security;
alter table public.ml_trafego_sync     enable row level security;
alter table public.ml_trafego_item     enable row level security;
create policy "ml_item_visitas_dia: select org" on public.ml_item_visitas_dia for select to authenticated using (org_id = (select public.current_org_id()));
create policy "ml_item_preco_dia: select org"   on public.ml_item_preco_dia   for select to authenticated using (org_id = (select public.current_org_id()));
create policy "ml_trafego_sync: select org"     on public.ml_trafego_sync     for select to authenticated using (org_id = (select public.current_org_id()));
create policy "ml_trafego_item: select org"     on public.ml_trafego_item     for select to authenticated using (org_id = (select public.current_org_id()));
revoke all on public.ml_item_visitas_dia, public.ml_item_preco_dia, public.ml_trafego_sync, public.ml_trafego_item from anon;
revoke insert, update, delete, truncate, references, trigger on public.ml_item_visitas_dia, public.ml_item_preco_dia, public.ml_trafego_sync, public.ml_trafego_item from authenticated;
grant select on public.ml_item_visitas_dia, public.ml_item_preco_dia, public.ml_trafego_sync, public.ml_trafego_item to authenticated;

-- Contrato do worker (Tasks 4/5):
-- 1. Fan-out: reservar_trafego_posse(org) → 1 linha {rodada, cursor} = posse tomada (cursor retomado se a
--    carga inicial não terminou; senão null); 0 linhas = posse viva de outra cadeia → não abrir 2ª cadeia.
-- 2. Cada lote: upsert (gravar_*) e DEPOIS avancar_trafego_cursor(org, rodada, cursor_lido, cursor_novo).
--    false = rodada perdeu a posse (ou cursor já avançou) → responder `obsoleta` (HTTP 200).
--    Para só renovar/checar posse no início de uma continuação: cursor_novo = cursor_lido.
-- 3. Fim/erro: update direto como service_role, sempre com `where org_id = $1 and rodada = $2`:
--    fim → estado='ok', ultimo_ok_em=now(), posse_ate=null, cursor=null,
--          carga_inicial_concluida_em=coalesce(carga_inicial_concluida_em, now());
--    erro → estado='erro'|'sem_acesso', ultimo_erro_em=now(), erro=..., posse_ate=null (cursor mantido).

create function public.reservar_trafego_posse(p_org uuid)
returns table (rodada timestamptz, cursor text)
language sql security definer set search_path = '' as $$
  insert into public.ml_trafego_sync as s (org_id, estado, rodada, posse_ate, iniciado_em)
  values (p_org, 'sincronizando', now(), now() + interval '10 minutes', now())
  on conflict (org_id) do update set
    estado = 'sincronizando', rodada = now(), posse_ate = now() + interval '10 minutes', iniciado_em = now(),
    cursor = case when s.carga_inicial_concluida_em is null then s.cursor end
  where s.posse_ate is null or s.posse_ate <= now()
  returning s.rodada, s.cursor;
$$;

-- CAS atômico do cursor + renovação da posse (10 min).
create function public.avancar_trafego_cursor(p_org uuid, p_rodada timestamptz, p_cursor_atual text, p_cursor_novo text)
returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.ml_trafego_sync
       set cursor = p_cursor_novo, posse_ate = now() + interval '10 minutes'
     where org_id = p_org and rodada = p_rodada and cursor is not distinct from p_cursor_atual
    returning 1)
  select exists (select 1 from u);
$$;

-- p_pontos: [{ml_item_id, dia, visitas, estado}]. Rodada mais antiga nunca sobrescreve; `ok` só é trocado
-- por outro `ok` (falha/pendente nunca apagam um dia ok).
create function public.gravar_visitas_dia(p_org uuid, p_rodada timestamptz, p_pontos jsonb)
returns void
language sql security definer set search_path = '' as $$
  insert into public.ml_item_visitas_dia as a (org_id, ml_item_id, dia, visitas, estado, coletado_em, rodada)
  select p_org, x.ml_item_id, x.dia, x.visitas, x.estado, now(), p_rodada
    from jsonb_to_recordset(p_pontos) as x(ml_item_id text, dia date, visitas integer, estado text)
  on conflict (org_id, ml_item_id, dia) do update
    set visitas = excluded.visitas, estado = excluded.estado, coletado_em = excluded.coletado_em, rodada = excluded.rodada
    where excluded.rodada >= a.rodada and (a.estado <> 'ok' or excluded.estado = 'ok');
$$;

-- p_pontos: [{ml_item_id, dia, preco, preco_regular, moeda, observado_em, origem}]. 1ª observação do dia fica.
create function public.gravar_preco_dia(p_org uuid, p_pontos jsonb)
returns void
language sql security definer set search_path = '' as $$
  insert into public.ml_item_preco_dia (org_id, ml_item_id, dia, preco, preco_regular, moeda, observado_em, origem)
  select p_org, x.ml_item_id, x.dia, x.preco, x.preco_regular, x.moeda, x.observado_em, x.origem
    from jsonb_to_recordset(p_pontos) as x(ml_item_id text, dia date, preco numeric, preco_regular numeric,
                                           moeda text, observado_em timestamptz, origem text)
  on conflict (org_id, ml_item_id, dia) do nothing;
$$;

-- p_itens: [{ml_item_id, status, ultimo_ok_em?}]. status_desde só muda quando o status muda.
create function public.gravar_trafego_item(p_org uuid, p_itens jsonb)
returns void
language sql security definer set search_path = '' as $$
  insert into public.ml_trafego_item as a (org_id, ml_item_id, status, status_desde, ultimo_ok_em)
  select p_org, x.ml_item_id, x.status, now(), x.ultimo_ok_em
    from jsonb_to_recordset(p_itens) as x(ml_item_id text, status text, ultimo_ok_em timestamptz)
  on conflict (org_id, ml_item_id) do update
    set status       = excluded.status,
        status_desde = case when a.status is distinct from excluded.status then excluded.status_desde else a.status_desde end,
        ultimo_ok_em = greatest(a.ultimo_ok_em, excluded.ultimo_ok_em);
$$;

revoke all on function public.reservar_trafego_posse(uuid)                               from public, anon, authenticated;
revoke all on function public.avancar_trafego_cursor(uuid, timestamptz, text, text)      from public, anon, authenticated;
revoke all on function public.gravar_visitas_dia(uuid, timestamptz, jsonb)               from public, anon, authenticated;
revoke all on function public.gravar_preco_dia(uuid, jsonb)                              from public, anon, authenticated;
revoke all on function public.gravar_trafego_item(uuid, jsonb)                           from public, anon, authenticated;
grant execute on function public.reservar_trafego_posse(uuid)                            to service_role;
grant execute on function public.avancar_trafego_cursor(uuid, timestamptz, text, text)   to service_role;
grant execute on function public.gravar_visitas_dia(uuid, timestamptz, jsonb)            to service_role;
grant execute on function public.gravar_preco_dia(uuid, jsonb)                           to service_role;
grant execute on function public.gravar_trafego_item(uuid, jsonb)                        to service_role;
