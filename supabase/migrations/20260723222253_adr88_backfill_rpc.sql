-- ADR-0088 — Reconciliador de backfill: 2 RPCs security definer pra resolver 3 problemas reais
-- achados em revisão adversarial (Codex) na primeira versão (queries diretas do JS client):
--
-- 1. `anuncios_externos.user_id` é NOT NULL sem default (coluna original pré-E7, sobrevivente à
--    migração pra org_id) — o mesmo bug real já corrigido uma vez na Fase 1 desta ADR
--    (publish-familia-up.ts). Faltava fornecer o user_id no upsert do backfill.
-- 2. Upsert de raiz + filho em 2 chamadas HTTP/PostgREST separadas NÃO é atômico — se o filho
--    falhar, a raiz fica marcada 'publicado' com skus_esperados mas sem filho nenhum.
-- 3. `familias` acumula 1 linha por lote de UPDATE — múltiplas linhas históricas compartilham o
--    mesmo codigo_pai. Escolher qualquer uma (a query direta do JS trazia TODAS) processava a
--    mesma âncora várias vezes. Precisa da MESMA regra `distinct on` + `order by publicado_em desc`
--    já usada no backfill original de anuncios_externos (20260614152627).

-- Candidatas ao backfill: 1 por (org_id, codigo_pai) — a família mais recente publicada — cuja
-- raiz UP (partição 0) ainda não tem NENHUMA linha filha em anuncios_externos_itens.
create or replace function public.reconciliar_backfill_up_candidatas(p_org_id uuid)
returns table (
  familia_id uuid,
  user_id uuid,
  codigo_pai text,
  ml_item_id text
)
language sql
security definer
set search_path = ''
as $$
  select distinct on (f.codigo_pai)
    f.id as familia_id, f.user_id, f.codigo_pai, f.ml_item_id
  from public.familias f
  where f.org_id = p_org_id
    and f.ml_item_id is not null
    and not exists (
      select 1
      from public.anuncios_externos ae
      join public.anuncios_externos_itens aei on aei.anuncio_externo_id = ae.id
      where ae.org_id = p_org_id
        and ae.canal = 'mercado_livre'
        and ae.particao = 0
        and ae.codigo_pai = f.codigo_pai
    )
  -- desempate estável (revisão Codex): 2 linhas com o mesmo publicado_em (ex.: mesmo backfill em
  -- lote) escolheriam candidata não-determinística sem um 3º critério.
  order by f.codigo_pai, f.publicado_em desc nulls last, f.id desc;
$$;

comment on function public.reconciliar_backfill_up_candidatas(uuid) is
  'ADR-0088 backfill: 1 família por codigo_pai (a mais recente), publicada (ml_item_id not null), cuja raiz UP (partição 0) ainda não tem filho técnico. NOT EXISTS no servidor evita truncamento por paginação que uma query client-side dividida em 2 chamadas teria.';

-- SECURITY DEFINER roda com o papel do DONO da função (bypassa RLS) — sem revogar de PUBLIC,
-- qualquer cliente autenticado (ou anônimo) poderia chamar a RPC diretamente via PostgREST e
-- enumerar/mutar dados de QUALQUER org, contornando o isolamento multi-tenant (achado real,
-- revisão adversarial). Só o service_role (usado pelas edge functions) pode executar.
revoke all on function public.reconciliar_backfill_up_candidatas(uuid) from public, anon, authenticated;
grant execute on function public.reconciliar_backfill_up_candidatas(uuid) to service_role;

-- Upsert atômico raiz+filho numa única transação (1 chamada RPC = 1 round-trip = 1 transação
-- implícita do Postgres). Retorna true só se o FILHO foi genuinamente inserido agora (false numa
-- 2ª execução idempotente ou numa corrida entre 2 execuções concorrentes — só uma insere de fato).
create or replace function public.reconciliar_backfill_up_upsert(
  p_org_id uuid,
  p_user_id uuid,
  p_codigo_pai text,
  p_ml_item_id text,
  p_sku text,
  p_status text, -- 'ativo' | 'pausado' — já normalizado pelo chamador (nunca default silencioso)
  p_family_id text,
  p_user_product_id text,
  p_permalink text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_root_id uuid;
  v_rows int;
begin
  insert into public.anuncios_externos
    (user_id, org_id, canal, codigo_pai, particao, item_externo_id, status, skus_esperados)
  values
    (p_user_id, p_org_id, 'mercado_livre', p_codigo_pai, 0, p_ml_item_id, 'publicado', pg_catalog.jsonb_build_array(p_sku))
  on conflict (org_id, canal, codigo_pai, particao) do update
    set item_externo_id = excluded.item_externo_id, skus_esperados = excluded.skus_esperados
  returning id into v_root_id;

  insert into public.anuncios_externos_itens
    (anuncio_externo_id, org_id, sku, retirado, status, item_externo_id, user_product_id, family_id, permalink)
  values
    (v_root_id, p_org_id, p_sku, false, p_status, p_ml_item_id, p_user_product_id, p_family_id, p_permalink)
  on conflict (anuncio_externo_id, sku) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

comment on function public.reconciliar_backfill_up_upsert(
  uuid, uuid, text, text, text, text, text, text, text
) is
  'ADR-0088 backfill: upsert atômico da raiz (partição 0) + linha filha numa única transação (fecha o gap de atomicidade entre 2 chamadas PostgREST separadas). status já deve vir normalizado (ativo|pausado) pelo chamador — nunca default silencioso pra status remoto desconhecido. Retorna true só se o filho foi genuinamente inserido (false em reexecução idempotente ou corrida perdida).';

revoke all on function public.reconciliar_backfill_up_upsert(
  uuid, uuid, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.reconciliar_backfill_up_upsert(
  uuid, uuid, text, text, text, text, text, text, text
) to service_role;
