-- Vendas SKU — Fatia 2c: Product Ads por grupo (ad_group_id). Só leitura no ML (spike 053).
-- Escrita só pelo worker coletar-ads-ml (service_role), pelas RPCs abaixo. Unidade = ad_group_id:
-- toda soma é por grupo; o vínculo grupo → MLB é só o atual (visto_em).

create table public.ml_ads_sync (
  org_id           uuid primary key references public.organizations(id) on delete cascade,
  advertiser_id    bigint,
  estado           text not null check (estado in ('sincronizando','ok','sem_permissao','sem_advertiser','sem_acesso','erro')),
  erro             text,
  rodada           timestamptz,   -- identidade da cadeia dona da posse (ms)
  posse_ate        timestamptz,   -- posse viva enquanto > now(); renovada a cada lote
  iniciado_em      timestamptz,
  cursor           text,          -- último ad_group_id gravado; null = início
  ultimo_ok_em     timestamptz,
  ultimo_erro_em   timestamptz,
  carga_inicial_ok boolean not null default false,  -- carga de 90 dias concluída
  cobertura_desde  date,          -- 1º dia coberto por coleta ok (carga inicial; avança com retenção/buraco)
  custo_resumo     numeric check (custo_resumo is null or custo_resumo >= 0),    -- metrics_summary.cost dos últimos 90 dias (sempre; Ruling 2c-9: busca extra só na msg que fecha a rodada)
  custo_listado    numeric check (custo_listado is null or custo_listado >= 0)   -- Σ cost dos grupos listados nos últimos 90 dias, já sem 404 e sem vazio-sem-vínculo (Rulings 2c-7/2c-8)
);

create table public.ml_ads_grupo (
  org_id        uuid not null references public.organizations(id) on delete cascade,
  ad_group_id   bigint not null,
  tipo          text not null check (tipo in ('ITEM','FAMILY','CATALOG')),
  external_id   text,             -- ITEM: MLB; FAMILY: family_id; CATALOG: parent_id
  campaign_id   bigint check (campaign_id is null or campaign_id >= 0),  -- 0 = fora de campanha hoje
  status        text not null,
  atualizado_em timestamptz not null,
  primary key (org_id, ad_group_id)
);

create table public.ml_ads_grupo_item (
  org_id      uuid not null,
  ad_group_id bigint not null,
  ml_item_id  text not null,
  visto_em    timestamptz not null,
  primary key (org_id, ad_group_id, ml_item_id),
  foreign key (org_id, ad_group_id) references public.ml_ads_grupo (org_id, ad_group_id) on delete cascade
);
-- Leitura do dossiê: grupos que tocam os MLBs do alvo.
create index ml_ads_grupo_item_mlb_idx on public.ml_ads_grupo_item (org_id, ml_item_id);

create table public.ml_ads_grupo_dia (
  org_id          uuid not null,
  ad_group_id     bigint not null,
  dia             date not null,
  cost            numeric not null check (cost >= 0),
  clicks          integer not null check (clicks >= 0),
  prints          integer not null check (prints >= 0),
  direct_amount   numeric not null check (direct_amount >= 0),
  indirect_amount numeric not null check (indirect_amount >= 0),
  total_amount    numeric not null check (total_amount >= 0),
  direct_units    integer not null check (direct_units >= 0),
  units           integer not null check (units >= 0),
  coletado_em     timestamptz not null,  -- define se a atribuição do dia já fechou (coletado_em − dia ≥ 15)
  primary key (org_id, ad_group_id, dia),
  foreign key (org_id, ad_group_id) references public.ml_ads_grupo (org_id, ad_group_id) on delete cascade
);
-- Releitura (grupos com gasto na janela) e retenção.
create index ml_ads_grupo_dia_org_dia_idx on public.ml_ads_grupo_dia (org_id, dia);

