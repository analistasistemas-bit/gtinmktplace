-- ADR-0194 — Sugestões de promoção: dispensa por produto, data de criação do anúncio, marcação de origem
-- da operação e sinais por anúncio (vendas e visitas de 30 dias) para a regra pura do front.

create table if not exists public.promocao_sugestoes_dispensadas (
  org_id         uuid not null references public.organizations(id) on delete cascade,
  chave          text not null,               -- 'p:<codigo_pai>' ou 'a:<ml_item_id>'
  dispensado_por uuid references auth.users(id) on delete set null,
  dispensado_em  timestamptz not null default now(),
  expira_em      timestamptz not null,
  primary key (org_id, chave)
);

alter table public.promocao_sugestoes_dispensadas enable row level security;
drop policy if exists "promocao_sugestoes_dispensadas: select org" on public.promocao_sugestoes_dispensadas;
create policy "promocao_sugestoes_dispensadas: select org" on public.promocao_sugestoes_dispensadas
  for select to authenticated using (org_id = (select public.current_org_id()));
-- Default privileges do Supabase dão ALL (inclui TRUNCATE, que RLS não cobre). Escrita só pela edge (service_role).
revoke all on public.promocao_sugestoes_dispensadas from anon, authenticated;
grant select on public.promocao_sugestoes_dispensadas to authenticated;

alter table public.ml_promocao_itens add column if not exists anuncio_criado_em timestamptz;
comment on column public.ml_promocao_itens.anuncio_criado_em is
  'date_created do anúncio no ML, gravado pelo sync (ADR-0194 D-7).';

alter table public.operacoes_massa add column if not exists sugestao jsonb;
comment on column public.operacoes_massa.sugestao is
  'Marcação de origem (ADR-0194 D-9): { faixa, oportunidade, chave } quando a adesão nasceu de uma sugestão.';

