-- I2 Painel de Ads (ADR-0179, spike 054): série diária do anunciante, leitura do painel e menu `ads`.

create table public.ml_ads_conta_dia (
  org_id          uuid not null references public.organizations(id) on delete cascade,
  dia             date not null,
  cost            numeric not null check (cost >= 0),
  clicks          integer not null check (clicks >= 0),
  prints          integer not null check (prints >= 0),
  direct_amount   numeric not null check (direct_amount >= 0),
  indirect_amount numeric not null check (indirect_amount >= 0),
  total_amount    numeric not null check (total_amount >= 0),
  coletado_em     timestamptz not null,
  primary key (org_id, dia)
);
alter table public.ml_ads_sync add column conta_cobertura_desde date;  -- 1º dia da série da conta

alter table public.ml_ads_conta_dia enable row level security;
create policy "ml_ads_conta_dia: select org" on public.ml_ads_conta_dia for select to authenticated
  using (org_id = (select public.current_org_id()));
revoke all on public.ml_ads_conta_dia from anon;
revoke insert, update, delete, truncate, references, trigger on public.ml_ads_conta_dia from authenticated;
grant select on public.ml_ads_conta_dia to authenticated;

-- Só a rodada dona grava (mesmo lock de gravar_ads_lote). A série é densa (spike 054): cada dia vem com zero
-- explícito. A 1ª gravação define conta_cobertura_desde; depois a janela relida sempre encosta no último ok.
create function public.gravar_ads_conta_dias(p_org uuid, p_rodada timestamptz, p_coletado_em timestamptz, p_dias jsonb)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.ml_ads_sync s where s.org_id = p_org and s.rodada = p_rodada for update;
  if not found then return false; end if;
  insert into public.ml_ads_conta_dia as a (org_id, dia, cost, clicks, prints, direct_amount, indirect_amount,
                                             total_amount, coletado_em)
  select distinct on (x.dia) p_org, x.dia, x.cost, x.clicks, x.prints, x.direct_amount, x.indirect_amount,
         x.total_amount, p_coletado_em
    from jsonb_to_recordset(coalesce(p_dias, '[]'::jsonb)) as x(dia date, cost numeric, clicks integer, prints integer,
         direct_amount numeric, indirect_amount numeric, total_amount numeric)
   order by x.dia
  on conflict (org_id, dia) do update
    set cost = excluded.cost, clicks = excluded.clicks, prints = excluded.prints,
        direct_amount = excluded.direct_amount, indirect_amount = excluded.indirect_amount,
        total_amount = excluded.total_amount, coletado_em = excluded.coletado_em
    where excluded.coletado_em >= a.coletado_em;
  update public.ml_ads_sync
     set conta_cobertura_desde = coalesce(conta_cobertura_desde,
           (select min((e->>'dia')::date) from jsonb_array_elements(p_dias) e))
   where org_id = p_org;
  return true;
end $$;

-- Retenção: mesma regra de 13 meses, agora também para a série da conta.
create or replace function public.limpar_ads_retencao(p_corte date)
returns void
language sql security definer set search_path = '' as $$
  delete from public.ml_ads_grupo_dia where dia < p_corte;
  update public.ml_ads_sync set cobertura_desde = p_corte where cobertura_desde < p_corte;
  delete from public.ml_ads_grupo g
   where g.atualizado_em < p_corte
     and not exists (select 1 from public.ml_ads_grupo_dia d where d.org_id = g.org_id and d.ad_group_id = g.ad_group_id);
  delete from public.ml_ads_conta_dia where dia < p_corte;
  update public.ml_ads_sync set conta_cobertura_desde = p_corte where conta_cobertura_desde < p_corte;
$$;

