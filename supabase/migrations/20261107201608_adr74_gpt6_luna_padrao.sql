-- ============================================================================
-- Migration: adr74_gpt6_luna_padrao
-- Refs: ADR-0074 (modelo de IA por org, adendo de 2026-11-07).
--
-- openai/gpt-6-luna entra na lista curada e vira o padrão de todas as orgs.
-- Mediu 76 de 76 copies sem falha e menos da metade do custo do gpt-4.1-mini.
-- Orgs com NULL herdam MODELO_COPY. A org fixada no modelo antigo migra aqui,
-- porque o valor gravado vence o default do código.
-- ============================================================================

-- Drop antes do update: a check antiga rejeitaria o slug novo.
alter table public.configuracoes
  drop constraint if exists configuracoes_ai_model_texto_check;

update public.configuracoes
  set ai_model_texto = 'openai/gpt-6-luna'
  where ai_model_texto = 'openai/gpt-4.1-mini';

-- Todo slug aqui precisa existir em _shared/ai/tokens.ts::PRECOS. Estender exige nova migration.
-- gpt-4.1-mini e gpt-4o-mini seguem selecionáveis como saída de emergência.
alter table public.configuracoes
  add constraint configuracoes_ai_model_texto_check
    check (ai_model_texto is null or ai_model_texto in ('openai/gpt-6-luna', 'openai/gpt-4.1-mini', 'openai/gpt-4o-mini'));

comment on column public.configuracoes.ai_model_texto is
  'Slug OpenRouter do modelo de texto da org (ADR-0074). NULL = usa fallback do env (MODELO_COPY, hoje openai/gpt-6-luna).';