-- Uma linha por anúncio da org. Janela de 30 dias em BRT; conversão só nos pares MLB×dia com estado ok
-- (critério da Vitrine, ADR-0176). Vendas: status faturáveis, kit no MLB do kit (1 por pack).
create or replace function public.sugestoes_promocao_sinais()
returns setof json
language sql stable security definer
set search_path = ''
as $$
  with org as (
    select public.current_org_id() as id
  ),
  j as (
    select (now() at time zone 'America/Sao_Paulo')::date as fim,
           (now() at time zone 'America/Sao_Paulo')::date - 29 as ini
  ),
  vis as (
    select v.ml_item_id, v.dia, v.visitas
    from public.ml_item_visitas_dia v cross join org cross join j
    where v.org_id = org.id and v.estado = 'ok' and v.dia between j.ini and j.fim
  ),
  -- Kit virtual: o ML emite uma order por componente do mesmo pack. Cada grupo conta a quantidade de kits uma vez.
  linhas as (
    select coalesce(s.kit_item_id, i.ml_item_id) as ml_item_id,
           (s.date_closed at time zone 'America/Sao_Paulo')::date as dia,
           case when s.kit_item_id is null then i.id::text else coalesce(s.pack_id::text, s.id::text) end as grupo,
           i.quantity
    from public.ml_vendas s
    join public.ml_vendas_itens i on i.venda_id = s.id and i.org_id = s.org_id
    cross join org cross join j
    where s.org_id = org.id
      and s.status in ('paid', 'partially_refunded', 'refunded')
      and s.date_closed >= (j.ini::timestamp at time zone 'America/Sao_Paulo')
      and s.date_closed <  ((j.fim + 1)::timestamp at time zone 'America/Sao_Paulo')
  ),
  ped as (
    select ml_item_id, dia, sum(q) as unidades
    from (select ml_item_id, dia, grupo, min(quantity) as q from linhas group by 1, 2, 3) g
    group by 1, 2
  ),
  -- Mesmas fontes da Vitrine; prio menor vence. publicado_em alimenta a idade do produto.
  fontes as (
    select ae.item_externo_id as ml_item_id, ae.codigo_pai, 1 as prio, ae.publicado_em
    from public.anuncios_externos ae cross join org
    where ae.org_id = org.id and ae.item_externo_id is not null
    union all
    select aei.item_externo_id, ae.codigo_pai, 2, ae.publicado_em
    from public.anuncios_externos_itens aei
    join public.anuncios_externos ae on ae.id = aei.anuncio_externo_id and ae.org_id = aei.org_id
    cross join org
    where aei.org_id = org.id and aei.item_externo_id is not null
    union all
    select aei.catalog_listing_id, ae.codigo_pai, 3, ae.publicado_em
    from public.anuncios_externos_itens aei
    join public.anuncios_externos ae on ae.id = aei.anuncio_externo_id and ae.org_id = aei.org_id
    cross join org
    where aei.org_id = org.id and aei.catalog_listing_id is not null
    union all
    select f.ml_item_id, f.codigo_pai, 4, f.publicado_em
    from public.familias f cross join org
    where f.org_id = org.id and f.ml_item_id is not null
    union all
    select va.catalog_listing_id, f.codigo_pai, 5, f.publicado_em
    from public.variacoes va
    join public.familias f on f.id = va.familia_id and f.org_id = va.org_id
    cross join org
    where va.org_id = org.id and va.catalog_listing_id is not null
  ),
  -- Família canônica por SKU: a mais recente. Vale para o código das vendas e para o estoque.
  canonica as (
    select distinct on (v.codigo) v.codigo, v.estoque, f.codigo_pai, f.nome_pai, f.kit_multiplicador, f.kit_base_codigo_pai
    from public.variacoes v
    join public.familias f on f.id = v.familia_id and f.org_id = v.org_id
    cross join org
    where v.org_id = org.id
    order by v.codigo, f.criado_em desc, f.id desc
  ),
  por_venda as (
    select distinct on (i.ml_item_id) i.ml_item_id, c.codigo_pai
    from public.ml_vendas_itens i
    join canonica c on c.codigo = i.codigo
    cross join org
    where i.org_id = org.id
    order by i.ml_item_id, i.id desc
  ),
  convites as (
    select p.ml_item_id, min(p.anuncio_criado_em) as criado_em
    from public.ml_promocao_itens p cross join org
    where p.org_id = org.id
    group by 1
  ),
  base as (
    select codigo_pai, count(*) as variacoes, min(estoque) as estoque from canonica group by 1
  ),
  produto as (
    -- Kit deriva o saldo da família-base (regra de vendas_sku_catalogo): floor(estoque da única variação / N).
    -- Base ausente ou com mais de uma variação: saldo desconhecido, não zero.
    select c.codigo_pai, max(c.nome_pai) as nome_pai,
           case when bool_or(c.kit_multiplicador is not null) then
                  max(case when b.variacoes = 1 then floor(b.estoque::numeric / nullif(c.kit_multiplicador, 0)) end)
                else sum(c.estoque) end as estoque
    from canonica c
    left join base b on b.codigo_pai = c.kit_base_codigo_pai
    group by 1
  ),
  universo as (
    select ml_item_id from vis union
    select ml_item_id from ped union
    select ml_item_id from fontes union
    select ml_item_id from convites
  ),
  vis_ag as (
    select ml_item_id, sum(visitas) as visitas_ok, count(*) as dias_ok from vis group by 1
  ),
  ped_ag as (
    select ml_item_id, sum(unidades) as unidades_30d from ped group by 1
  ),
  ped_ok as (
    select p.ml_item_id, sum(p.unidades) as unidades_ok
    from ped p join vis v on v.ml_item_id = p.ml_item_id and v.dia = p.dia
    group by 1
  ),
  ag as (
    select u.ml_item_id,
      coalesce(pa.unidades_30d, 0) as unidades_30d,
      coalesce(va.visitas_ok, 0) as visitas_ok,
      coalesce(po.unidades_ok, 0) as unidades_ok,
      coalesce(va.dias_ok, 0) as dias_ok
    from universo u
    left join vis_ag va on va.ml_item_id = u.ml_item_id
    left join ped_ag pa on pa.ml_item_id = u.ml_item_id
    left join ped_ok po on po.ml_item_id = u.ml_item_id
  ),
  cod as (
    select distinct on (ml_item_id) ml_item_id, codigo_pai from fontes
    where codigo_pai is not null order by ml_item_id, prio
  ),
  datas as (
    select ml_item_id, min(publicado_em) as publicado_em from fontes group by 1
  )
  select json_build_object(
    'ml_item_id', a.ml_item_id,
    'unidades_30d', a.unidades_30d, 'visitas_ok', a.visitas_ok, 'unidades_ok', a.unidades_ok, 'dias_ok', a.dias_ok,
    'ativo', coalesce(t.status = 'active', true),
    'codigo_pai', coalesce(c.codigo_pai, pv.codigo_pai),
    'nome_produto', pr.nome_pai,
    'estoque_produto', pr.estoque,
    'criado_em', least(cv.criado_em, d.publicado_em)
  )
  from ag a
  cross join org
  left join cod c on c.ml_item_id = a.ml_item_id
  left join por_venda pv on pv.ml_item_id = a.ml_item_id
  left join produto pr on pr.codigo_pai = coalesce(c.codigo_pai, pv.codigo_pai)
  left join convites cv on cv.ml_item_id = a.ml_item_id
  left join datas d on d.ml_item_id = a.ml_item_id
  left join public.ml_trafego_item t on t.org_id = org.id and t.ml_item_id = a.ml_item_id
  order by a.ml_item_id
$$;
revoke all on function public.sugestoes_promocao_sinais() from public, anon;
grant execute on function public.sugestoes_promocao_sinais() to authenticated;
