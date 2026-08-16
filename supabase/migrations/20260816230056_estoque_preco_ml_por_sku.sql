-- Estoque: a coluna "Preço" mostrava `variacoes.preco` (preço local da planilha/markup), que
-- nunca é reconciliado com o ML. Medido em 16/08/2026 na org DSA: NIVEA 00000029 a R$ 28,99 na
-- tela contra R$ 39,90 no ML; Principia 00000023 a R$ 29,00 contra R$ 48,90.
--
-- O preço vivo já existe: `status-publicados` faz multiget /items?attributes=...,price e cobre
-- 100% dos anúncios da org. Ele é chaveado por item do canal, e esta RPC devolve linhas por SKU
-- — falta o ponteiro SKU → anúncio. É só isso que esta migration acrescenta.
--
-- (`pulse_produtos.meu_preco` não serve de base: só existe onde há ficha de catálogo — 3 de 7
-- produtos na DSA, 15 de 133 na Avil, ver Errata 2 do ADR-0119.)
--
-- Precedência do ponteiro, do mais específico para o mais genérico:
--   1. anuncios_externos_itens (User Products, ADR-0088): 1 item ML por SKU, preço próprio.
--   2. anuncios_externos cuja `variacoes_externas` contém o SKU (split por faixa, ADR-0048):
--      o preço difere de verdade entre partições.
--   3. familias.ml_item_id: caso comum — um anúncio com N variações no mesmo preço (ADR-0016).
-- Sem ponteiro → null, e a UI mostra o preço local. Preço plausível-porém-errado é o bug que
-- esta mudança conserta; nunca o inventamos por aproximação.
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
    )
  )
  from public.variacoes v
  cross join org
  join canonical c on c.id = v.familia_id
  where v.org_id = org.id
  order by v.codigo
$$;
revoke all on function public.variacoes_estoque_produto(text) from public;
grant execute on function public.variacoes_estoque_produto(text) to authenticated;
