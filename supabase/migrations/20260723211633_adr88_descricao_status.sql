-- ADR-0088 Fase 2 — sincronização de descrição no UPDATE de família User Products.
-- Espelha exatamente o padrão de `atacado_status`/`atacado_erro` (20260621205757_preco_atacado_pxq.sql):
-- estado durável e agregado por-família (não por-item) pra quando o push da descrição recalculada
-- falha em 1+ itens ML — sem isto a falha só existia como notificação efêmera (revisão Codex+Opus).
alter table public.familias
  add column if not exists descricao_status text,
  add column if not exists descricao_erro   text;