-- RLS: membro lê a própria org; escrita só service_role (precedente: 20260927084615_vendas_sku_trafego.sql).
alter table public.ml_ads_sync       enable row level security;
alter table public.ml_ads_grupo      enable row level security;
alter table public.ml_ads_grupo_item enable row level security;
alter table public.ml_ads_grupo_dia  enable row level security;
create policy "ml_ads_sync: select org"       on public.ml_ads_sync       for select to authenticated using (org_id = (select public.current_org_id()));
create policy "ml_ads_grupo: select org"      on public.ml_ads_grupo      for select to authenticated using (org_id = (select public.current_org_id()));
create policy "ml_ads_grupo_item: select org" on public.ml_ads_grupo_item for select to authenticated using (org_id = (select public.current_org_id()));
create policy "ml_ads_grupo_dia: select org"  on public.ml_ads_grupo_dia  for select to authenticated using (org_id = (select public.current_org_id()));
revoke all on public.ml_ads_sync, public.ml_ads_grupo, public.ml_ads_grupo_item, public.ml_ads_grupo_dia from anon;
revoke insert, update, delete, truncate, references, trigger on public.ml_ads_sync, public.ml_ads_grupo, public.ml_ads_grupo_item, public.ml_ads_grupo_dia from authenticated;
grant select on public.ml_ads_sync, public.ml_ads_grupo, public.ml_ads_grupo_item, public.ml_ads_grupo_dia to authenticated;

-- Contrato do worker (mesmo da 2b, estado próprio):
-- 1. Fan-out: reservar_ads_posse(org) → 1 linha {rodada, cursor} = posse tomada (cursor retomado se a carga
--    inicial não terminou); 0 linhas = posse viva de outra cadeia.
-- 2. Cada lote: gravar_ads_lote (false = não é a dona) e DEPOIS avancar_ads_cursor (CAS).
-- 3. Fim/parada: concluir_ads_rodada(org, rodada, estado, …) → false = rodada obsoleta. Sempre solta a posse.

create function public.reservar_ads_posse(p_org uuid)
returns table (rodada timestamptz, cursor text)
language sql security definer set search_path = '' as $$
  insert into public.ml_ads_sync as s (org_id, estado, rodada, posse_ate, iniciado_em)
  values (p_org, 'sincronizando', date_trunc('milliseconds', now()), now() + interval '10 minutes', now())
  on conflict (org_id) do update set
    estado = 'sincronizando', rodada = date_trunc('milliseconds', now()), posse_ate = now() + interval '10 minutes',
    iniciado_em = now(), erro = null,
    cursor = case when not s.carga_inicial_ok then s.cursor end
  where s.posse_ate is null or s.posse_ate <= now()
  returning s.rodada, s.cursor;
$$;

create function public.avancar_ads_cursor(p_org uuid, p_rodada timestamptz, p_cursor_atual text, p_cursor_novo text)
returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.ml_ads_sync
       set cursor = p_cursor_novo, posse_ate = now() + interval '10 minutes'
     where org_id = p_org and rodada = p_rodada and cursor is not distinct from p_cursor_atual
    returning 1)
  select exists (select 1 from u);
$$;

-- p_grupos: [{ad_group_id, tipo, external_id, campaign_id, status, itens: [mlb]|null, dias: [...]}].
-- O mais recente vence por p_coletado_em (a atribuição muda por 14 dias, inclusive para baixo).
-- itens array não vazio = vínculo atual completo (substitui); null ou [] = mantém o gravado (lista vazia do
-- ML não apaga vínculo: o gasto do grupo sumiria do dossiê).
-- Grupo que não vem no lote não é tocado: nada é apagado quando um grupo some do search.
-- A guarda `excluded.coletado_em >= a.coletado_em` do dia é redundante pelo caminho das RPCs: o `continue`
-- já barra lote mais velho que o grupo, e atualizado_em do grupo ≥ coletado_em de todo dia dele (os dois
-- são gravados juntos, sob o lock da linha de sync). Fica como defesa contra escrita fora das RPCs.
create function public.gravar_ads_lote(p_org uuid, p_rodada timestamptz, p_coletado_em timestamptz, p_grupos jsonb)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  g jsonb;
  v_id bigint;
