-- ADR-0211: esquema de ensaio com cópias VAZIAS das tabelas que a migration toca.
-- `like` pega só ACCESS SHARE nas tabelas reais; não copia FKs, políticas nem triggers.
-- Roda sempre dentro da transação desfeita de scripts/teste-sql-desfeito.py, ANTES da migration
-- (com `public.` trocado por `ensaio_adr0211.`). Ver o plano, Task 1.
create schema ensaio_adr0211;
create table ensaio_adr0211.ml_vendas (like public.ml_vendas including defaults);
create table ensaio_adr0211.estoque_movimentos (like public.estoque_movimentos including defaults);
create table ensaio_adr0211.worker_rodadas (like public.worker_rodadas including defaults);
-- Forma do upsertVenda (S2b): on conflict (user_id, order_id).
create unique index on ensaio_adr0211.ml_vendas (user_id, order_id);
grant usage on schema ensaio_adr0211 to service_role;
grant all on all tables in schema ensaio_adr0211 to service_role;

-- S14: acervo. Venda já `cancelled` gravada ANTES da migration nunca arma.
insert into ensaio_adr0211.ml_vendas (user_id, org_id, order_id, status, raw) values
  ('a0211000-0000-0000-0000-0000000000a1', 'a0211000-0000-0000-0000-000000000001', 7001, 'cancelled',
   '{"status":"cancelled","last_updated":"2026-11-20T10:00:30.000-04:00"}');
