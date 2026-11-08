-- ADR-0197 (Task 15): foto da combinação do kit com variação gerada por IA (módulo `imagem_ia`).
--
-- 1. `ai_model_imagem` deixa de ser dormente (ADR-0074) e aceita o padrão decidido em 07/11 (Nano Banana 2.1).
--    O 2.5 Flash Image continua aceito para não invalidar o que alguma org já salvou. Todo slug aqui está em
--    `src/lib/ai-modelos.ts::MODELOS_IMAGEM` e em `_shared/ai/tokens.ts::PRECOS`.
-- 2. `kit_variacao_imagens`: registro durável de cada geração, idempotente por (org, request_id). A edge
--    `gerar-foto-kit` reserva a linha (`pendente`) antes de chamar a IA; falha do provedor apaga a reserva (nada a
--    cobrar); imagem entregue ao operador vira `gerada` com o custo real do provedor; imagem gerada mas imprópria
--    para o ML (ou que não subiu ao storage) vira `recusada`, com o custo real e fora da cobrança.
--    A cobrança (Task 16) conta só `status = 'gerada'`, inclusive a imagem que o operador descartou.
-- Escrita só por service role. Re-executável (`db push` não roda em transação).

alter table public.configuracoes
  drop constraint if exists configuracoes_ai_model_imagem_check;
alter table public.configuracoes
  add constraint configuracoes_ai_model_imagem_check
    check (ai_model_imagem is null or ai_model_imagem in ('google/gemini-nano-banana-2.1', 'google/gemini-2.5-flash-image'));

comment on column public.configuracoes.ai_model_imagem is
  'Slug OpenRouter do modelo de imagem da org (ADR-0074, ADR-0197). Usado pela foto do kit com variação '
  '(edge gerar-foto-kit). NULL = padrão google/gemini-nano-banana-2.1.';

create table if not exists public.kit_variacao_imagens (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id),
  request_id      uuid not null,
  status          text not null default 'pendente' check (status in ('pendente', 'gerada', 'recusada')),
  familia_base_id uuid not null,
  cores           text[] not null,
  rotulo          text not null,
  modelo          text not null,
  storage_path    text,
  -- Custo real do provedor (OpenRouter `usage.cost`, US$), visão + geração. Sem `usage.cost`, estimativa por PRECOS.
  custo_usd       numeric(12, 6) check (custo_usd is null or custo_usd >= 0),
  criado_por      uuid,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  unique (org_id, request_id),
  check (status <> 'gerada' or (storage_path is not null and custo_usd is not null and custo_usd > 0))
);
create index if not exists kit_variacao_imagens_cobranca_idx
  on public.kit_variacao_imagens (org_id, criado_em) where status = 'gerada';
alter table public.kit_variacao_imagens enable row level security;
revoke all on public.kit_variacao_imagens from anon, authenticated;

comment on table public.kit_variacao_imagens is
  'ADR-0197: cada geração de foto do kit com variação por IA, idempotente por (org_id, request_id). '
  'Cobrança (Task 16): status = ''gerada''.';
