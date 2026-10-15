-- ADR-0181: nota de compra como documento à parte + vínculo de fornecedor.
-- Escrita só por service_role (edges importar-/desfazer-nota-compra); leitura por org.

alter table public.familias add column if not exists descricao_fiscal text
  check (descricao_fiscal is null or length(btrim(descricao_fiscal)) between 1 and 120);
comment on column public.familias.descricao_fiscal is
  'ADR-0181 D-5: texto que sai na nota de venda do Faturador ML (title do fiscal_information). Null = usa nome_pai.';

-- N-I1 (rodada 2/3 do Codex): o modo "cadastro pela nota" é persistido; o retry do cadastrar-produto
-- nunca aplica estoque inicial numa família criada nesse modo, mesmo que o payload do retry mude.
alter table public.familias add column if not exists origem_cadastro text
  check (origem_cadastro is null or origem_cadastro = 'nota');

alter table public.empresa_fiscal add column if not exists csosn_padrao_revenda text
  check (csosn_padrao_revenda is null or csosn_padrao_revenda ~ '^[0-9]{3}$');
comment on column public.empresa_fiscal.csosn_padrao_revenda is
  'ADR-0181 D-10: CSOSN de saída sugerido no cadastro (informado com o contador). Nunca aplicado sem confirmação.';

create table public.notas_compra (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  chave         text not null check (chave ~ '^[0-9]{44}$'),
  numero        integer not null,
  serie         integer not null,
  emitente_cnpj text not null check (emitente_cnpj ~ '^[0-9]{14}$'),
  emitente_nome text not null,
  emitida_em    timestamptz not null,
  valor_total   numeric(14,2) not null,
  assinada      boolean not null,
  xml_path      text not null,
  xml_sha256    text,
  -- Diferença (R$) entre vNF e a composição dos totais, aceita por confirmação ativa do operador.
  divergencia_total_aceita numeric(14,2),
  status        text not null default 'importada' check (status in ('importada','desfeita','cancelada')),
  importada_por uuid references auth.users(id),
  importada_em  timestamptz not null default now(),
  desfeita_por  uuid references auth.users(id),
  desfeita_em   timestamptz,
  unique (org_id, chave)
);
create index notas_compra_org_emitida on public.notas_compra (org_id, emitida_em desc);

create table public.notas_compra_itens (
  id              uuid primary key default gen_random_uuid(),
  nota_id         uuid not null references public.notas_compra(id) on delete cascade,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  n_item          smallint not null,
  cprod           text not null,
  xprod           text not null,
  ncm             text,
  cfop            text not null,
  gtin            text,
  ucom            text not null,
  qcom            numeric(15,4) not null check (qcom > 0),
  fator_conversao integer not null default 1 check (fator_conversao >= 1),
  -- Valores como estão no documento (por item) + o rateio dos que só existiam no total (D-9).
  v_prod          numeric(14,2) not null,
  v_frete         numeric(14,2) not null default 0,
  v_seg           numeric(14,2) not null default 0,
  v_desc          numeric(14,2) not null default 0,
  v_outro         numeric(14,2) not null default 0,
  v_ipi           numeric(14,2) not null default 0,
  v_st            numeric(14,2) not null default 0,
  v_fcpst         numeric(14,2) not null default 0,
  rateio          jsonb not null default '{}'::jsonb,
  orig            smallint check (orig between 0 and 8),
  codigo_pai      text not null,
  unique (nota_id, n_item)
);

create table public.notas_compra_distribuicao (
  id                      uuid primary key default gen_random_uuid(),
  item_id                 uuid not null references public.notas_compra_itens(id) on delete cascade,
  org_id                  uuid not null references public.organizations(id) on delete cascade,
  codigo                  text not null,
  quantidade              integer not null check (quantidade > 0),
  custo_aquisicao_unit    numeric(14,6) not null check (custo_aquisicao_unit > 0),
  custo_precificacao_unit numeric(12,2) not null check (custo_precificacao_unit > 0),
  unique (item_id, codigo)
);
create index notas_compra_distribuicao_org_codigo on public.notas_compra_distribuicao (org_id, codigo);

create table public.vinculos_fornecedor (
  org_id          uuid not null references public.organizations(id) on delete cascade,
  cnpj_fornecedor text not null check (cnpj_fornecedor ~ '^[0-9]{14}$'),
  cprod           text not null,
  codigo_pai      text not null,
  fator_conversao integer not null default 1 check (fator_conversao >= 1),
  atualizado_em   timestamptz not null default now(),
  primary key (org_id, cnpj_fornecedor, cprod)
);

alter table public.notas_compra enable row level security;
alter table public.notas_compra_itens enable row level security;
alter table public.notas_compra_distribuicao enable row level security;
alter table public.vinculos_fornecedor enable row level security;

create policy notas_compra_select on public.notas_compra for select to authenticated
  using (org_id = public.current_org_id());
create policy notas_compra_itens_select on public.notas_compra_itens for select to authenticated
  using (org_id = public.current_org_id());
create policy notas_compra_distribuicao_select on public.notas_compra_distribuicao for select to authenticated
  using (org_id = public.current_org_id());
create policy vinculos_fornecedor_select on public.vinculos_fornecedor for select to authenticated
  using (org_id = public.current_org_id());

-- Precedente de bucket via migration: 20260527123422_enums_lotes_storage.sql:80.
insert into storage.buckets (id, name, public) values ('notas-compra', 'notas-compra', false)
  on conflict (id) do nothing;
-- Leitura do XML pela org. Upload só pela edge (service_role); nenhuma policy de escrita.
create policy notas_compra_xml_select on storage.objects for select to authenticated
  using (bucket_id = 'notas-compra' and (storage.foldername(name))[1] = public.current_org_id()::text);
