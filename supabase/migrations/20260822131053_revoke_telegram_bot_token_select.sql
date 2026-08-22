-- Achado F5 (CLAUDE-SECURITY-20260822-113640): telegram_bot_token era legível por qualquer
-- membro da org via PostgREST direto (GET .../configuracoes?select=telegram_bot_token),
-- contornando a RPC telegram_config_status() que existe justamente para nunca devolver o
-- token ao browser. A policy RLS "configuracoes: select org" e o grant table-wide de
-- 20260725224000_support_access.sql:306 cobrem a linha inteira, sem restrição de coluna.
--
-- Um revoke direto na coluna (`revoke select (telegram_bot_token) ... from authenticated`)
-- NÃO bastaria: com o grant table-wide de SELECT ainda de pé, o privilégio de coluna é
-- redundante e o token continuaria acessível pelo grant da tabela. É preciso revogar o
-- SELECT da tabela inteira e re-conceder explicitamente só as colunas não-secretas.
revoke select on public.configuracoes from authenticated;
grant select (
  org_id, user_id, criado_em, atualizado_em,
  desconto_pct, desconto_concorrencia_pct, reancora_lider_ativa, mostrar_lucro_dashboard,
  aliquota_nacional_pct, aliquota_importado_pct, aliquota_interna_pct, aliquotas_confirmadas_em, uf_empresa,
  ai_model_texto, ai_model_imagem,
  telegram_chat_id, telegram_ativo
) on public.configuracoes to authenticated;
-- telegram_bot_token fica de fora: só service_role (admin client) e a RPC
-- telegram_config_status() (security definer) continuam lendo o valor real.
