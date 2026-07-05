-- ============================================================================
-- Migration: secure_trigger_and_indexes
-- Refs: Plano 03 Task 3 code quality review.
-- Fixes:
--   A) revoke execute em update_lote_counters (trigger-only, sem RPC pública)
--   B) drop índices redundantes (cobertos pelos unique constraints)
--   C) substitui familias_status_idx por composto (lote_id, status) — usado
--      pelo próprio counter trigger
-- ============================================================================

-- Fix A
revoke execute on function public.update_lote_counters() from public, anon, authenticated;

-- Fix B
drop index if exists public.familias_lote_id_idx;
drop index if exists public.variacoes_familia_id_idx;

-- Fix C
drop index if exists public.familias_status_idx;
-- idempotente: 20260527125643_familias_variacoes.sql já cria este índice idêntico
-- (edição retroativa daquela migration). Sem `if not exists`, o replay do zero
-- (ensaio/novo ambiente) falha ao recriar. Behavior-preserving em produção (já aplicada).
create index if not exists familias_lote_id_status_idx on public.familias (lote_id, status);
