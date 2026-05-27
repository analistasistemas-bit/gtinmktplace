-- ============================================================================
-- Migration 002 — familias e variacoes
-- Refs: ADR-0007 (modelo), ADR-0008 (estrategia_preco), ADR-0009 (campos ML).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tabela: familias
-- ----------------------------------------------------------------------------

create table public.familias (
  id              uuid primary key default gen_random_uuid(),
  lote_id         uuid not null references public.lotes(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,

  -- Identidade do PAI
  codigo_pai      text not null,           -- código do PAI da planilha (string pra preservar zeros à esquerda)
  nome_pai        text not null,
  descricao_pai   text,
  unidade         text,

  -- Lifecycle / status
  status          public.familia_status not null default 'pendente',
  operacao        public.operacao_ml not null,

  -- Categoria ML (determinística — ADR-0009)
  tipo_aviamento  public.tipo_aviamento,
  tipo_origem     public.tipo_origem,
  categoria_ml_id text,

  -- Copywriting (preenchido no M3)
  titulo_ml       text,
  descricao_ml    text,
  atributos_ml    jsonb not null default '[]'::jsonb,

  -- Estratégia de preço (ADR-0008) — preenchido no M4
  estrategia_preco public.estrategia_preco,
  estrategia_motivo text,

  -- Envio (ADR-0009)
  shipping_mode   text not null default 'me2',
  frete_gratis    boolean not null default false,
  sale_terms      jsonb not null default
    '[{"id":"WARRANTY_TYPE","value_id":"2230279"},{"id":"WARRANTY_TIME","value_name":"30 dias"}]'::jsonb,

  -- Resultado da publicação
  ml_item_id      text,
  ml_permalink    text,
  publicado_em    timestamptz,

  -- Auditoria de edição humana (ADR-0007)
  titulo_editado_pelo_operador    boolean not null default false,
  descricao_editada_pelo_operador boolean not null default false,
  editado_em                       timestamptz,
  observacao_operador              text,

  -- Erro / fila
  erro_mensagem      text,
  qstash_message_id  text,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  unique (lote_id, codigo_pai)
);

create index familias_lote_id_idx           on public.familias (lote_id);
create index familias_user_id_codigo_pai_idx on public.familias (user_id, codigo_pai);
create index familias_user_ml_item_idx       on public.familias (user_id, ml_item_id)
  where ml_item_id is not null;
create index familias_status_idx              on public.familias (status);

create trigger familias_set_updated_at
  before update on public.familias
  for each row execute procedure extensions.moddatetime (atualizado_em);

alter table public.familias enable row level security;

create policy "familias: select own" on public.familias for select using ((select auth.uid()) = user_id);
create policy "familias: insert own" on public.familias for insert with check ((select auth.uid()) = user_id);
create policy "familias: update own" on public.familias for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "familias: delete own" on public.familias for delete using ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- Tabela: variacoes
-- ----------------------------------------------------------------------------

create table public.variacoes (
  id          uuid primary key default gen_random_uuid(),
  familia_id  uuid not null references public.familias(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,

  codigo      text not null,           -- código do filho na planilha
  nome        text,
  gtin        text,
  estoque     integer not null default 0,

  -- Preços
  preco             numeric(12,2) not null,
  preco_publicacao  numeric(12,2),  -- após estratégia (ADR-0008, ADR-0009)
  preco_editado_pelo_operador boolean not null default false,

  -- Dimensões / peso (vão pro shipping no payload ML)
  peso_gramas    numeric(10,2),
  altura_cm      numeric(10,2),
  largura_cm     numeric(10,2),
  comprimento_cm numeric(10,2),

  -- Cor da variação (ADR-0004) — preenchido no M3
  cor         text,
  cor_hex     text,
  cor_origem  public.cor_origem,

  -- Imagem
  imagem_path text,        -- path completo no bucket (user_id/lote_id/00CODIGO.jpeg)
  ml_picture_id text,      -- preenchido após upload pra ML no M4

  -- Resultado por variação
  ml_variation_id text,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  unique (familia_id, codigo)
);

create index variacoes_familia_id_idx on public.variacoes (familia_id);
create index variacoes_user_id_codigo_idx on public.variacoes (user_id, codigo);

create trigger variacoes_set_updated_at
  before update on public.variacoes
  for each row execute procedure extensions.moddatetime (atualizado_em);

alter table public.variacoes enable row level security;

create policy "variacoes: select own" on public.variacoes for select using ((select auth.uid()) = user_id);
create policy "variacoes: insert own" on public.variacoes for insert with check ((select auth.uid()) = user_id);
create policy "variacoes: update own" on public.variacoes for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "variacoes: delete own" on public.variacoes for delete using ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- Trigger: atualiza contadores de lote quando família muda de status
-- ----------------------------------------------------------------------------

create or replace function public.update_lote_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') or (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    update public.lotes l
       set total_familias   = (select count(*) from public.familias where lote_id = l.id),
           total_publicadas = (select count(*) from public.familias where lote_id = l.id and status = 'publicado'),
           total_erros      = (select count(*) from public.familias where lote_id = l.id and status = 'erro')
     where l.id = coalesce(new.lote_id, old.lote_id);
  end if;
  return new;
end;
$$;

create trigger familias_update_lote_counters
  after insert or update on public.familias
  for each row execute procedure public.update_lote_counters();
