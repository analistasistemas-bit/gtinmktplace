-- Liveness da integração ML (ADR-0069): estado por conexão para distinguir token morto de
-- silêncio por falta de vendas. `service_role`/RPC escrevem (nenhum grant adicional).
alter table public.marketplace_connections
  add column ultima_sincronizacao_ok_em timestamptz,
  add column auth_alerta_em timestamptz;
