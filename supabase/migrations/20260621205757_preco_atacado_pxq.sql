-- Preço de atacado (PxQ) no Mercado Livre — ADR-0035.
alter table public.familias
  add column if not exists atacado         jsonb,
  add column if not exists atacado_status  text,
  add column if not exists atacado_erro    text;

alter table public.lotes
  add column if not exists atacado_default jsonb;;
