-- ADR-0172: enriquecimento por código para a aba Vendas SKU. Não calcula dinheiro — o lucro vem
-- dos itens de agruparPorPedido no navegador (D-5). Família mais recente por (org, codigo), a mesma
-- âncora do estoque canônico (ADR-0025). Primeira/última venda só de orders faturáveis
-- (mesma lista de ehFaturavel: paid, partially_refunded, refunded).
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
      (f.kit_multiplicador is not null) as eh_kit
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
    'ultima_venda', vd.ultima
  )
  from canonica c
  left join vendas vd on vd.codigo = c.codigo
  order by c.codigo
$$;
revoke all on function public.vendas_sku_catalogo() from public, anon;
grant execute on function public.vendas_sku_catalogo() to authenticated;
