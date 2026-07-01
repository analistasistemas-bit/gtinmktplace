---
tags: [modulo, configuracoes]
atualizado: 2026-07-01
---

# Configurações

Rota `/configuracoes` (`src/pages/Configuracoes.tsx`). Ver [[Banco de Dados]] (tabela
`configuracoes`), [[Integrações]].

## O que configura

- **Conexão Mercado Livre** — status via `useMlConnection` (lê `ml_credentials`); conectar/
  desconectar via `iniciarConexaoML`/`desconectarML` (`src/lib/ml-oauth.ts`). Ver [[Segurança]].
- **Desconto de marketing** — `desconto_pct` global por usuário (`useDescontoPct`,
  `useSalvarDescontoPct`).
- **Telegram** — `ConfigTelegram` (componente): ativa/configura alertas
  (`useTelegramConfig`, `useSalvarTelegramConfig`, `useEnviarTesteTelegram`,
  `useVerificarModeradosAgora`). Token nunca retornado pela API — só `tem_token boolean`.

## Tabela `configuracoes`

`user_id` (PK), `desconto_pct`, `telegram_ativo`, `telegram_chat_id`, `telegram_bot_token`
(sensível). Uma linha por usuário.
