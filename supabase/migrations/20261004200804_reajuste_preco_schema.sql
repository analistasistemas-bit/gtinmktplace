-- ADR-0178 — reajuste de preço em massa: rascunho, conferindo, colunas do item.
alter table public.operacoes_massa drop constraint operacoes_massa_acao_check;
alter table public.operacoes_massa add constraint operacoes_massa_acao_check
  check (acao in ('aderir','sair','pausar','reativar','reajustar'));
alter table public.operacoes_massa drop constraint operacoes_massa_acao_promocao_check;
alter table public.operacoes_massa add constraint operacoes_massa_acao_promocao_check check (
  (acao in ('aderir','sair') and promocao_id is not null and promocao_tipo is not null)
  or (acao in ('pausar','reativar','reajustar') and promocao_id is null and promocao_tipo is null));
alter table public.operacoes_massa drop constraint operacoes_massa_status_check;
alter table public.operacoes_massa add constraint operacoes_massa_status_check
  check (status in ('rascunho','executando','concluida'));
alter table public.operacoes_massa add column expira_em timestamptz;

alter table public.operacoes_massa_itens drop constraint operacoes_massa_itens_status_check;
alter table public.operacoes_massa_itens add constraint operacoes_massa_itens_status_check check (status in
  ('rascunho','pendente','enviando','conferindo','aplicado','ja_estava','mudou','bloqueado','erro','saida_solicitada'));
alter table public.operacoes_massa_itens
  add column preco_anterior numeric,
  add column etapa text check (etapa in ('escrita_pedida','ml_confirmado')),
  add column confirmado_sem_dado boolean not null default false,
  add column incluido boolean not null default true,
  add column avaliacao jsonb,
  add column estado_anterior jsonb,
  add column variacoes_ml jsonb,
  add column variacao_ids uuid[],
  add column codigo_pai text;

drop index public.operacoes_massa_itens_status_unico;
create unique index operacoes_massa_itens_status_unico on public.operacoes_massa_itens (org_id, ml_item_id)
  where promocao_id is null and status in ('pendente','enviando','conferindo');
create index operacoes_massa_itens_reajuste_ativo on public.operacoes_massa_itens (org_id, codigo_pai)
  where status in ('pendente','enviando','conferindo') and codigo_pai is not null;
