-- ADR-0172 Fatia 2a: seleção para o dossiê do SKU. Não calcula dinheiro: devolve ids para o navegador
-- buscar as vendas completas e rodar agruparPorPedido (packs/envios inteiros, para o rateio de frete
-- ser o mesmo da aba Vendas). As duas RPCs com argumento devolvem UM valor (uuid[]/jsonb) e são
-- chamadas por POST: valor escalar não sofre o teto de 1.000 linhas do PostgREST.
create index if not exists ml_vendas_itens_org_codigo_idx on public.ml_vendas_itens (org_id, codigo);
create index if not exists ml_vendas_org_pack_idx on public.ml_vendas (org_id, pack_id) where pack_id is not null;
create index if not exists ml_vendas_org_shipping_idx on public.ml_vendas (org_id, shipping_id) where shipping_id is not null;

create or replace function public.vendas_sku_dossie_ids(p_codigos text[])
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  with org as (select public.current_org_id() as id),
  base as (
    select s.id, s.pack_id, s.shipping_id
    from public.ml_vendas_itens i
    join public.ml_vendas s on s.id = i.venda_id
    cross join org
    where i.org_id = org.id and s.org_id = org.id and i.codigo = any (p_codigos)
  )
  select coalesce(array_agg(distinct s.id order by s.id), '{}')
  from public.ml_vendas s
  cross join org
  where s.org_id = org.id
    and (
      s.id in (select b.id from base b)
      or s.pack_id in (select b.pack_id from base b where b.pack_id is not null)
      or s.shipping_id in (select b.shipping_id from base b where b.shipping_id is not null)
    )
$$;

create or replace function public.vendas_sku_mlbs(p_codigos text[])
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with org as (select public.current_org_id() as id),
  mlbs as (
    select i.ml_item_id as mlb from public.ml_vendas_itens i cross join org
     where i.org_id = org.id and i.codigo = any (p_codigos) and i.ml_item_id is not null
    union
    select x.item_externo_id from public.anuncios_externos_itens x cross join org
     where x.org_id = org.id and x.sku = any (p_codigos) and x.item_externo_id is not null
    union
    select a.item_externo_id from public.anuncios_externos a cross join org
     where a.org_id = org.id and a.item_externo_id is not null
       and a.variacoes_externas ?| p_codigos
    union
    -- MLB encerrado pela migração PxV (ADR-0161): o snapshot é array de objetos {id, sku, cor}
    -- (migrar-preco-por-variacao lerVariacoes; lido por fundirAnunciosMigrados).
    select a.ml_item_id_anterior from public.anuncios_externos a
      cross join org
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(a.migracao_pxv_snapshot) = 'array' then a.migracao_pxv_snapshot else '[]'::jsonb end
      ) as e(v)
     where a.org_id = org.id and a.ml_item_id_anterior is not null
       and (e.v ->> 'sku') = any (p_codigos)
  ),
  pares as (
    select i.ml_item_id as mlb, i.codigo from public.ml_vendas_itens i cross join org
     where i.org_id = org.id and i.ml_item_id in (select mlb from mlbs) and coalesce(i.codigo, '') <> ''
    union
    select x.item_externo_id, x.sku from public.anuncios_externos_itens x cross join org
     where x.org_id = org.id and x.item_externo_id in (select mlb from mlbs) and coalesce(x.sku, '') <> ''
    union
    select a.item_externo_id, k.codigo from public.anuncios_externos a
      cross join org
      cross join lateral jsonb_object_keys(
        case when jsonb_typeof(a.variacoes_externas) = 'object' then a.variacoes_externas else '{}'::jsonb end
      ) as k(codigo)
     where a.org_id = org.id and a.item_externo_id in (select mlb from mlbs)
    union
    select a.ml_item_id_anterior, e.v ->> 'sku' from public.anuncios_externos a
      cross join org
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(a.migracao_pxv_snapshot) = 'array' then a.migracao_pxv_snapshot else '[]'::jsonb end
      ) as e(v)
     where a.org_id = org.id and a.ml_item_id_anterior in (select mlb from mlbs)
       and coalesce(e.v ->> 'sku', '') <> ''
  )
  select coalesce(jsonb_object_agg(g.mlb, g.codigos), '{}'::jsonb)
  from (
    select p.mlb, to_jsonb(array_agg(distinct p.codigo order by p.codigo)) as codigos
    from pares p group by p.mlb
  ) g
