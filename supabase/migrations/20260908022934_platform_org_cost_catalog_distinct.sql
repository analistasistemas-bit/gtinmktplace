-- Perf FASE 2.3: `distinct on` no catalogo de custo (ADR-0158 §5, plano
-- docs/superpowers/plans/2026-09-07-perf-central-organizacoes.md).
--
-- `platform_org_cost_catalog` (20260907103422) devolve TODA variacao candidata, mesmo quando
-- reimportacoes repetem a mesma chave de resolucao (variacao/anuncio/GTIN/codigo) em linhas
-- diferentes -- 6 287 de 8 537 linhas na Avil eram, na pratica, duplicatas de chave que o cliente
-- ja reduzia sozinho em `montarMapasCusto` (sales-costs.ts). Aqui o corte muda de lugar (SQL em vez
-- de TypeScript), nunca o resultado: cada um dos QUATRO mapas independentes de `montarMapasCusto`
-- (porVariacao/porItem/porGtin/porCodigo) mantem so a linha mais recente por chave, e uma linha pode
-- vencer numa chave e perder em outra -- um `distinct on` por LINHA (em vez de por (kind, key))
-- devolveria o catalogo errado.
--
-- Duas invariantes replicadas do TypeScript, ao pe da letra:
-- 1. Tie-break: `atualizado_em DESC NULLS LAST, id ASC` -- mesmo resultado do `>` estrito de
--    `upsertRecente` quando as linhas chegam em `order by id` (id menor visto primeiro, so troca
--    com data estritamente maior; nulo nunca vence data real).
-- 2. `montarMapasCusto` DESCARTA custo <= 0 (ou nao numerico) ANTES de disputar a chave
--    (`sales-costs.ts:58`). Sem replicar isso aqui, uma linha nova com `custo = 0` venceria a chave
--    no SQL, sumiria do payload, e o TypeScript -- que teria ignorado essa linha de qualquer jeito
--    e usado a linha antiga com custo > 0 -- ficaria sem NENHUM custo para a chave. O markup mudaria
--    em silencio, exatamente o que a trava de aceite do plano proibe. Por isso `candidatos` já
--    filtra `custo is not null and custo > 0` antes de entrar nos quatro espacos de chave.
--
-- Fonte do custo continua sendo `variacoes.custo` -- nunca `familias.custo_centavos` (custo de
-- tokens de IA, ADR proibe usar como custo de produto).

create or replace function public.platform_org_cost_catalog(p_org uuid, p_since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with sold as materialized (
    select i.ml_item_id, i.variation_id, i.ean, i.codigo
    from public.ml_vendas_itens i
    join public.ml_vendas s on s.id = i.venda_id
    where s.org_id = p_org
      and s.date_closed >= p_since
  ),
  candidatos as (
    select
      v.id,
      v.org_id,
      v.custo,
      v.peso_gramas,
      v.ml_variation_id,
      v.gtin,
      v.codigo,
      v.atualizado_em,
      f.ml_item_id,
      f.origem::text as origem
    from public.variacoes v
    join public.familias f on f.id = v.familia_id
    where v.org_id = p_org
      and (
        v.ml_variation_id in (select s.variation_id::text from sold s where s.variation_id is not null)
        or f.ml_item_id in (select s.ml_item_id from sold s where s.ml_item_id is not null)
        -- GTIN e codigo comparados SEM zeros a esquerda: e a normalizacao (`normGtin`) que
        -- `montarMapasCusto`/`resolverProduto` aplicam nas duas pontas.
        or regexp_replace(coalesce(v.gtin, ''), '^0+', '')
             in (select regexp_replace(s.ean, '^0+', '') from sold s where s.ean is not null and s.ean <> '')
        or regexp_replace(coalesce(v.codigo, ''), '^0+', '')
             in (select regexp_replace(s.codigo, '^0+', '') from sold s where s.codigo is not null and s.codigo <> '')
      )
  ),
  -- Quatro espacos de chave, um por mapa de `montarMapasCusto`. So entram linhas com custo > 0: e
  -- exatamente o filtro que o TypeScript aplica antes de disputar a chave (ver nota acima) -- sem
  -- ele, uma linha com custo <= 0 podia vencer aqui e apagar do payload a linha com custo > 0 que o
  -- TypeScript teria usado.
  chaves as (
    select 'variacao'::text as kind, c.ml_variation_id as key, c.id as row_id, c.atualizado_em
    from candidatos c
    where c.ml_variation_id is not null and c.custo is not null and c.custo > 0
    union all
    select 'item', c.ml_item_id, c.id, c.atualizado_em
    from candidatos c
    where c.ml_item_id is not null and c.custo is not null and c.custo > 0
    union all
    select 'gtin', regexp_replace(c.gtin, '^0+', ''), c.id, c.atualizado_em
    from candidatos c
    where c.gtin is not null and c.gtin <> '' and c.custo is not null and c.custo > 0
    union all
    select 'codigo', regexp_replace(c.codigo, '^0+', ''), c.id, c.atualizado_em
    from candidatos c
    where c.codigo is not null and c.codigo <> '' and c.custo is not null and c.custo > 0
  ),
  vencedores as (
    select distinct on (kind, key) row_id
    from chaves
    order by kind, key, atualizado_em desc nulls last, row_id asc
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'org_id', c.org_id,
        'custo', c.custo,
        'peso_gramas', c.peso_gramas,
        'ml_variation_id', c.ml_variation_id,
        'gtin', c.gtin,
        'codigo', c.codigo,
        'atualizado_em', c.atualizado_em,
        'ml_item_id', c.ml_item_id,
        'origem', c.origem
      )
      order by c.id
    ),
    '[]'::jsonb
  )
  from candidatos c
  where c.id in (select row_id from vencedores)
$$;

comment on function public.platform_org_cost_catalog(uuid, timestamptz) is
  'ADR-0158 §5: variacoes (+ familias.ml_item_id/origem) da organizacao que casam com itens vendidos desde p_since, uma linha por chave vencedora (DISTINCT ON kind/key, perf FASE 2.3). Somente service_role.';
