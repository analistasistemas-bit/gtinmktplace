-- ============================================================================
-- Migration: ml_vendas_org_index
-- Refs: ADR-0027 (multi-tenancy). A RLS de ml_vendas virou org-based em
-- 20260705165828_e7_rls_org.sql, mas nenhum índice em org_id foi criado.
-- O único índice existente (ml_vendas_user_data_idx, user_id + date_closed)
-- não serve mais o predicado de RLS (org_id) nem o filtro de data usado por
-- buscarVendas() (src/lib/faturamento.ts) — cai em varredura sequencial,
-- que piora conforme a tabela cresce. Mantém o índice antigo: workers
-- (edge functions, service_role, sem RLS) ainda fazem lookups por user_id.
-- ============================================================================

create index if not exists ml_vendas_org_data_idx
  on public.ml_vendas (org_id, date_closed desc);
