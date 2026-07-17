---
tags: [modulo, configuracoes]
atualizado: 2026-07-09
---

# Configurações

Rota `/configuracoes` (`src/pages/Configuracoes.tsx`). Ver [[Banco de Dados]] (tabela
`configuracoes`), [[Integrações]].

**Escopo por ORGANIZAÇÃO desde o E7** (ADR-0027, migration `20260705174455_e7_config_org.sql`)
— era por usuário antes disso. Toda leitura/escrita filtra por `org_id` (`fetchX`/`upsertX` em
`src/lib/queries.ts`); `user_id` continua gravado no upsert como auditoria (quem editou por
último), não como chave de escopo. Uma organização = uma linha em `configuracoes`.

## O que configura

- **Conexão Mercado Livre** — status via `useMlConnection` (lê `ml_credentials`); conectar/
  desconectar via `iniciarConexaoML`/`desconectarML` (`src/lib/ml-oauth.ts`). Ver [[Segurança]].
- **Desconto de marketing** — `desconto_pct` por org (`useDescontoPct`, `useSalvarDescontoPct`).
- **Telegram** — `ConfigTelegram` (componente): ativa/configura alertas
  (`useTelegramConfig`, `useSalvarTelegramConfig`, `useEnviarTesteTelegram`,
  `useVerificarModeradosAgora`). Token nunca retornado pela API — só `tem_token boolean`.
- **Alíquota de imposto por origem** — `aliquota_nacional_pct` (default 8%) e
  `aliquota_importado_pct` (default 16%), por org, sem override por família.
  Descontada do líquido e somada ao gross-up do preço sugerido em todas as telas (ADR-0055),
  **exceto** o "Líquido" em Financeiro › Detalhe do líquido, que nunca desconta imposto — bate
  1:1 com o Mercado Pago (ADR-0066). O Markup dessa tela continua líquido de imposto normalmente.
- **Desconto sobre concorrência** — `desconto_concorrencia_pct` (default 5%), por org
  (`useDescontoConcorrenciaPct`, `useSalvarDescontoConcorrenciaPct`). Aplicado em
  `sugerirPrecoVenda` quando há concorrente: `preço = menor_concorrente × (1 − pct/100)`
  (ADR-0059, antes fixo em 5% no ADR-0020).
- **Re-âncora no maior vendedor MercadoLíder** — `reancora_lider_ativa` (default false, por
  org, `useReancoraLiderAtiva`, `useSalvarReancoraLiderAtiva`). Quando ligado, se o preço
  competitivo der prejuízo real, `sugerirPrecoVenda` re-ancora no preço do concorrente
  MercadoLíder com mais vendas em vez do menor preço global (ADR-0065).
- **Mostrar lucro no Dashboard** — `mostrar_lucro_dashboard` (default false, por org,
  `useMostrarLucroDashboard`, `useSalvarMostrarLucroDashboard`). Liga a linha "lucro R$ X" no
  card "Líquido no faturamento" do Dashboard (oculta por padrão).

## Tabela `configuracoes`

`org_id` (FK `organizations`, `NOT NULL`, **único** — 1 linha por org), `user_id` (legado,
auditoria de quem editou), `desconto_pct`, `telegram_ativo`, `telegram_chat_id`,
`telegram_bot_token` (sensível), `aliquota_nacional_pct`, `aliquota_importado_pct`,
`desconto_concorrencia_pct`, `reancora_lider_ativa`, `mostrar_lucro_dashboard`,
`mp_access_token_secret_id` (FK→`vault.secrets`, token Mercado Pago por org, ADR-0027 D-E7.7).
