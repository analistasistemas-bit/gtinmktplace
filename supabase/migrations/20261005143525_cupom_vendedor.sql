-- ADR-0180: cupom bancado pelo vendedor (MP fee_details coupon_fee/collector).
-- ml_vendas.cupom_vendedor: null = MP não lido (preservado como estorno); já descontado de `liquido`.
-- ml_vendas_itens.cupom_vendedor: rateio da order pelos itens (toda order do ML tem 1 item na prática).
alter table public.ml_vendas add column if not exists cupom_vendedor numeric;
alter table public.ml_vendas_itens add column if not exists cupom_vendedor numeric not null default 0;

comment on column public.ml_vendas.cupom_vendedor is
  'ADR-0180: cupom pago pelo vendedor (MP coupon_fee/collector). null = MP não lido. Já descontado de liquido.';
comment on column public.ml_vendas_itens.cupom_vendedor is
  'ADR-0180: fatia do cupom do vendedor da order neste item. Valor do item = unit_price*quantity - cupom_vendedor.';

-- Vitrine: receita sem o cupom do vendedor. Cópia de 20261003232750_vitrine_identificacao.sql com
-- só a linha da receita trocada.
create or replace function public.vitrine_resumo(p_inicio date, p_fim date)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_inicio is null or p_fim is null or p_fim < p_inicio or p_fim - p_inicio > 181 then
    raise exception 'vitrine_resumo: período inválido (% a %), máximo 182 dias', p_inicio, p_fim;
  end if;

  return (
    with org as (select public.current_org_id() as id),
    j as (
      select p_inicio as ini, p_fim as fim,
             p_inicio - (p_fim - p_inicio + 1) as ant_ini
    ),
    vis_raw as (
      select v.ml_item_id, v.dia, v.visitas, v.estado
      from public.ml_item_visitas_dia v cross join org cross join j
      where v.org_id = org.id and v.dia between j.ant_ini and j.fim
    ),
    -- grade: todo MLB com ≥ 1 linha na janela × todos os dias; dia sem linha = não-ok
    grade as (
      select m.ml_item_id, d::date as dia
      from (select distinct ml_item_id from vis_raw) m
      cross join j
      cross join generate_series(j.ant_ini, j.fim, interval '1 day') d
    ),
    ped as (
      select coalesce(s.kit_item_id, i.ml_item_id) as ml_item_id,   -- kit conta no MLB do kit
             (s.date_closed at time zone 'America/Sao_Paulo')::date as dia,
             -- kit virtual: o ML emite 1 order por componente, ligadas pelo pack_id → 1 pedido por pack
             count(distinct case when s.kit_item_id is not null then coalesce(s.pack_id::text, s.id::text)
                                 else s.id::text end) as pedidos,
             sum(i.quantity * i.unit_price - i.cupom_vendedor) as receita   -- ADR-0180
      from public.ml_vendas s
      join public.ml_vendas_itens i on i.venda_id = s.id and i.org_id = s.org_id
      cross join org cross join j
      where s.org_id = org.id
        and s.status in ('paid', 'partially_refunded', 'refunded')
        and s.date_closed >= (j.ant_ini::timestamp at time zone 'America/Sao_Paulo')
        and s.date_closed <  ((j.fim + 1)::timestamp at time zone 'America/Sao_Paulo')
      group by 1, 2
    ),
    base as (
      select g.ml_item_id, g.dia,
             coalesce(v.estado = 'ok', false) as ok,
             case when v.estado = 'ok' then coalesce(v.visitas, 0) else 0 end as visitas,
             case when v.estado = 'ok' then coalesce(p.pedidos, 0) else 0 end as pedidos,
             case when v.estado = 'ok' then coalesce(p.receita, 0) else 0 end as receita,
             g.dia >= j.ini as atual,
             g.dia > j.fim - 7 as ult7
      from grade g
      cross join j
      left join vis_raw v on v.ml_item_id = g.ml_item_id and v.dia = g.dia
      left join ped p on p.ml_item_id = g.ml_item_id and p.dia = g.dia
    ),
    agg as (
      select ml_item_id,
        coalesce(sum(visitas) filter (where atual), 0)     as visitas,
        coalesce(sum(pedidos) filter (where atual), 0)     as pedidos,
        coalesce(sum(receita) filter (where atual), 0)     as receita,
        count(*) filter (where atual and ok)               as pares_ok,
        count(*) filter (where atual)                      as pares_total,
        coalesce(sum(visitas) filter (where not atual), 0) as visitas_ant,
        coalesce(sum(pedidos) filter (where not atual), 0) as pedidos_ant,
        coalesce(sum(receita) filter (where not atual), 0) as receita_ant,
        count(*) filter (where not atual and ok)           as pares_ok_ant,
        count(*) filter (where not atual)                  as pares_total_ant,
        coalesce(sum(visitas) filter (where ult7), 0)      as visitas_ult7,
        count(*) filter (where ult7 and ok)                as dias_ok_ult7
      from base group by ml_item_id
    ),
    -- título/código/link: as mesmas fontes do inventário do coletor (coletar-trafego-ml/deps.ts:97-109):
    -- Legacy, filhos UP, kit virtual, listings de catálogo (UP e opt-in) e família. Cada campo escolhe a
    -- fonte de menor prio que TEM o valor (fonte com o campo nulo não bloqueia a seguinte).
    fontes as (
      select ae.item_externo_id as ml_item_id, ae.titulo, ae.codigo_pai, ae.permalink, 1 as prio, ae.criado_em
      from public.anuncios_externos ae cross join org
      where ae.org_id = org.id and ae.item_externo_id is not null
      union all
      select aei.item_externo_id, ae.titulo, ae.codigo_pai, aei.permalink, 2, ae.criado_em
      from public.anuncios_externos_itens aei
      join public.anuncios_externos ae on ae.id = aei.anuncio_externo_id and ae.org_id = aei.org_id
      cross join org
      where aei.org_id = org.id and aei.item_externo_id is not null
      union all
      select kv.ml_item_id, kv.titulo, null::text, null::text, 3, null::timestamptz
      from public.kits_virtuais kv cross join org
      where kv.org_id = org.id and kv.ml_item_id is not null
      union all
      -- aei.permalink é do item_externo_id original, não do catalog_listing_id: usá-lo abriria outro anúncio
      select aei.catalog_listing_id, ae.titulo, ae.codigo_pai, null::text, 4, ae.criado_em
      from public.anuncios_externos_itens aei
      join public.anuncios_externos ae on ae.id = aei.anuncio_externo_id and ae.org_id = aei.org_id
      cross join org
      where aei.org_id = org.id and aei.catalog_listing_id is not null
      union all
      select f.ml_item_id, f.titulo_ml, f.codigo_pai, null::text, 5, null::timestamptz
      from public.familias f cross join org
      where f.org_id = org.id and f.ml_item_id is not null
      union all
      select va.catalog_listing_id, f.titulo_ml, f.codigo_pai, null::text, 6, null::timestamptz
      from public.variacoes va
      join public.familias f on f.id = va.familia_id
      cross join org
      where f.org_id = org.id and va.catalog_listing_id is not null
    ),
    info_cod as (
      select distinct on (ml_item_id) ml_item_id, codigo_pai from fontes
      where codigo_pai is not null order by ml_item_id, prio, criado_em desc nulls last
    ),
    info_tit as (
      select distinct on (ml_item_id) ml_item_id, titulo from fontes
      where titulo is not null order by ml_item_id, prio, criado_em desc nulls last
    ),
    info_link as (
      select distinct on (ml_item_id) ml_item_id, permalink from fontes
      where permalink is not null order by ml_item_id, prio, criado_em desc nulls last
    ),
    titulo_venda as (
      select i.ml_item_id, max(i.titulo) as titulo
      from public.ml_vendas_itens i cross join org
      where i.org_id = org.id and i.ml_item_id in (select ml_item_id from agg)
      group by 1
    ),
    -- variação: fallback pela cor da venda mais recente do MLB (quando o ML não deu COLOR/SIZE)
    cor_venda as (
      select distinct on (i.ml_item_id) i.ml_item_id, i.cor
      from public.ml_vendas_itens i
      join public.ml_vendas s on s.id = i.venda_id and s.org_id = i.org_id
      cross join org
      where i.org_id = org.id and i.cor is not null and nullif(trim(i.cor), '') is not null
        and i.ml_item_id in (select ml_item_id from agg)
      order by i.ml_item_id, s.date_closed desc nulls last
    ),
    ads as (
      select distinct gi.ml_item_id
      from public.ml_ads_grupo_item gi
      join public.ml_ads_grupo g on g.org_id = gi.org_id and g.ad_group_id = gi.ad_group_id
      cross join org
      where gi.org_id = org.id and g.status = 'ACTIVE'  -- valor real em prod é maiúsculo (IDLE/PAUSED/HOLD/EMPTY fora)
    )
    select jsonb_build_object(
      'inicio', (select ini from j),
      'fim',    (select fim from j),
      'itens', coalesce((
        select jsonb_agg(jsonb_build_object(
          'ml_item_id', a.ml_item_id,
          'titulo', coalesce(nullif(trim(t.titulo), ''), it.titulo, tv.titulo),
          'codigo_pai', ic.codigo_pai,
          'variacao', coalesce(nullif(trim(t.variacao), ''), cv.cor),
          'permalink', coalesce(t.permalink, il.permalink),
          'status', t.status,
          'em_ads', ads.ml_item_id is not null,
          'visitas', a.visitas, 'pedidos', a.pedidos, 'receita', a.receita,
          'pares_ok', a.pares_ok, 'pares_total', a.pares_total,
          'visitas_ant', a.visitas_ant, 'pedidos_ant', a.pedidos_ant, 'receita_ant', a.receita_ant,
          'pares_ok_ant', a.pares_ok_ant, 'pares_total_ant', a.pares_total_ant,
          'visitas_ult7', a.visitas_ult7, 'dias_ok_ult7', a.dias_ok_ult7))
        from agg a
        cross join org
        left join info_cod ic on ic.ml_item_id = a.ml_item_id
        left join info_tit it on it.ml_item_id = a.ml_item_id
        left join info_link il on il.ml_item_id = a.ml_item_id
        left join cor_venda cv on cv.ml_item_id = a.ml_item_id
        left join titulo_venda tv on tv.ml_item_id = a.ml_item_id
        left join public.ml_trafego_item t on t.org_id = org.id and t.ml_item_id = a.ml_item_id
        left join ads on ads.ml_item_id = a.ml_item_id), '[]'::jsonb),
      'semanas', coalesce((
        select jsonb_agg(jsonb_build_object('semana', s.semana, 'visitas', s.visitas, 'pedidos', s.pedidos,
                                            'receita', s.receita, 'pares_ok', s.pares_ok, 'pares_total', s.pares_total)
                         order by s.semana)
        from (select date_trunc('week', dia)::date as semana,
                     sum(visitas) as visitas, sum(pedidos) as pedidos, sum(receita) as receita,
                     count(*) filter (where ok) as pares_ok, count(*) as pares_total
              from base where atual group by 1) s), '[]'::jsonb),
      'dias_semana', coalesce((
        select jsonb_agg(jsonb_build_object('dow', d.dow, 'visitas', d.visitas, 'pedidos', d.pedidos,
                                            'semanas', d.semanas, 'pares_ok', d.pares_ok, 'pares_total', d.pares_total)
                         order by d.dow)
        from (select extract(isodow from dia)::int as dow,
                     sum(visitas) as visitas, sum(pedidos) as pedidos,
                     count(distinct dia) filter (where ok) as semanas,
                     count(*) filter (where ok) as pares_ok, count(*) as pares_total
              from base where atual group by 1) d), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.vitrine_resumo(date, date) from public, anon;
grant execute on function public.vitrine_resumo(date, date) to authenticated;
