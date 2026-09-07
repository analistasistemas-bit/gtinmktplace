-- ADR-0158 §5: catalogo de custo da central por RPC.
--
-- Antes, `readOrgMetrics` lia `variacoes` inteira da organizacao (Avil: 8 537 linhas em 9 paginas)
-- so para resolver custo/peso/origem dos itens VENDIDOS no periodo. Esta funcao devolve apenas as
-- variacoes cujas chaves de resolucao casam com algum item vendido desde `p_since`, ja com
-- `familias.ml_item_id` e `familias.origem` embutidos. A cadeia de resolucao (variacao -> anuncio ->
-- GTIN -> codigo) e o tie-break por `atualizado_em` continuam em `sales-costs.ts` (ADR-0038/0108):
-- muda so o CONJUNTO lido, nunca o calculo.
--
-- Por que `returns jsonb` e nao `returns table`: o `max_rows` do PostgREST neste projeto e 1000 e a
-- Avil tem 6 284 linhas no catalogo (medido em 2026-09-07). Uma funcao `returns table` chamada por
-- POST seria TRUNCADA em 1000 linhas sem erro nenhum -- o markup sairia errado em silencio, que e
-- exatamente o que ADR-0055/0156 proibem. Um escalar jsonb e uma linha so: nao passa pelo teto e
-- cabe em 1 round-trip. `order by c.id` dentro do agregado e carga util, nao estetica: o tie-break
-- de `montarMapasCusto` usa `>` estrito, entao com `atualizado_em` igual quem chega primeiro vence e
-- a ordem do array decide qual custo sobrevive.
--
-- `origem` sai como text: a coluna e o enum `public.origem_produto` e `montarMapasCusto` compara com
-- as strings 'nacional'/'importado'.

create or replace function public.platform_org_cost_catalog(p_org uuid, p_since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  -- `sold` materializada + quatro `in` hasheados no lugar de um `exists (... A or B or C or D)`.
  -- A forma com `exists` vira Nested Loop Semi Join que reavalia os 2 854 itens para cada uma das
  -- 8 537 variacoes (8,2 M linhas descartadas, 3 157 ms medidos na Avil em 2026-09-07); assim o
  -- planner hasheia cada conjunto de chaves uma vez e cai para 140 ms, com o MESMO resultado --
  -- exists(A or B or C or D) e equivalente a exists(A) or exists(B) or exists(C) or exists(D), e as
  -- duas formas devolveram 6 284 linhas na Avil. Nenhum indice novo foi preciso.
  with sold as materialized (
    select i.ml_item_id, i.variation_id, i.ean, i.codigo
    from public.ml_vendas_itens i
    join public.ml_vendas s on s.id = i.venda_id
    where s.org_id = p_org
      and s.date_closed >= p_since
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
  from (
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
        -- `montarMapasCusto`/`resolverProduto` aplicam nas duas pontas. Com `=` cru, uma variacao de
        -- gtin '0789...' vendida com ean '789...' ficaria fora do catalogo e o item perderia o custo
        -- em silencio -- markup errado sem erro nenhum. Nao ha caso assim na base hoje (medido em
        -- 2026-09-07: 0 linhas de diferenca na Avil), isto e trava, nao correcao.
        or regexp_replace(coalesce(v.gtin, ''), '^0+', '')
             in (select regexp_replace(s.ean, '^0+', '') from sold s where s.ean is not null and s.ean <> '')
        or regexp_replace(coalesce(v.codigo, ''), '^0+', '')
             in (select regexp_replace(s.codigo, '^0+', '') from sold s where s.codigo is not null and s.codigo <> '')
      )
  ) c;
$$;

-- `create function` concede EXECUTE a PUBLIC por padrao. Revogar ANTES de conceder: a central roda
-- com service_role e nenhum usuario logado pode ler o catalogo de custo de outra organizacao.
revoke all on function public.platform_org_cost_catalog(uuid, timestamptz) from public;
revoke all on function public.platform_org_cost_catalog(uuid, timestamptz) from anon;
revoke all on function public.platform_org_cost_catalog(uuid, timestamptz) from authenticated;
grant execute on function public.platform_org_cost_catalog(uuid, timestamptz) to service_role;

comment on function public.platform_org_cost_catalog(uuid, timestamptz) is
  'ADR-0158 §5: variacoes (+ familias.ml_item_id/origem) da organizacao que casam com itens vendidos desde p_since, como array jsonb. Somente service_role.';
