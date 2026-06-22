# ADR-0035 — Monitoramento de anúncios moderados (polling + Telegram)

**Status:** Aceito
**Data:** 2026-06-22
**Relacionado:** [ADR-0006](0006-qstash-em-vez-de-fila-no-postgres.md) (QStash), [ADR-0024](0024-camada-de-abstracao-de-canais.md) (conectores), [ADR-0027](0027-multi-tenancy.md) (RLS por user), `status-publicados`, `_shared/ml/status.ts`, `_shared/queue.ts`

## Contexto

O ML modera anúncios (`status: under_review` + `sub_status` como `forbidden`,
`waiting_for_patch`, `poor_quality_thumbnail`) e tira-os do ar. Hoje o operador só percebe
abrindo a tela Publicados. Não há aviso proativo nem leitura do motivo.

Investigação na API do ML (token real, 2026-06-22):

- O item API só expõe o **código** do sub_status; sem campo de texto do motivo
  (`health: null`, `warnings: []`, sem `moderations`).
- `/moderations/infractions/search` (que teria o texto) retorna **401** — bloqueado por
  permissão do app, mesma classe do `/orders` (ver memória `reference_ml_permissao_pedidos`).
- `GET /users/{seller}/items/search?sub_status=forbidden` funciona, mas a mesma informação
  sai do `lerStatus` que a tela já usa.

Não existe infra de notificação nem de agendamento no projeto até aqui.

## Decisão

**Polling agendado + alerta**, em vez de webhook do ML.

1. **Edge function `monitorar-moderados`**, disparada por um **QStash Schedule a cada 6h**.
   Valida assinatura via `qstashReceiver` (`verify_jwt = false`, padrão dos workers).
   Reusa `getConnector('mercado_livre').lerStatus` + `parseStatusML` — sem duplicar lógica
   de status. Loop sobre `ml_credentials` (multi-tenant-ready).
2. **Tabela `ml_moderacao`** guarda o estado corrente (item, status, motivo, detectado_em,
   alertado_em, resolvido_em) só para diff e dedup de alerta. RLS por `user_id`.
3. **Telegram** como canal de push (`_shared/notificacoes/telegram.ts`), secrets
   `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`. Alerta só nos **novos** moderados.
4. **App**: banner "⚠ N moderados" na tela Publicados, contando o status ao vivo que a tela
   já busca (não depende da tabela). Tradução do código cru do motivo + link ao anúncio.

Escopo do alerta = tudo que `parseStatusML` marca como `moderado`. Pausa/encerramento
normais não disparam.

## Por que polling e não webhook

- Single-tenant, volume baixo: 6h de latência é aceitável e o item precisaria ser relido
  de qualquer forma para confirmar o estado.
- Webhook exige callback público, assinar tópicos no DevCenter e tratar entregas — custo
  que não se paga agora. Reavaliar se virar multi-tenant com muitos vendedores.

## Consequências

- Aviso proativo (app + Telegram) sem depender de o operador abrir a tela.
- Reuso total da leitura de status já testada (`lerStatus`/`parseStatusML`).
- O motivo textual continua só no painel/e-mail do ML — o alerta leva o link; destravar o
  texto via API depende de permissão de moderação no DevCenter (fora de escopo).
- Nº de filas/queries cresce com vendedores ativos — irrelevante no volume atual.
- Telegram sem secret configurado → no-op silencioso; o monitoramento e o banner do app
  seguem funcionando.
