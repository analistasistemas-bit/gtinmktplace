-- ADR-0104 — adoção de família que o Mercado Livre migrou para User Products sozinho.
--
-- O ML migra categorias para UP de forma automática e gradual, em anúncios JÁ PUBLICADOS: uma
-- família publicada como Legacy vira item plano (`variations: []` + family_name na raiz) e as
-- demais cores viram itens irmãos sob o mesmo family_id. Localmente não existe nenhuma linha em
-- anuncios_externos_itens (a família nasceu Legacy), então o UPDATE não a enxerga como UP.
--
-- Esta RPC grava, numa ÚNICA transação, tudo que a adoção precisa. São 4 escritas em 3 tabelas —
-- em chamadas PostgREST separadas não seriam atômicas, e uma falha no meio deixaria a família num
-- estado híbrido pior que o original (ex.: raiz criada sem filhos, ou filhos sem o ml_variation_id
-- nulado, fazendo o caminho Legacy e o resolvedor de vendas casarem por um variation_id que já não
-- existe no anúncio). Mesma razão que motivou a RPC do backfill (20260723222253).
--
-- SÓ ESCRITA LOCAL: nada aqui toca o Mercado Livre. A adoção não altera o anúncio; ensina o banco
-- a enxergar o que o ML já fez. A reposição de estoque acontece depois, pela saga UP.

create or replace function public.adotar_familia_migrada_up(
  p_org_id uuid,
  p_user_id uuid,
  p_familia_id uuid,
  p_codigo_pai text,
  p_family_name text,
  p_ml_item_id text,   -- item representante da partição 0 (ADR-0088 §5), já resolvido pelo chamador
  p_filhos jsonb       -- [{sku, item_externo_id, family_id, user_product_id, permalink, status}]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_root_id uuid;
  v_skus jsonb;
begin
  if p_filhos is null or pg_catalog.jsonb_array_length(p_filhos) = 0 then
    raise exception 'adotar_familia_migrada_up: conjunto de filhos vazio';
  end if;

  -- skus_esperados = o conjunto EXATO de SKUs adotados (ADR-0088 exige igualdade de conjunto na
  -- agregação). Sem isto os N filhos cairiam no caso 5 ("excesso não explicado") e a partição
  -- viraria `erro` espúrio.
  select pg_catalog.jsonb_agg(f->>'sku') into v_skus
  from pg_catalog.jsonb_array_elements(p_filhos) as f;

  -- 1. raiz lógica (partição 0). `user_id` é NOT NULL sem default (coluna pré-E7 sobrevivente à
  -- migração pra org_id) — o mesmo bug real já corrigido duas vezes na ADR-0088.
  insert into public.anuncios_externos
    (user_id, org_id, canal, codigo_pai, particao, item_externo_id, titulo, status, skus_esperados)
  values
    (p_user_id, p_org_id, 'mercado_livre', p_codigo_pai, 0, p_ml_item_id, p_family_name,
     'publicado', v_skus)
  on conflict (org_id, canal, codigo_pai, particao) do update
    set item_externo_id = excluded.item_externo_id,
        titulo = excluded.titulo,
        skus_esperados = excluded.skus_esperados
  returning id into v_root_id;

  -- 2. N linhas filhas, ancoradas por (anuncio_externo_id, sku). `do update` (não `do nothing`):
  -- a adoção reflete o estado observado AO VIVO no ML, então uma readoção deve atualizar o que
  -- mudou lá (status/permalink), não preservar um retrato antigo.
  insert into public.anuncios_externos_itens
    (anuncio_externo_id, org_id, sku, retirado, status, item_externo_id, user_product_id, family_id, permalink)
  select
    v_root_id, p_org_id, f->>'sku', false, f->>'status',
    f->>'item_externo_id', f->>'user_product_id', f->>'family_id', f->>'permalink'
  from pg_catalog.jsonb_array_elements(p_filhos) as f
  on conflict (anuncio_externo_id, sku) do update
    set status = excluded.status,
        item_externo_id = excluded.item_externo_id,
        user_product_id = excluded.user_product_id,
        family_id = excluded.family_id,
        permalink = excluded.permalink,
        retirado = false;

  -- 3. ADR-0088: em User Products `variacoes.ml_variation_id` é NULO — cada cor é um ITEM, não uma
  -- variação. Deixar o id Legacy órfão faria o filtro `casadas` do caminho Legacy e o resolvedor de
  -- vendas (_shared/update/reconciliar.ts) casarem por um variation_id que não existe mais no
  -- anúncio migrado: atribuição de venda errada, em silêncio.
  update public.variacoes
    set ml_variation_id = null
  where familia_id = p_familia_id
    and ml_variation_id is not null;

  -- 4. ADR-0088 §5 / ADR-0104 §3: `familias.ml_item_id` é o representante da partição 0 e é lido
  -- por todo o frontend como "o anúncio da família". A migração pode ter dissolvido o item
  -- original; o chamador já resolveu o representante por regra determinística.
  update public.familias
    set ml_item_id = p_ml_item_id
  where id = p_familia_id
    and org_id = p_org_id;

  return v_root_id;
end;
$$;

comment on function public.adotar_familia_migrada_up(uuid, uuid, uuid, text, text, text, jsonb) is
  'ADR-0104: adota numa única transação uma família que o ML migrou para User Products sozinho — raiz (partição 0 + skus_esperados com o conjunto EXATO), N linhas filhas, variacoes.ml_variation_id nulado (UP não tem variações) e familias.ml_item_id re-apontado. Só escrita local: nada toca o Mercado Livre. O chamador (adotar-familia-migrada.ts) só chama com o conjunto COMPLETO validado — adoção parcial é proibida.';

-- SECURITY DEFINER roda com o papel do DONO (bypassa RLS): sem revogar de PUBLIC, qualquer cliente
-- autenticado poderia chamar via PostgREST e mutar dados de QUALQUER org, contornando o isolamento
-- multi-tenant. Só o service_role (edge functions) executa.
revoke all on function public.adotar_familia_migrada_up(uuid, uuid, uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.adotar_familia_migrada_up(uuid, uuid, uuid, text, text, text, jsonb)
  to service_role;
