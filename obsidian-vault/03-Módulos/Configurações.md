---
tags: [modulo, configuracoes]
atualizado: 2026-07-04
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
- **Alíquota de imposto por origem** — `aliquota_nacional_pct` (default 8%) e
  `aliquota_importado_pct` (default 16%), globais por usuário, sem override por família.
  Descontada do líquido e somada ao gross-up do preço sugerido em todas as telas (ADR-0055).
- **Desconto sobre concorrência** — `desconto_concorrencia_pct` (default 5%), global por
  usuário (`useDescontoConcorrenciaPct`, `useSalvarDescontoConcorrenciaPct`). Aplicado em
  `sugerirPrecoVenda` quando há concorrente: `preço = menor_concorrente × (1 − pct/100)`
  (ADR-0059, antes fixo em 5% no ADR-0020).

## Tabela `configuracoes`

`user_id` (PK), `desconto_pct`, `telegram_ativo`, `telegram_chat_id`, `telegram_bot_token`
(sensível), `aliquota_nacional_pct`, `aliquota_importado_pct`, `desconto_concorrencia_pct`.
Uma linha por usuário.
