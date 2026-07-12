-- Adiciona a categoria 'integracao' (ADR-0069) — alerta de liveness quando o token OAuth do ML
-- é revogado/expira e os workers de sync (venda/pergunta/devolução) param de sincronizar.
alter table public.profiles
  drop constraint if exists profiles_telegram_categorias_validas;
alter table public.profiles
  add constraint profiles_telegram_categorias_validas
  check (telegram_categorias <@ array['vendas','perguntas','pos_venda','financeiro','moderacao','mensagens','integracao']::text[]);
