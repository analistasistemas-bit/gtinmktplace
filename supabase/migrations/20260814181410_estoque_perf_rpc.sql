-- Estoque performance: agregação server-side da tela Estoque (família canônica por codigo_pai).
-- Refs: ADR-0025 (família mais recente), ADR-0094 (E6b estoque).

-- ----------------------------------------------------------------------------
-- A) Resumo da org: KPIs + lista slim de produtos (sem variações).
-- ----------------------------------------------------------------------------
create or replace function public.produtos_estoque_resumo()
returns json
language sql stable security definer
set search_path = ''
as $$
  with org as (
    select public.current_org_id() as id
  ),
  canonical as (
    select distinct on (f.codigo_pai)
      f.id,
      f.codigo_pai,
      f.nome_pai,
      f.descricao_pai,
      f.capa_storage_path,
      f.capa_ml_picture_id,
      f.variacao_principal_codigo,
      f.fornecedor,
      f.unidade,
      f.origem,
      f.ml_item_id,
      f.criado_em
    from public.familias f
    cross join org
    where f.org_id = org.id
    order by f.codigo_pai, f.criado_em desc
  ),
  vars as (
    select
      v.familia_id,
      v.codigo,
      v.cor,
      v.gtin,
      v.estoque,
      v.custo,
      v.imagem_path,
      v.ml_picture_id
    from public.variacoes v
    cross join org
    join canonical c on c.id = v.familia_id
    where v.org_id = org.id
  ),
  capa as (
    select
      c.id as familia_id,
      coalesce(
        c.capa_storage_path,
        (select vp.imagem_path from vars vp
          where vp.familia_id = c.id and vp.codigo = c.variacao_principal_codigo
            and vp.imagem_path is not null limit 1),
        (select vp.imagem_path from vars vp
          where vp.familia_id = c.id and vp.imagem_path is not null
          order by vp.codigo limit 1)
      ) as capa_storage_path,
      coalesce(
        c.capa_ml_picture_id,
        (select vp.ml_picture_id from vars vp
          where vp.familia_id = c.id and vp.codigo = c.variacao_principal_codigo
            and vp.ml_picture_id is not null limit 1),
        (select vp.ml_picture_id from vars vp
          where vp.familia_id = c.id and vp.ml_picture_id is not null
          order by vp.codigo limit 1)
      ) as capa_ml_picture_id
    from canonical c
  ),
  produtos as (
    select
      c.codigo_pai,
      c.nome_pai,
      c.descricao_pai,
      coalesce(sum(v.estoque), 0)::bigint as saldo_total,
      count(v.codigo)::int as qtd_skus,
      cap.capa_storage_path,
      cap.capa_ml_picture_id,
      c.fornecedor,
      c.unidade,
      c.origem::text as origem,
      c.ml_item_id,
      c.criado_em,
      coalesce(array_agg(v.gtin order by v.codigo) filter (where v.gtin is not null), '{}') as gtins,
      coalesce(array_agg(v.codigo order by v.codigo), '{}') as codigos,
      coalesce(array_agg(v.cor order by v.codigo) filter (where v.cor is not null), '{}') as cores,
      case when count(v.codigo) = 1 then max(v.codigo) else null end as sku_unico
    from canonical c
    join capa cap on cap.familia_id = c.id
    left join vars v on v.familia_id = c.id
    group by
      c.codigo_pai, c.nome_pai, c.descricao_pai,
      cap.capa_storage_path, cap.capa_ml_picture_id,
      c.fornecedor, c.unidade, c.origem, c.ml_item_id, c.criado_em
  ),
  kpis as (
    select
      (select count(*) from produtos)::int as produtos,
      count(v.codigo)::int as skus,
      coalesce(sum(v.estoque) filter (where v.estoque > 0), 0)::bigint as unidades,
      count(v.codigo) filter (where v.estoque <= 0)::int as skus_sem_estoque,
      coalesce(sum(v.custo * v.estoque) filter (where v.estoque > 0 and v.custo is not null), 0)::numeric as valor_em_estoque,
      count(v.codigo) filter (where v.estoque > 0 and v.custo is null)::int as skus_sem_custo
    from vars v
  )
  select json_build_object(
    'kpis', (select row_to_json(k) from kpis k),
    'produtos', coalesce(
      (select json_agg(
        json_build_object(
          'codigo_pai', p.codigo_pai,
          'nome_pai', p.nome_pai,
          'descricao_pai', p.descricao_pai,
          'saldo_total', p.saldo_total,
          'qtd_skus', p.qtd_skus,
          'capa_storage_path', p.capa_storage_path,
          'capa_ml_picture_id', p.capa_ml_picture_id,
          'fornecedor', p.fornecedor,
          'unidade', p.unidade,
          'origem', p.origem,
          'ml_item_id', p.ml_item_id,
          'criado_em', p.criado_em,
          'gtins', p.gtins,
          'codigos', p.codigos,
          'cores', p.cores,
          'sku_unico', p.sku_unico
        )
        order by p.nome_pai
      ) from produtos p),
      '[]'::json
    )
  )
  from org
  where org.id is not null
