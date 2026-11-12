-- ADR-0203 item 11 — aviso "suas imagens ficaram prontas" (galeria por IA), só para quem pediu.
-- Categoria 'imagem_ia' só em notificacoes (não assinável: profiles_telegram_categorias_validas fica igual).
-- Lista vigente = 20261025013718_categorias_gerenciais_telegram.sql + 'imagem_ia'.
alter table public.notificacoes drop constraint notificacoes_categoria_check;
alter table public.notificacoes add constraint notificacoes_categoria_check
  check (categoria in ('vendas','perguntas','pos_venda','financeiro','moderacao','mensagens','integracao','pulse','estoque','vendas_gerencial','resumo_diario','imagem_ia'));
