-- ADR-0190 — categorias gerenciais de notificação: 'vendas_gerencial' e 'resumo_diario'.
-- Sincronia manual com os dois categorias.ts. Quem pode assinar (só admin, chat privado) é regra
-- da edge usuarios/sanitizarDestinatario; aqui só o conjunto válido.
alter table public.notificacoes drop constraint notificacoes_categoria_check;
alter table public.notificacoes add constraint notificacoes_categoria_check
  check (categoria in ('vendas','perguntas','pos_venda','financeiro','moderacao','mensagens','integracao','pulse','estoque','vendas_gerencial','resumo_diario'));

alter table public.profiles
  drop constraint if exists profiles_telegram_categorias_validas;
alter table public.profiles
  add constraint profiles_telegram_categorias_validas
  check (telegram_categorias <@ array['vendas','perguntas','pos_venda','financeiro','moderacao','mensagens','integracao','pulse','estoque','vendas_gerencial','resumo_diario']::text[]);
