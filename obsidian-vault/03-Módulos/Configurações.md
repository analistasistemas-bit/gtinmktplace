---
tags: [modulo, configuracoes]
atualizado: 2026-08-11
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
  A org precisa **confirmar** as alíquotas (`aliquotas_confirmadas_em`) — sem confirmação o
  imposto falha **LOUD** em vez de aplicar 8/16 em silêncio, e a tela mostra banner + botão
  "Confirmar alíquotas" (ADR-0086).
- **Venda dentro do estado (alíquota interna)** — `uf_empresa` + `aliquota_interna_pct`
  (ADR-0112, migration `20260812004735`), nullable e **sem default**; edição restrita a admin.
  Quando a UF de entrega do pedido (`ml_vendas.uf`) é igual à `uf_empresa`, essa alíquota
  **sobrepõe a origem** — vale para nacional e para importado. Nulos = parâmetro desligado =
  regra da ADR-0055 inalterada.
  - **Trava LOUD de meia-configuração:** salvar exige os dois campos preenchidos ou os dois
    vazios; UF sem percentual (ou o contrário) é recusado na UI e no `salvarAliquotas`.
  - **Escopo: só apuração pós-venda.** Preço sugerido, gross-up (`_shared/preco/sugerir.ts`),
    `etiquetaParaMinimo` e o "Você recebe por venda" continuam na alíquota por origem — o anúncio
    tem preço único para o país e a UF do comprador só existe depois do pedido.
  - Imposto e markup não são persistidos (são derivados na leitura), então ligar o parâmetro
    **recalcula todo o histórico exibido** sem backfill.
  - **Em produção (2026-08-11):** org **Avil** com `uf_empresa = PE` e `aliquota_interna_pct = 1`
    (72 pedidos entregues em PE no histórico); org DSA segue sem o parâmetro.
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
`aliquotas_confirmadas_em`, `uf_empresa`, `aliquota_interna_pct`, `desconto_concorrencia_pct`,
`reancora_lider_ativa`, `mostrar_lucro_dashboard`. Não há mais coluna de token do Mercado Pago —
a conta MP é lida com o token da conexão `mercado_livre` (ADR-0093).

`uf_empresa`/`aliquota_interna_pct` têm CHECK de coerência (os dois ou nenhum), formato de UF e
faixa 0–100. Por serem nullable, a migration do ADR-0112 **não desconfirma** nenhuma org.