$$;

revoke all on function public.vendas_sku_dossie_ids(text[]) from public, anon;
revoke all on function public.vendas_sku_mlbs(text[]) from public, anon;
grant execute on function public.vendas_sku_dossie_ids(text[]) to authenticated;
grant execute on function public.vendas_sku_mlbs(text[]) to authenticated;

-- Corpo de 20260927024030_vendas_sku_catalogo.sql + kit vinculado: saldo = floor(estoque da ÚNICA
-- variação da família-base canônica / N), a mesma regra de aplicarEstoqueDerivado
-- (_shared/estoque/kit.ts). Base ausente ou com ≠ 1 variação → kit_base_codigo null e estoque_kit 0.
create or replace function public.vendas_sku_catalogo()
returns setof json
language sql stable security definer
set search_path = ''
as $$
  with org as (
    select public.current_org_id() as id
  ),
  canonica as (
    select distinct on (v.codigo)
      v.codigo, v.nome, v.cor, v.tamanho, v.estoque,
      f.codigo_pai, f.nome_pai, f.fornecedor, f.origem,
      (f.kit_multiplicador is not null) as eh_kit,
      f.kit_base_codigo_pai, f.kit_multiplicador
    from public.variacoes v
    join public.familias f on f.id = v.familia_id
    cross join org
    where v.org_id = org.id and f.org_id = org.id
    order by v.codigo, f.criado_em desc, f.id desc
  ),
  vendas as (
    select i.codigo, min(s.date_closed) as primeira, max(s.date_closed) as ultima
    from public.ml_vendas s
    join public.ml_vendas_itens i on i.venda_id = s.id
    cross join org
    where s.org_id = org.id
      and s.status in ('paid', 'partially_refunded', 'refunded')
      and coalesce(i.codigo, '') <> ''
    group by i.codigo
  )
  select json_build_object(
    'codigo', c.codigo,
    'codigo_pai', c.codigo_pai,
    'nome_familia', c.nome_pai,
    'nome', coalesce(c.nome, c.nome_pai),
    'cor', c.cor,
    'tamanho', c.tamanho,
    'estoque', c.estoque,
    'fornecedor', c.fornecedor,
    'origem', c.origem,
    'eh_kit', c.eh_kit,
    'primeira_venda', vd.primeira,
    'ultima_venda', vd.ultima,
    'kit_multiplicador', c.kit_multiplicador,
    'kit_base_codigo', case when kb.n = 1 then kb.codigo end,
    'estoque_kit', case
      when c.kit_multiplicador is null then null
      when kb.n = 1 and c.kit_multiplicador > 0
        then greatest(0, floor(kb.estoque::numeric / c.kit_multiplicador))::int
      else 0
    end
  )
  from canonica c
  left join vendas vd on vd.codigo = c.codigo
  left join lateral (
    select count(*) as n, min(vb.codigo) as codigo, min(vb.estoque) as estoque
    from (
      select fb.id from public.familias fb
      where fb.org_id = (select id from org) and fb.codigo_pai = c.kit_base_codigo_pai
      order by fb.criado_em desc, fb.id desc
      limit 1
    ) base
    join public.variacoes vb on vb.familia_id = base.id
  ) kb on c.kit_multiplicador is not null
  order by c.codigo
$$;
revoke all on function public.vendas_sku_catalogo() from public, anon;
grant execute on function public.vendas_sku_catalogo() to authenticated;
