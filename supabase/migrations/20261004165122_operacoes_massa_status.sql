-- ADR-0174 emenda 2026-10-04 — 2º tipo do motor: pausar/reativar (sem promoção).
alter table public.operacoes_massa drop constraint operacoes_massa_acao_check;
alter table public.operacoes_massa drop constraint operacoes_massa_promocao_tipo_check;
alter table public.operacoes_massa alter column promocao_id drop not null;
alter table public.operacoes_massa alter column promocao_tipo drop not null;
alter table public.operacoes_massa add constraint operacoes_massa_acao_check
  check (acao in ('aderir','sair','pausar','reativar'));
alter table public.operacoes_massa add constraint operacoes_massa_promocao_tipo_check
  check (promocao_tipo is null or promocao_tipo in ('DEAL','SMART'));
alter table public.operacoes_massa add constraint operacoes_massa_acao_promocao_check check (
  (acao in ('aderir','sair') and promocao_id is not null and promocao_tipo is not null)
  or (acao in ('pausar','reativar') and promocao_id is null and promocao_tipo is null)
);

alter table public.operacoes_massa_itens alter column promocao_id drop not null;

-- O índice de promoção (org_id, promocao_id, ml_item_id) não barra NULL (NULLs são distintos):
-- as operações sem promoção ganham o seu.
create unique index operacoes_massa_itens_status_unico
  on public.operacoes_massa_itens (org_id, ml_item_id)
  where promocao_id is null and status in ('pendente','enviando');
