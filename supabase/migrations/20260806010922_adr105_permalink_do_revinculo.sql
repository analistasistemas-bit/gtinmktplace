-- ADR-0105 (adendo) — o re-vínculo também precisa re-apontar o PERMALINK, não só o `ml_item_id`.
--
-- Achado em produção logo após o primeiro re-vínculo real (lote #45): o link "ver anúncio" das
-- telas continuava abrindo o anúncio ANTIGO ("Anúncio finalizado"). Causa: TODOS os links do
-- frontend saem de `familias.ml_permalink` ou de `anuncios_externos.permalink` — nenhum monta a URL
-- a partir do `ml_item_id`. Como a adoção re-apontava só o id, o permalink morto sobrevivia e o
-- operador era levado ao item dissolvido.
--
-- O dado certo já estava no banco: cada `anuncios_externos_itens.permalink` foi gravado com o
-- permalink observado no GET do irmão. Faltava propagá-lo para a raiz e para as famílias.
--
-- Duas partes: (1) a RPC passa a propagar o permalink do filho REPRESENTANTE — o mesmo critério que
-- já elege o `p_ml_item_id` —; (2) um backfill idempotente conserta o que já foi adotado.

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
  v_permalink text;
begin
  if p_filhos is null or pg_catalog.jsonb_array_length(p_filhos) = 0 then
    raise exception 'adotar_familia_migrada_up: conjunto de filhos vazio';
  end if;

  -- skus_esperados = o conjunto EXATO de SKUs adotados (ADR-0088 exige igualdade de conjunto na
  -- agregação). Sem isto os N filhos cairiam no caso 5 ("excesso não explicado") e a partição
  -- viraria `erro` espúrio.
  select pg_catalog.jsonb_agg(f->>'sku') into v_skus
  from pg_catalog.jsonb_array_elements(p_filhos) as f;

  -- ADR-0105 (adendo): permalink do filho REPRESENTANTE — derivado aqui, do mesmo `p_filhos`, em vez
  -- de virar parâmetro novo: assim é impossível o chamador mandar um permalink que não seja o do
  -- item eleito. `null` quando o GET do irmão não trouxe permalink; nesse caso os updates abaixo
  -- preservam o valor atual em vez de apagar o link.
  select f->>'permalink' into v_permalink
  from pg_catalog.jsonb_array_elements(p_filhos) as f
  where f->>'item_externo_id' = p_ml_item_id
  limit 1;

  -- 1. raiz lógica (partição 0). `user_id` é NOT NULL sem default (coluna pré-E7 sobrevivente à
  -- migração pra org_id) — o mesmo bug real já corrigido duas vezes na ADR-0088.
  insert into public.anuncios_externos
    (user_id, org_id, canal, codigo_pai, particao, item_externo_id, titulo, status, skus_esperados,
     permalink)
  values
    (p_user_id, p_org_id, 'mercado_livre', p_codigo_pai, 0, p_ml_item_id, p_family_name,
     'publicado', v_skus, v_permalink)
  on conflict (org_id, canal, codigo_pai, particao) do update
    set item_externo_id = excluded.item_externo_id,
        titulo = excluded.titulo,
        skus_esperados = excluded.skus_esperados,
        permalink = coalesce(excluded.permalink, public.anuncios_externos.permalink)
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
  -- ADR-0105 (adendo): `ml_permalink` anda JUNTO. Todo link "ver anúncio" da UI sai daqui — deixá-lo
  -- para trás manda o operador ao anúncio finalizado, que foi exatamente o que aconteceu.
  update public.familias
    set ml_item_id = p_ml_item_id,
        ml_permalink = coalesce(v_permalink, ml_permalink)
  where org_id = p_org_id
    and (id = p_familia_id
         or (codigo_pai = p_codigo_pai and ml_item_id = p_ml_item_id_antigo));

  return v_root_id;
end;
$$;

comment on function public.adotar_familia_migrada_up(uuid, uuid, uuid, text, text, text, text, jsonb) is
  'ADR-0104/0105: adota numa única transação uma família que o ML migrou (ou dissolveu) em User Products — raiz (partição 0 + skus_esperados com o conjunto EXATO + permalink), N linhas filhas, variacoes.ml_variation_id nulado e familias.ml_item_id/ml_permalink re-apontados em TODAS as famílias do codigo_pai que apontavam para p_ml_item_id_antigo. Só escrita local: nada toca o Mercado Livre. O chamador só chama com o conjunto COMPLETO validado — adoção parcial é proibida.';

revoke all on function public.adotar_familia_migrada_up(uuid, uuid, uuid, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.adotar_familia_migrada_up(uuid, uuid, uuid, text, text, text, text, jsonb)
  to service_role;

-- ── Backfill do que já foi adotado antes deste adendo ────────────────────────────────────────────
-- Genérico e idempotente: propaga o permalink do filho cujo `item_externo_id` é o item apontado,
-- para toda raiz/família que ainda carrega um permalink diferente. Só toca linhas incoerentes; quem
-- já está certo (ou não é UP) não é alcançado, porque o join exige um filho com aquele item.

update public.anuncios_externos ae
set permalink = i.permalink
from public.anuncios_externos_itens i
where i.anuncio_externo_id = ae.id
  and i.item_externo_id = ae.item_externo_id
  and i.permalink is not null
  and ae.permalink is distinct from i.permalink;

update public.familias f
set ml_permalink = i.permalink
from public.anuncios_externos ae
join public.anuncios_externos_itens i on i.anuncio_externo_id = ae.id
where ae.org_id = f.org_id
  and ae.canal = 'mercado_livre'
  and ae.codigo_pai = f.codigo_pai
  and i.item_externo_id = f.ml_item_id
  and i.permalink is not null
  and f.ml_permalink is distinct from i.permalink;
