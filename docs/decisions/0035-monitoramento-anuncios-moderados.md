# ADR-0035 — Monitoramento de anúncios moderados (polling + Telegram)

**Status:** Aceito
**Data:** 2026-06-22
**Relacionado:** [ADR-0006](0006-qstash-em-vez-de-postgres-queue.md) (QStash), [ADR-0024](0024-camada-de-abstracao-de-canais.md) (conectores), [ADR-0027](0027-multi-tenancy-organizations.md) (RLS por user), `status-publicados`, `_shared/ml/status.ts`, `_shared/queue.ts`

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

## Adendo 2026-08-25 — pausa preventiva não é moderação

`parseStatusML` tratava **todo** `status: under_review` como moderado. O ML também usa
`under_review` para **pausa preventiva** (`sub_status: suspended_for_prevention`), que a doc
oficial ("Moderaciones con pausado") separa das moderações por infração: causas são preço
atípico, item sem vendas/abandonado e imagem por URL ainda não processada — "este tipo de
moderação preventiva só pausa a publicação", e o vendedor reativa com `PUT /items status=active`.

**Incidente:** 25/08/2026 09:00 (BRT), org AVIL. Os anúncios MLB5040504553 (Nivea Sabonete
Líquido) e MLB5001755829 (Principia Gel de Limpeza) — ambos com estoque zerado — foram lidos como
`under_review` + `suspended_for_prevention` e dispararam "2 anúncios moderados pelo Mercado Livre"
no Telegram e nas notificações in-app. Às 16:41 UTC os dois já estavam de volta em
`paused`/`out_of_stock` no ML, sem qualquer moderação. Zerar estoque não é a causa direta: dos 5
anúncios da org com estoque 0, só esses 2 entraram em pausa preventiva, e um deles estava zerado
havia 5 dias.

**Decisão:** `suspended_for_prevention` **sozinho** no `sub_status` mapeia para `pausado`, não
`moderado` (e portanto sem `motivo`). Acompanhado de qualquer marcador de `MODERACAO_SUBS`
(`forbidden`, `waiting_for_patch`, `poor_quality_thumbnail`, `poor_quality_picture`) continua
`moderado`. `under_review` sem `sub_status`, ou com qualquer outro código
(`pending_documentation`, `picture_downloading_pending`, …), segue `moderado` — comportamento
inalterado.

**Escopo do desvio:** só `under_review` vira `pausado` por pausa preventiva. `closed` e `inactive`
com o mesmo `sub_status` mantêm `encerrado`/`inativo` — `pausado` é o único estado que
`sincronizar-estoque` reativa sem decisão humana, e alargar esse balde reabriria a escrita que fez
o ML cancelar um anúncio em 06/08/2026.

**Consequência aceita:** como pausa preventiva vira `pausado`, uma reposição de estoque faz
`sincronizar-estoque` reativar o anúncio (ADR-0111, `reativarSePausado` → `PUT status=active`) —
que é exatamente o caminho de recuperação que o ML documenta para esse caso.
