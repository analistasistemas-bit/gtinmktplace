-- ============================================================================
-- Migration: adr98_gpt41_mini_padrao
-- Refs: ADR-0098 (copy ancorada na fonte), ADR-0074 (modelo de IA por org),
--       ADR-0030 (copy é a única etapa de IA sem fallback resiliente).
--
-- Duas mudanças na lista curada de modelos de texto:
--
-- 1. ENTRA openai/gpt-4.1-mini ($0,40/$1,60 por 1M), que passa a ser o padrão.
--    O experimento do ADR-0098 mediu, em 3 execuções sobre os mesmos produtos:
--    ancoragem perfeita (zero fórmula proibida e zero medida não ancorada nas
--    três) e mais variedade entre anúncios que o gpt-4o-mini, que escorregou em
--    ambas as métricas.
--
-- 2. SAI deepseek/deepseek-v4-flash-0731. Era o mais barato, mas devolvia JSON
--    truncado sob json_schema strict (falhou em 1 dos 3 primeiros produtos do
--    experimento). Como gerarCopy não tem fallback resiliente, falha ali derruba
--    a família inteira — eliminatório independente do preço.
-- ============================================================================

-- Drop antes do update: a check antiga rejeitaria o slug novo.
alter table public.configuracoes
  drop constraint if exists configuracoes_ai_model_texto_check;

-- Orgs fixadas explicitamente no modelo antigo migram para o novo padrão. Sem isto
-- elas ficariam presas ao gpt-4o-mini: o valor gravado vence o default de MODELO_COPY,
-- então trocar a constante do código não as alcançaria (caso real: a org Avil tinha
-- 'openai/gpt-4o-mini' gravado; a DSA tinha null e já herda o padrão novo).
update public.configuracoes
  set ai_model_texto = 'openai/gpt-4.1-mini'
  where ai_model_texto = 'openai/gpt-4o-mini';

-- Nenhuma org usava o DeepSeek, mas o update abaixo é a rede de segurança: um valor
-- fora da lista curada faria custoCentavos contabilizar a família como custo zero.
update public.configuracoes
  set ai_model_texto = 'openai/gpt-4.1-mini'
  where ai_model_texto in ('deepseek/deepseek-v4-flash-0731', 'deepseek/deepseek-v4-flash');

-- Lista curada e fechada: todo slug de texto aqui precisa existir em
-- _shared/ai/tokens.ts::PRECOS. Estender exige nova migration.
-- gpt-4o-mini continua selecionável (é mais barato) — só deixa de ser o padrão.
alter table public.configuracoes
  add constraint configuracoes_ai_model_texto_check
    check (ai_model_texto is null or ai_model_texto in ('openai/gpt-4.1-mini', 'openai/gpt-4o-mini'));

comment on column public.configuracoes.ai_model_texto is
  'Slug OpenRouter do modelo de texto da org (ADR-0074). NULL = usa fallback do env (MODELO_COPY, hoje openai/gpt-4.1-mini por ADR-0098).';
