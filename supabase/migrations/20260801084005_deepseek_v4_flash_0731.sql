-- ============================================================================
-- Migration: deepseek_v4_flash_0731
-- Refs: ADR-0074. Troca o slug DeepSeek pela revisão 0731 (mesmo preço:
-- $0,09/1M in · $0,18/1M out). O slug antigo sai da lista curada.
-- ============================================================================

-- Drop antes do update: a check antiga rejeitaria o slug novo.
alter table public.configuracoes
  drop constraint if exists configuracoes_ai_model_texto_check;

-- Orgs já configuradas com o slug antigo migram junto — senão ficariam com um
-- valor fora da lista curada (custo contabilizado como 0 em tokens.ts::PRECOS).
update public.configuracoes
  set ai_model_texto = 'deepseek/deepseek-v4-flash-0731'
  where ai_model_texto = 'deepseek/deepseek-v4-flash';

alter table public.configuracoes
  add constraint configuracoes_ai_model_texto_check
    check (ai_model_texto is null or ai_model_texto in ('openai/gpt-4o-mini', 'deepseek/deepseek-v4-flash-0731'));