begin
  perform 1 from public.ml_ads_sync s where s.org_id = p_org and s.rodada = p_rodada for update;
  if not found then return false; end if;
  for g in select e from jsonb_array_elements(p_grupos) as t(e) loop
    v_id := (g->>'ad_group_id')::bigint;
    if exists (select 1 from public.ml_ads_grupo a
                where a.org_id = p_org and a.ad_group_id = v_id and a.atualizado_em > p_coletado_em) then
      continue;
    end if;
    insert into public.ml_ads_grupo as a (org_id, ad_group_id, tipo, external_id, campaign_id, status, atualizado_em)
    values (p_org, v_id, g->>'tipo', g->>'external_id', (g->>'campaign_id')::bigint, g->>'status', p_coletado_em)
    on conflict (org_id, ad_group_id) do update
      set tipo = excluded.tipo, external_id = excluded.external_id, campaign_id = excluded.campaign_id,
          status = excluded.status, atualizado_em = excluded.atualizado_em;
    if jsonb_typeof(g->'itens') = 'array' and jsonb_array_length(g->'itens') > 0 then
      delete from public.ml_ads_grupo_item i
       where i.org_id = p_org and i.ad_group_id = v_id
         and not (i.ml_item_id in (select jsonb_array_elements_text(g->'itens')));
      insert into public.ml_ads_grupo_item (org_id, ad_group_id, ml_item_id, visto_em)
      select distinct p_org, v_id, x, p_coletado_em from jsonb_array_elements_text(g->'itens') as t(x)
      on conflict (org_id, ad_group_id, ml_item_id) do update set visto_em = excluded.visto_em;
    end if;
    insert into public.ml_ads_grupo_dia as a (org_id, ad_group_id, dia, cost, clicks, prints, direct_amount,
                                               indirect_amount, total_amount, direct_units, units, coletado_em)
    select distinct on (x.dia) p_org, v_id, x.dia, x.cost, x.clicks, x.prints, x.direct_amount,
           x.indirect_amount, x.total_amount, x.direct_units, x.units, p_coletado_em
      from jsonb_to_recordset(coalesce(g->'dias', '[]'::jsonb)) as x(dia date, cost numeric, clicks integer,
           prints integer, direct_amount numeric, indirect_amount numeric, total_amount numeric,
           direct_units integer, units integer)
     order by x.dia
    on conflict (org_id, ad_group_id, dia) do update
      set cost = excluded.cost, clicks = excluded.clicks, prints = excluded.prints,
          direct_amount = excluded.direct_amount, indirect_amount = excluded.indirect_amount,
          total_amount = excluded.total_amount, direct_units = excluded.direct_units, units = excluded.units,
          coletado_em = excluded.coletado_em
      where excluded.coletado_em >= a.coletado_em;
  end loop;
  return true;
end $$;

-- Fecha a rodada (só a dona). ok → ultimo_ok_em, custo_resumo e custo_listado da janela; outro estado →
-- ultimo_erro_em + erro (ultimo_ok_em e os custos da última rodada ok ficam).
-- p_carga_concluida → carga_inicial_ok, cursor zerado e cobertura_desde: a 1ª carga a define; depois ela só
-- avança se a janela relida (p_cobertura_desde) começou depois de "último ok − 14" — worker parado > 90 dias
-- deixou buraco que não pode virar zero. `ultimo_ok_em` no SET é o valor anterior ao update.
-- Sempre solta a posse.
create function public.concluir_ads_rodada(p_org uuid, p_rodada timestamptz, p_estado text, p_erro text default null,
                                           p_carga_concluida boolean default false, p_advertiser_id bigint default null,
                                           p_cobertura_desde date default null, p_custo_resumo numeric default null,
                                           p_custo_listado numeric default null)
returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.ml_ads_sync
       set estado = p_estado,
           posse_ate = null,
           advertiser_id = coalesce(p_advertiser_id, advertiser_id),
           ultimo_ok_em = case when p_estado = 'ok' then now() else ultimo_ok_em end,
           ultimo_erro_em = case when p_estado <> 'ok' then now() else ultimo_erro_em end,
           erro = case when p_estado <> 'ok' then p_erro end,
           custo_resumo = case when p_estado = 'ok' then p_custo_resumo else custo_resumo end,
           custo_listado = case when p_estado = 'ok' then p_custo_listado else custo_listado end,
           carga_inicial_ok = carga_inicial_ok or p_carga_concluida,
           cobertura_desde = case
             when not p_carga_concluida then cobertura_desde
             when cobertura_desde is null then p_cobertura_desde
             when ultimo_ok_em is not null
                  and p_cobertura_desde > (ultimo_ok_em at time zone 'America/Sao_Paulo')::date - 14 then p_cobertura_desde
             else cobertura_desde end,
           cursor = case when p_carga_concluida then null else cursor end
     where org_id = p_org and rodada = p_rodada
    returning 1)
  select exists (select 1 from u);
