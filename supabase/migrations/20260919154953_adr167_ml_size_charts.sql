-- ADR-0167: cache do guia de tamanhos (chart) do ML por conexao + dominio + genero.
-- Chart e propriedade da conta ML (Spike 051 SS9) e imutavel (Decisao 4 do ADR) -- nunca editado
-- apos criado; um conjunto de tamanhos novo cria um chart novo, o antigo fica intocado.
-- Mesmo padrao de ml_formato_publicacao (ADR-0088): cache por conexao, nunca por familia.
-- Escrita so por service_role.
-- ----------------------------------------------------------------------------
create table public.ml_size_charts (
  connection_id uuid not null references public.marketplace_connections(id) on delete cascade,
  domain_id     text not null,
  genero        text not null check (genero in ('masculino', 'feminino', 'unissex')),
  chart_id      text not null,
  linhas        jsonb not null, -- mapa tamanho -> row_id, ex. {"P": "8522331:1", "M": "8522331:2"}
  criado_em     timestamptz not null default now(),
  primary key (connection_id, domain_id, genero)
);

comment on table public.ml_size_charts is
  'ADR-0167: cache do chart de guia de tamanhos do ML por conexao+dominio+genero. Imutavel -- nunca dar update em linhas, so inserir novo chart.';

alter table public.ml_size_charts enable row level security;

-- Sem org_id direto: a org vem da conexao, mesmo padrao de ml_formato_publicacao.
create policy "ml_size_charts: select org" on public.ml_size_charts
  for select to authenticated
  using (
    exists (
      select 1 from public.marketplace_connections mc
      where mc.id = ml_size_charts.connection_id
        and mc.org_id = (select public.current_org_id())
    )
  );
