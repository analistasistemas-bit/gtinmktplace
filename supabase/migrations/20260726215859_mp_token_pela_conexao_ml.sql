-- ADR-0093 — Financeiro do Mercado Pago pela conexão OAuth do Mercado Livre.
--
-- O financeiro passa a ler a conta MP do vendedor com o token da conexão `mercado_livre` da
-- própria org (resolverConexao + getValidAccessTokenConexao). Com isso morrem os dois
-- mecanismos do token MP por org introduzidos em 20260705174455_e7_config_org.sql:
-- a RPC get_mp_token (leitura do secret no Vault) e a coluna que guardava o id desse secret.
--
-- Sem secret órfão no Vault a limpar: NENHUMA org chegou a preencher
-- configuracoes.mp_access_token_secret_id — 100% do financeiro rodava no fallback global
-- MP_ACCESS_TOKEN, que sai junto neste épico. A coluna está vazia em todas as linhas.
--
-- Ordem importa: a função lê a coluna, então ela cai primeiro.

drop function if exists public.get_mp_token(uuid);

alter table public.configuracoes drop column if exists mp_access_token_secret_id;