-- Leitura do painel /ads: tudo somado no servidor (Avil: ~300 grupos × 90 dias passaria do teto de 1.000
-- linhas do PostgREST). Grupo entra se teve gasto ou venda atribuída no período; membros = vínculo atual.
create function public.ads_painel(p_desde date, p_ate date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := public.current_org_id();
begin
  -- 90 dias inclusivos no máximo (presets 7/30/90); org resolvida uma vez.
  if p_desde is null or p_ate is null or p_desde > p_ate or p_ate - p_desde > 89 then
    raise exception 'ads_painel: período inválido (%, %)', p_desde, p_ate;
  end if;
  if v_org is null then raise exception 'ads_painel: sem organização'; end if;
  return jsonb_build_object(
    'sync', (select jsonb_build_object('estado', s.estado, 'erro', s.erro, 'ultimo_ok_em', s.ultimo_ok_em,
               'carga_inicial_ok', s.carga_inicial_ok, 'cobertura_desde', s.cobertura_desde,
               'conta_cobertura_desde', s.conta_cobertura_desde)
               from public.ml_ads_sync s where s.org_id = v_org),
    'conta', coalesce((select jsonb_agg(jsonb_build_object('dia', d.dia, 'cost', d.cost, 'clicks', d.clicks,
               'prints', d.prints, 'direct_amount', d.direct_amount, 'indirect_amount', d.indirect_amount,
               'total_amount', d.total_amount, 'coletado_em', d.coletado_em) order by d.dia)
               from public.ml_ads_conta_dia d where d.org_id = v_org and d.dia between p_desde and p_ate), '[]'::jsonb),
    'grupos', coalesce((select jsonb_agg(jsonb_build_object('ad_group_id', x.ad_group_id, 'tipo', g.tipo,
               'status', g.status, 'cost', x.cost, 'clicks', x.clicks, 'prints', x.prints,
               'direct_amount', x.direct_amount, 'indirect_amount', x.indirect_amount, 'total_amount', x.total_amount,
               'membros', coalesce((select jsonb_agg(i.ml_item_id order by i.ml_item_id) from public.ml_ads_grupo_item i
                                     where i.org_id = v_org and i.ad_group_id = x.ad_group_id), '[]'::jsonb))
               order by x.cost desc, x.ad_group_id)
             from (select d.ad_group_id, sum(d.cost) cost, sum(d.clicks) clicks, sum(d.prints) prints,
                          sum(d.direct_amount) direct_amount, sum(d.indirect_amount) indirect_amount,
                          sum(d.total_amount) total_amount
                     from public.ml_ads_grupo_dia d
                    where d.org_id = v_org and d.dia between p_desde and p_ate
                    group by d.ad_group_id
                   having sum(d.cost) > 0 or sum(d.total_amount) > 0) x
             join public.ml_ads_grupo g on g.org_id = v_org and g.ad_group_id = x.ad_group_id), '[]'::jsonb));
end $$;

-- Aviso do dossiê SKU (D2): só os totais, sem a lista de grupos. O dossiê aceita períodos maiores (até 1 ano).
create function public.ads_resumo_periodo(p_desde date, p_ate date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := public.current_org_id();
begin
  if p_desde is null or p_ate is null or p_desde > p_ate or p_ate - p_desde > 365 then
    raise exception 'ads_resumo_periodo: período inválido (%, %)', p_desde, p_ate;
  end if;
  if v_org is null then raise exception 'ads_resumo_periodo: sem organização'; end if;
  return jsonb_build_object(
    'custo_conta', (select coalesce(sum(d.cost), 0) from public.ml_ads_conta_dia d
                     where d.org_id = v_org and d.dia between p_desde and p_ate),
    'dias_conta', (select count(*) from public.ml_ads_conta_dia d
                     where d.org_id = v_org and d.dia between p_desde and p_ate),
    'custo_grupos_com_membro', (select coalesce(sum(d.cost), 0) from public.ml_ads_grupo_dia d
                     where d.org_id = v_org and d.dia between p_desde and p_ate
                       and exists (select 1 from public.ml_ads_grupo_item i
                                    where i.org_id = v_org and i.ad_group_id = d.ad_group_id)));
end $$;

revoke all on function public.gravar_ads_conta_dias(uuid, timestamptz, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.gravar_ads_conta_dias(uuid, timestamptz, timestamptz, jsonb) to service_role;
revoke all on function public.ads_painel(date, date) from public, anon;
grant execute on function public.ads_painel(date, date) to authenticated;
revoke all on function public.ads_resumo_periodo(date, date) from public, anon;
grant execute on function public.ads_resumo_periodo(date, date) to authenticated;
