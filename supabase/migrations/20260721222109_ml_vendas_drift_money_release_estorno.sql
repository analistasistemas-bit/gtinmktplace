-- ============================================================================
-- Realinhamento de drift: ml_vendas.money_release_date + ml_vendas.estorno
-- ============================================================================
-- Ambas as colunas existem em produção mas foram aplicadas por DDL fora do
-- fluxo de migration (painel/apply_migration), violando ADR-0043. Nenhuma
-- migration anterior as cria — o histórico não reconstrói o schema real, então
-- um `db reset` / rebuild de DR / provisionamento de novo tenant (E7) geraria
-- um banco SEM elas, quebrando em runtime: registrar_saque_ml_vendas e
-- notificar-liberacao (usam money_release_date) e sync-devolucao (grava estorno).
--
-- Idempotente (`if not exists`) → no-op em produção (colunas já existem);
-- só registra a definição no histórico. Tipos espelham o banco vivo
-- (information_schema): ambas nullable, sem default.
--   money_release_date timestamptz — quando o ML libera o recebimento
--   estorno            numeric      — valor estornado em devolução (R$)

alter table public.ml_vendas
  add column if not exists money_release_date timestamptz,
  add column if not exists estorno numeric;
