-- ============================================================================
-- Imposto por origem (nacional/importado) — ADR-0055
-- ============================================================================

-- Origem do produto (distinto de tipo_origem = origem da categorização ML)
create type public.origem_produto as enum ('nacional', 'importado');

alter table public.familias
  add column if not exists origem public.origem_produto not null default 'nacional';

-- Alíquotas de imposto parametrizáveis (globais por usuário)
alter table public.configuracoes
  add column if not exists aliquota_nacional_pct numeric(5,2) not null default 8,
  add column if not exists aliquota_importado_pct numeric(5,2) not null default 16;