$$;
revoke all on function public.produtos_estoque_resumo() from public;
grant execute on function public.produtos_estoque_resumo() to authenticated;

-- ----------------------------------------------------------------------------
-- B) Variações de um produto (família canônica do codigo_pai na org atual).
-- ----------------------------------------------------------------------------
create or replace function public.variacoes_estoque_produto(p_codigo_pai text)
returns setof json
language sql stable security definer
set search_path = ''
as $$
  with org as (
    select public.current_org_id() as id
  ),
  canonical as (
    select f.id
    from public.familias f
    cross join org
    where f.org_id = org.id
      and f.codigo_pai = p_codigo_pai
    order by f.criado_em desc
    limit 1
  )
  select json_build_object(
    'codigo', v.codigo,
    'nome', v.nome,
    'cor', v.cor,
    'gtin', v.gtin,
    'estoque', v.estoque,
    'custo', v.custo,
    'preco', v.preco,
    'peso_gramas', v.peso_gramas,
    'altura_cm', v.altura_cm,
    'largura_cm', v.largura_cm,
    'comprimento_cm', v.comprimento_cm,
    'imagem_path', v.imagem_path,
    'ml_picture_id', v.ml_picture_id
  )
  from public.variacoes v
  cross join org
  join canonical c on c.id = v.familia_id
  where v.org_id = org.id
  order by v.codigo
$$;
revoke all on function public.variacoes_estoque_produto(text) from public;
grant execute on function public.variacoes_estoque_produto(text) to authenticated;

-- ----------------------------------------------------------------------------
-- C) Lista flat de SKUs (picker do DialogEntrada) — famílias canônicas apenas.
-- ----------------------------------------------------------------------------
create or replace function public.skus_estoque_org()
returns setof json
language sql stable security definer
set search_path = ''
as $$
  with org as (
    select public.current_org_id() as id
  ),
  canonical as (
    select distinct on (f.codigo_pai)
      f.id,
      f.codigo_pai,
      f.nome_pai
    from public.familias f
    cross join org
    where f.org_id = org.id
    order by f.codigo_pai, f.criado_em desc
  )
  select json_build_object(
    'codigo', v.codigo,
    'codigo_pai', c.codigo_pai,
    'nome', coalesce(v.nome, c.nome_pai),
    'cor', v.cor,
    'estoque', v.estoque
  )
  from public.variacoes v
  cross join org
  join canonical c on c.id = v.familia_id
  where v.org_id = org.id
  order by c.nome_pai, v.codigo
$$;
revoke all on function public.skus_estoque_org() from public;
grant execute on function public.skus_estoque_org() to authenticated;
