-- Sonar (ADR-0127): histórico de snapshots por anúncio por garimpo fresco.
-- GLOBAL, sem org_id, de propósito: mesmo dado público que já vive em cache Redis com chave
-- global (ADR-0120 §3). Escrita só service_role (edge pulse-sonar-vendas), leitura autenticada.
create table if not exists public.sonar_snapshots (
  id uuid primary key default gen_random_uuid(),
  termo text not null,                 -- normalizado (trim/lower/espaço único), igual à chave de cache
  gerado_em timestamptz not null,      -- gerado_em do painel: idempotência natural no retry
  item_id text not null,               -- idPublicacao (MLB…)
  titulo text,
  preco numeric(12,2),                 -- null = não veio (LOUD)
  vendidos integer,                    -- cru pós-parseVendidos; null nunca 0; delta futuro = PISO (D13)
  posicao integer,
  patrocinado boolean,                 -- tipoResultado !== 'ORGANIC'; null = desconhecido
  vendedor text,                       -- nickname (cobertura 13/20 no termo medido em 18/08)
  catalog_product_id text,             -- presente em ~20-30% (medido 18/08)
  criado_em timestamptz not null default now()
);
create unique index if not exists sonar_snapshots_termo_item_gerado_uniq
  on public.sonar_snapshots (termo, item_id, gerado_em);
create index if not exists sonar_snapshots_item_gerado_idx
  on public.sonar_snapshots (item_id, gerado_em desc);  -- a série do drill-down futuro é por anúncio

alter table public.sonar_snapshots enable row level security;
-- `create policy` não tem `if not exists`; o drop antes torna o re-run seguro (db push não é transacional).
drop policy if exists "sonar_snapshots: select autenticado" on public.sonar_snapshots;
create policy "sonar_snapshots: select autenticado"
  on public.sonar_snapshots for select to authenticated using (true);
grant select on public.sonar_snapshots to authenticated;
-- escrita: nenhuma policy de insert/update/delete — só service_role (edge), como pulse_v1