$$;

-- Retenção de 13 meses (corte calculado pelo worker, corteRetencao). Grupo sem dia retido e sem leitura
-- desde o corte sai com o vínculo (cascade). A cobertura avança junto: dia apagado não pode virar
-- "zero comprovado" no dossiê.
create function public.limpar_ads_retencao(p_corte date)
returns void
language sql security definer set search_path = '' as $$
  delete from public.ml_ads_grupo_dia where dia < p_corte;
  update public.ml_ads_sync set cobertura_desde = p_corte where cobertura_desde < p_corte;
  delete from public.ml_ads_grupo g
   where g.atualizado_em < p_corte
     and not exists (select 1 from public.ml_ads_grupo_dia d where d.org_id = g.org_id and d.ad_group_id = g.ad_group_id);
$$;

-- Leitura do dossiê: códigos de MLBs arbitrários (membros de um grupo de Ads), mesma UNION de
-- vendas_sku_mlbs (20260927045118_vendas_sku_dossie.sql, CTE `pares`), sem familias.ml_item_id (spike 053 §4).
-- MLB sem código resolvido fica fora do objeto: no front ele impede a exclusividade do grupo.
create function public.vendas_sku_codigos_mlbs(p_mlbs text[])
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with org as (select public.current_org_id() as id),
  pares as (
    select i.ml_item_id as mlb, i.codigo from public.ml_vendas_itens i cross join org
     where i.org_id = org.id and i.ml_item_id = any (p_mlbs) and coalesce(i.codigo, '') <> ''
    union
    select x.item_externo_id, x.sku from public.anuncios_externos_itens x cross join org
     where x.org_id = org.id and x.item_externo_id = any (p_mlbs) and coalesce(x.sku, '') <> ''
    union
    select a.item_externo_id, k.codigo from public.anuncios_externos a
      cross join org
      cross join lateral jsonb_object_keys(
        case when jsonb_typeof(a.variacoes_externas) = 'object' then a.variacoes_externas else '{}'::jsonb end
      ) as k(codigo)
     where a.org_id = org.id and a.item_externo_id = any (p_mlbs)
    union
    select a.ml_item_id_anterior, e.v ->> 'sku' from public.anuncios_externos a
      cross join org
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(a.migracao_pxv_snapshot) = 'array' then a.migracao_pxv_snapshot else '[]'::jsonb end
      ) as e(v)
     where a.org_id = org.id and a.ml_item_id_anterior = any (p_mlbs)
       and coalesce(e.v ->> 'sku', '') <> ''
  )
  select coalesce(jsonb_object_agg(g.mlb, g.codigos), '{}'::jsonb)
  from (
    select p.mlb, to_jsonb(array_agg(distinct p.codigo order by p.codigo)) as codigos
    from pares p group by p.mlb
  ) g
$$;

revoke all on function public.reservar_ads_posse(uuid)                                   from public, anon, authenticated;
revoke all on function public.avancar_ads_cursor(uuid, timestamptz, text, text)          from public, anon, authenticated;
revoke all on function public.gravar_ads_lote(uuid, timestamptz, timestamptz, jsonb)     from public, anon, authenticated;
revoke all on function public.concluir_ads_rodada(uuid, timestamptz, text, text, boolean, bigint, date, numeric, numeric) from public, anon, authenticated;
revoke all on function public.limpar_ads_retencao(date)                                   from public, anon, authenticated;
grant execute on function public.reservar_ads_posse(uuid)                                to service_role;
grant execute on function public.avancar_ads_cursor(uuid, timestamptz, text, text)       to service_role;
grant execute on function public.gravar_ads_lote(uuid, timestamptz, timestamptz, jsonb)  to service_role;
grant execute on function public.concluir_ads_rodada(uuid, timestamptz, text, text, boolean, bigint, date, numeric, numeric) to service_role;
grant execute on function public.limpar_ads_retencao(date)                                to service_role;
revoke all on function public.vendas_sku_codigos_mlbs(text[]) from public, anon;
grant execute on function public.vendas_sku_codigos_mlbs(text[]) to authenticated;
