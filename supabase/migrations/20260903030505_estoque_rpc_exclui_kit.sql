-- ADR-0151 D-13: kit vinculado nunca aparece como produto/SKU próprio na tela Estoque — só sob
-- o contexto do produto-base (`variacoes_estoque_produto` devolve `kits: [...]`), calculado ao
-- vivo a partir do saldo da base. Espelhar o valor numa coluna do kit foi REJEITADO: criaria um
-- segundo número que pode dessincronizar da fonte de verdade (risco do ADR-0129).
--
-- Base de cada `create or replace` é a ÚLTIMA definição real de cada RPC (não a migration
-- original) — copiar da errada reverte campos vivos em produção, como já aconteceu com
-- `produtos_estoque_resumo` (ver cabeçalho de 20260826063450_estoque_resumo_nomes_fiscal_fix.sql):
--   - produtos_estoque_resumo()      <- 20260826063450 (fiscal + `nomes`)
--   - variacoes_estoque_produto(text) <- 20260816230056 (ponteiro `ml_item_id`)
--   - skus_estoque_org()             <- 20260814181410 (original, nunca redefinida)
-- Re-run-safe: db push não é transacional.

-- ----------------------------------------------------------------------------
-- A) Resumo da org: KPIs + lista slim. Kit deixa de contar em produtos/skus/unidades/
--    skus_sem_estoque/valor_em_estoque/skus_sem_custo — o filtro entra na CTE `canonical` e
--    propaga para `vars` (join) e daí para `kpis`.
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
      f.criado_em,
      f.ncm,
      f.cest,
      f.origem_nfe,
      f.fci,
      f.tributacao_icms,
      f.tributacao_icms_regime,
      f.can_invoice
    from public.familias f
    cross join org
    where f.org_id = org.id
      and f.kit_multiplicador is null
    order by f.codigo_pai, f.criado_em desc
  ),
  vars as (
    select
      v.familia_id,
      v.codigo,
      v.nome,
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
      c.id as familia_id,
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
      c.ncm,
      c.cest,
      c.origem_nfe,
      c.fci,
      c.tributacao_icms,
      c.tributacao_icms_regime,
      c.can_invoice,
      coalesce(array_agg(v.gtin order by v.codigo) filter (where v.gtin is not null), '{}') as gtins,
      coalesce(array_agg(v.codigo order by v.codigo), '{}') as codigos,
      coalesce(array_agg(v.cor order by v.codigo) filter (where v.cor is not null), '{}') as cores,
      coalesce(array_agg(v.nome order by v.codigo) filter (where v.nome is not null), '{}') as nomes,
      case when count(v.codigo) = 1 then max(v.codigo) else null end as sku_unico
    from canonical c
    join capa cap on cap.familia_id = c.id
    left join vars v on v.familia_id = c.id
    group by
      c.id, c.codigo_pai, c.nome_pai, c.descricao_pai,
      cap.capa_storage_path, cap.capa_ml_picture_id,
      c.fornecedor, c.unidade, c.origem, c.ml_item_id, c.criado_em,
      c.ncm, c.cest, c.origem_nfe, c.fci, c.tributacao_icms, c.tributacao_icms_regime, c.can_invoice
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
          'familia_id', p.familia_id,
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
          'nomes', p.nomes,
          'sku_unico', p.sku_unico,
          'ncm', p.ncm,
          'cest', p.cest,
          'origem_nfe', p.origem_nfe,
          'fci', p.fci,
          'tributacao_icms', p.tributacao_icms,
          'tributacao_icms_regime', p.tributacao_icms_regime,
          'can_invoice', p.can_invoice
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
-- B) Variações de um produto (família canônica do codigo_pai). Kit não pode ser o
--    `p_codigo_pai` de uma consulta (canonical não resolve pra ele), e cada linha ganha
--    `kits`: saldo virtual dos kits vinculados a ESTA base, calculado ao vivo. Não soma
--    variações: kit vinculado só existe para produto de UMA variação (D-10), então
--    `v.estoque` já é o saldo da base.
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
    select f.id, f.ml_item_id
    from public.familias f
    cross join org
    where f.org_id = org.id
      and f.codigo_pai = p_codigo_pai
      and f.kit_multiplicador is null
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
    'ml_picture_id', v.ml_picture_id,
    'ml_item_id', coalesce(
      (
        select i.item_externo_id
        from public.anuncios_externos_itens i
        join public.anuncios_externos ae on ae.id = i.anuncio_externo_id
        where i.org_id = org.id
          and ae.codigo_pai = p_codigo_pai
          and i.sku = v.codigo
          and not i.retirado
          and i.item_externo_id is not null
        limit 1
      ),
      (
        select ae.item_externo_id
        from public.anuncios_externos ae
        where ae.org_id = org.id
          and ae.codigo_pai = p_codigo_pai
          and ae.item_externo_id is not null
          and jsonb_exists(ae.variacoes_externas, v.codigo)
        order by ae.atualizado_em desc
        limit 1
      ),
      c.ml_item_id
    ),
    -- ADR-0151 D-13: o kit não aparece como linha própria; aparece no contexto do
    -- produto-base, com o saldo virtual calculado on-the-fly. Espelhar o valor na coluna
    -- do kit foi REJEITADO: criaria um segundo número dessincronizável (risco do ADR-0129).
    -- `v.estoque` é o saldo da variação da linha corrente — kit vinculado só existe para
    -- produto de UMA variação (D-10), então é o saldo da base. NÃO some as variações: o
    -- ledger decrementa uma linha, e uma soma divergiria dele se a trava fosse afrouxada.
    'kits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'codigo_pai', k.codigo_pai,
        'multiplicador', k.kit_multiplicador,
        'disponivel', floor(v.estoque::numeric / k.kit_multiplicador)
      ) order by k.kit_multiplicador)
      from (
        select distinct on (kk.codigo_pai) kk.codigo_pai, kk.kit_multiplicador
        from public.familias kk
        where kk.org_id = org.id and kk.kit_base_codigo_pai = p_codigo_pai
          and kk.kit_multiplicador is not null
          and kk.status in ('pronto','publicando','publicado')
        order by kk.codigo_pai, kk.criado_em desc
      ) k
    ), '[]'::jsonb)
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
-- C) Lista flat de SKUs (picker do DialogEntrada) — kit deixa de ser oferecido. A guard da
--    Task 5 (D-9) já recusaria a entrada; esconder no picker evita oferecer o que sempre
--    falha (ADR-0047: a guard de banco continua a última linha de defesa, esta é só UX).
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
      and f.kit_multiplicador is null
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
