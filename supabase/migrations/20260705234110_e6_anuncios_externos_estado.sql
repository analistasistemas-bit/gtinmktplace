-- ============================================================================
-- Migration: e6_anuncios_externos_estado
-- Refs: ADR-0061 (orquestração multicanal). O status de anuncios_externos vira
-- máquina de estado por canal (pendente → publicando → publicado | erro), com
-- claim atômico por linha. Linhas existentes (espelho ML) já são 'publicado'
-- (default histórico) — confirmado em produção: 66/66 = 'publicado'. Nada muda p/ elas.
-- ============================================================================

alter table public.anuncios_externos
  add constraint anuncios_externos_status_chk
  check (status in ('pendente','publicando','publicado','erro'));

-- Rastreio do job QStash do fan-out por canal (diagnóstico/idempotência).
alter table public.anuncios_externos add column if not exists qstash_message_id text;
