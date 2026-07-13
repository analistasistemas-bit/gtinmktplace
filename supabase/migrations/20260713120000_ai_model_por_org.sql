-- ============================================================================
-- Migration: ai_model_por_org
-- Refs: ADR-0071. Seleção de modelo de IA (texto/imagem) por organização.
-- ============================================================================

alter table public.configuracoes
  add column if not exists ai_model_texto text,
  add column if not exists ai_model_imagem text;

-- Lista curada e fechada (evita custo-fantasma: todo slug aqui precisa existir em
-- _shared/ai/tokens.ts::PRECOS quando for de texto). Estender exige nova migration.
alter table public.configuracoes
  drop constraint if exists configuracoes_ai_model_texto_check;
alter table public.configuracoes
  add constraint configuracoes_ai_model_texto_check
    check (ai_model_texto is null or ai_model_texto in ('openai/gpt-4o-mini', 'deepseek/deepseek-v4-flash'));

alter table public.configuracoes
  drop constraint if exists configuracoes_ai_model_imagem_check;
alter table public.configuracoes
  add constraint configuracoes_ai_model_imagem_check
    check (ai_model_imagem is null or ai_model_imagem in ('google/gemini-2.5-flash-image'));

comment on column public.configuracoes.ai_model_texto is
  'Slug OpenRouter do modelo de texto da org (ADR-0071). NULL = usa fallback do env (MODELO_COPY).';
comment on column public.configuracoes.ai_model_imagem is
  'Slug OpenRouter do modelo de imagem da org (ADR-0071). Dormente: sem consumidor até a geração de imagem ser implementada.';
