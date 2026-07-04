alter table public.configuracoes
  add column if not exists desconto_concorrencia_pct numeric(5,2) not null default 5;
