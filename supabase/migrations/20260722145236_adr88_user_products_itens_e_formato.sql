-- ============================================================================
-- Migration: adr88_user_products_itens_e_formato
-- Refs: ADR-0088 (publicação em User Products com N itens técnicos por família).
-- Fase 1 (só schema): item técnico UP separado da partição comercial + cache de
-- formato por conexão+categoria. Não-destrutiva; Legacy e o retry de 1 cor
-- (ADR-0087) ficam intocados. Nenhum código TS ainda — só as tabelas/colunas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- anuncios_externos: alvo persistido de operações em lote + snapshot de SKUs
-- esperados + marcador de mudança de composição + base da FK composta da filha.
-- ----------------------------------------------------------------------------
alter table public.anuncios_externos
  add column if not exists estado_desejado    text,
  add column if not exists skus_esperados     jsonb,
  add column if not exists mudando_composicao boolean not null default false;

alter table public.anuncios_externos
  add constraint anuncios_externos_estado_desejado_chk
  check (estado_desejado in ('ativando', 'pausando'));

comment on column public.anuncios_externos.estado_desejado is
  'Alvo persistido de uma operação em lote (ativando|pausando), gravado antes de qualquer PUT e limpo (null) ao confirmar o estado terminal. Só preenchido durante a janela pendente/compensação (ADR-0088).';
comment on column public.anuncios_externos.skus_esperados is
  'Snapshot do conjunto EXATO de SKUs esperados da partição (não inteiro). Gravado antes de a saga criar itens e reescrito a cada mudança de composição. Agregação exige igualdade de conjunto vs. filhos não-retirados ativos (ADR-0088).';
comment on column public.anuncios_externos.mudando_composicao is
  'Marcador transitório de mudança de composição em andamento: enquanto true a partição lê publicando e os veredictos terminais da agregação ficam suspensos (ADR-0088).';

-- Base da FK composta de anuncios_externos_itens (a filha herda a org do pai).
-- id já é PK (único); (id, org_id) dá o alvo referenciável exigido pela FK composta.
alter table public.anuncios_externos
  add constraint anuncios_externos_id_org_id_key unique (id, org_id);

-- ----------------------------------------------------------------------------
-- anuncios_externos_itens: o item técnico UP (um por SKU/cor), filho da partição.
-- Escrita só por service_role (edge functions); app só lê.
-- ----------------------------------------------------------------------------
create table public.anuncios_externos_itens (
  id                 uuid primary key default gen_random_uuid(),
  anuncio_externo_id uuid not null,
  org_id             uuid not null,

  -- ponteiro de rastreabilidade best-effort (não é a ancoragem — essa é (anuncio_externo_id, sku)).
  -- nulável: a variação muda a cada re-ingest e a antiga pode ser apagada.
  variacao_id        uuid references public.variacoes(id) on delete set null,

  sku                text not null,                  -- identidade estável da cor na partição
  retirado           boolean not null default false, -- cor removida (pausada no ML, linha preservada como histórico)

  status text not null
    check (status in ('pendente','criacao_incerta','criado','pausado','ativo','compensacao_pendente','remocao_pendente','erro')),

  item_externo_id    text,   -- = ml_item_id do item técnico; null até existir no ML
  user_product_id    text,
  family_id          text,
  permalink          text,

  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),

  -- Integridade referencial + herança de org via FK composta real (não trigger, não CHECK:
  -- um CHECK do Postgres não pode consultar outra tabela). A filha não declara org própria.
  constraint anuncios_externos_itens_pai_fk
    foreign key (anuncio_externo_id, org_id)
    references public.anuncios_externos (id, org_id) on delete cascade,

  -- Ancoragem: o SKU é a identidade estável dentro da partição (nunca variacao_id).
  constraint anuncios_externos_itens_ancora_key unique (anuncio_externo_id, sku)
);

-- Um item_externo_id do ML pertence a uma única linha por org; um user_product_id é global.
create unique index anuncios_externos_itens_item_externo_uidx
  on public.anuncios_externos_itens (org_id, item_externo_id)
  where item_externo_id is not null;
create unique index anuncios_externos_itens_user_product_uidx
  on public.anuncios_externos_itens (user_product_id)
  where user_product_id is not null;

create trigger anuncios_externos_itens_set_updated_at
  before update on public.anuncios_externos_itens
  for each row execute procedure extensions.moddatetime (atualizado_em);

alter table public.anuncios_externos_itens enable row level security;

-- Grupo B (só-leitura no app; escrita = service_role, que ignora RLS). Mesmo padrão de
-- ml_credentials/ml_vendas em 20260705165828_e7_rls_org.sql: só policy de select org.
create policy "anuncios_externos_itens: select org" on public.anuncios_externos_itens
  for select to authenticated using (org_id = (select public.current_org_id()));

-- ----------------------------------------------------------------------------
-- ml_formato_publicacao: cache do formato de publicação por conexão+categoria.
-- Só orienta o CREATE (seed a partir da assinatura reativa 369+374); UPDATE nunca lê (ADR-0087/0088).
-- Escrita só por service_role.
-- ----------------------------------------------------------------------------
create table public.ml_formato_publicacao (
  connection_id uuid not null references public.marketplace_connections(id) on delete cascade,
  categoria_id  text not null,
  formato       text not null check (formato in ('legacy', 'user_products')),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (connection_id, categoria_id)
);

create trigger ml_formato_publicacao_set_updated_at
  before update on public.ml_formato_publicacao
  for each row execute procedure extensions.moddatetime (atualizado_em);

alter table public.ml_formato_publicacao enable row level security;

-- Sem org_id direto: a org vem da conexão. Leitura permitida quando a conexão for da
-- org corrente (join via exists — a própria marketplace_connections já é filtrada por RLS,
-- e o predicado casa o padrão org-scoped do projeto sem denormalizar org_id aqui).
-- Escrita = service_role (sem policy de insert/update/delete).
create policy "ml_formato_publicacao: select org" on public.ml_formato_publicacao
  for select to authenticated
  using (
    exists (
      select 1 from public.marketplace_connections mc
      where mc.id = ml_formato_publicacao.connection_id
        and mc.org_id = (select public.current_org_id())
    )
  );
