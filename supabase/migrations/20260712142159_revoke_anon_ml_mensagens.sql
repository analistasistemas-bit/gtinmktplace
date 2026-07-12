-- ml_mensagens: linha `grant all ... to anon, authenticated` da migration 20260711120000 contradiz
-- o comentário dela própria e o precedente de ml_perguntas (só select). Confirmado em produção:
-- anon tem hoje SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER. Least-privilege: anon não
-- deve ter DML em PII de comprador.
revoke all on public.ml_mensagens from anon;
revoke insert, update, delete, truncate, references, trigger on public.ml_mensagens from authenticated;
grant select on public.ml_mensagens to authenticated;
