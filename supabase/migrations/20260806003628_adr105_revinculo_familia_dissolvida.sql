-- ADR-0105 — o re-apontamento da adoção alcança TODAS as famílias do mesmo `codigo_pai`.
--
-- A RPC do ADR-0104 escopava `variacoes.ml_variation_id = null` e `familias.ml_item_id` por
-- `p_familia_id`. Isso é insuficiente: o mesmo `codigo_pai` tem uma `familias` POR LOTE — no caso
-- real que motivou este ADR (PAI 02186551) são duas, ambas apontando para o mesmo MLB4847766197
-- que o ML dissolveu. Adotar só a do lote corrente deixa a irmã apontando para um item morto e com
-- `ml_variation_id` órfão — a atribuição de venda errada e silenciosa que o próprio ADR-0104 §3
-- listou como motivo para nular o campo.
--
-- `p_ml_item_id_antigo` (novo) delimita o alcance: só famílias que apontavam para o item
-- dissolvido. Uma família do mesmo pai apontando para OUTRO anúncio (split, ADR-0048) fica
-- intocada — o filtro é a diferença entre corrigir e atropelar.
--
-- A assinatura muda, então a versão antiga sai (nada mais a chama: o único caller é
-- `portas-supabase.ts`, atualizado no mesmo commit). Continua SÓ ESCRITA LOCAL: nada toca o ML.

drop function if exists public.adotar_familia_migrada_up(uuid, uuid, uuid, text, text, text, jsonb);

create or replace function public.adotar_familia_migrada_up(
  p_org_id uuid,
  p_user_id uuid,
  p_familia_id uuid,
  p_codigo_pai text,
  p_family_name text,
  p_ml_item_id text,          -- item representante da partição 0 (ADR-0088 §5), já resolvido pelo chamador
  p_ml_item_id_antigo text,   -- ADR-0105: item que a migração dissolveu; delimita o re-apontamento
  p_filhos jsonb              -- [{sku, item_externo_id, family_id, user_product_id, permalink, status}]
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
  -- ADR-0105: alcança a família do lote corrente E as irmãs do mesmo `codigo_pai` que apontavam
  -- para o item dissolvido. Escopo de org via a FAMÍLIA (não por `variacoes.org_id`): a coluna
  -- existe, mas guardar por ela faria a RPC pular em silêncio qualquer linha antiga com org_id
  -- nulo — exatamente o tipo de default silencioso que esta base proíbe.
  update public.variacoes v
    set ml_variation_id = null
  where v.ml_variation_id is not null
    and exists (
      select 1 from public.familias f
      where f.id = v.familia_id
        and f.org_id = p_org_id
        and (f.id = p_familia_id
             or (f.codigo_pai = p_codigo_pai and f.ml_item_id = p_ml_item_id_antigo))
    );

  -- 4. ADR-0088 §5 / ADR-0104 §3: `familias.ml_item_id` é o representante da partição 0 e é lido
  -- por todo o frontend como "o anúncio da família". A migração dissolveu o item original; o
  -- chamador já resolveu o representante por regra determinística.
  update public.familias
    set ml_item_id = p_ml_item_id
  where org_id = p_org_id
    and (id = p_familia_id
         or (codigo_pai = p_codigo_pai and ml_item_id = p_ml_item_id_antigo));

  return v_root_id;
end;
$$;

comment on function public.adotar_familia_migrada_up(uuid, uuid, uuid, text, text, text, text, jsonb) is
  'ADR-0104/0105: adota numa única transação uma família que o ML migrou (ou dissolveu) em User Products — raiz (partição 0 + skus_esperados com o conjunto EXATO), N linhas filhas, variacoes.ml_variation_id nulado e familias.ml_item_id re-apontado em TODAS as famílias do codigo_pai que apontavam para p_ml_item_id_antigo. Só escrita local: nada toca o Mercado Livre. O chamador só chama com o conjunto COMPLETO validado — adoção parcial é proibida.';

-- SECURITY DEFINER roda com o papel do DONO (bypassa RLS): sem revogar de PUBLIC, qualquer cliente
-- autenticado poderia chamar via PostgREST e mutar dados de QUALQUER org, contornando o isolamento
-- multi-tenant. Só o service_role (edge functions) executa.
revoke all on function public.adotar_familia_migrada_up(uuid, uuid, uuid, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.adotar_familia_migrada_up(uuid, uuid, uuid, text, text, text, text, jsonb)
  to service_role;
