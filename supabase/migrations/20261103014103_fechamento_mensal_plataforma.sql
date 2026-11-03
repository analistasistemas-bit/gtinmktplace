-- ADR-0193 D-10/D-11 (Fatia 3): fechamento automático + aviso de fechamento mensal.
-- 1. `fechamento_mensal` entra no conjunto válido de profiles.telegram_categorias. É categoria de
--    PLATAFORMA: não está em CATEGORIAS_NOTIFICACAO (org) e só super-admin assina, pela Central
--    (platform-admin `save_notice_subscription`). notificacoes.categoria NÃO muda: sem in-app
--    (o super-admin não tem org e notificacoes.org_id é NOT NULL).
-- 2. Chave de deduplicação do aviso: uma linha 'fechamento_mensal_aviso' por competência em
--    platform_audit_events (org_id NULL, target = 'YYYY-MM'). Quem insere envia; 23505 = já enviado.
alter table public.profiles
  drop constraint if exists profiles_telegram_categorias_validas;
alter table public.profiles
  add constraint profiles_telegram_categorias_validas
  check (telegram_categorias <@ array['vendas','perguntas','pos_venda','financeiro','moderacao','mensagens','integracao','pulse','estoque','vendas_gerencial','resumo_diario','fechamento_mensal']::text[]);

create unique index platform_audit_events_aviso_fechamento_key
  on public.platform_audit_events (target)
  where action = 'fechamento_mensal_aviso';
