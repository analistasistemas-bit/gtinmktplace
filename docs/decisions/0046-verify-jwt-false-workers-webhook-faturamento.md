# ADR-0046 — verify_jwt=false para webhook e workers de faturamento

**Data:** 2026-06-28
**Status:** aceito
**Contexto:** faturamento via webhooks (ADR-0037), workers QStash (ADR-0006), incidente
anterior de `verify_jwt` em workers (`reference_workers_qstash_verify_jwt`)

## Contexto

O `config.toml` marcava `verify_jwt = true` para `ml-webhook`, `sync-venda`,
`backfill-faturamento` e `reconciliar-faturamento`. Com `verify_jwt = true`, o gateway do
Supabase exige um JWT Supabase válido **antes** de executar a função.

Essas funções, porém, **não recebem JWT Supabase**:

- `ml-webhook` é chamado pelo Mercado Livre (sem JWT). Autentica fazendo ACK e re-busca
  autenticado no worker.
- `sync-venda` e `reconciliar-faturamento` são acionados pelo QStash, que publica **sem**
  header `Authorization` (`_shared/queue.ts`). Autenticam pela assinatura `upstash-signature`
  (`verificarAssinatura`).
- `backfill-faturamento` aceita dois modos: usuário logado (`requireUser`) **ou** QStash
  (`verificarAssinatura`); valida ambos internamente.

Resultado: o gateway rejeitava as chamadas com **401 antes da função rodar**.

### Evidência (function_edge_logs, 24h, 2026-06-28)

| Função | verify_jwt | Requisições | Resultado |
|---|---|---|---|
| `ml-webhook` | true | 221 | 401 (100%) |
| `backfill-faturamento` | true | 92 | 401 (100%) |
| `monitorar-moderados` (controle) | false | 3 | 200 |
| `notificar-liberacao` (controle) | false | 1 | 200 |

Como `ml-webhook` enfileira `sync-venda`/`sync-pergunta`/`sync-devolucao`, a rejeição dele
parou **todo o faturamento em tempo real** (cascata). `sync-pergunta`/`sync-devolucao` já
estavam corretamente com `verify_jwt = false`.

## Decisão

Definir `verify_jwt = false` no `config.toml` para `ml-webhook`, `sync-venda`,
`reconciliar-faturamento` e `backfill-faturamento`, e redeployar as quatro via CLI. A
autenticação real continua dentro de cada função (assinatura QStash e/ou `requireUser`).

Mantém a verdade no `config.toml` (não usar a flag `--no-verify-jwt` no deploy), para o deploy
ser reprodutível — alinhado a ADR-0043 e à regra "deploy nunca defasado".

## Consequências

- **Positivas:** restaura webhooks de venda/pergunta/devolução, o backfill agendado e a
  reconciliação periódica. A autenticação não enfraquece (a validação por assinatura/JWT
  permanece dentro da função).
- **Atenção:** `verify_jwt` dessas funções precisa permanecer `false`. Um deploy futuro que
  reverta o `config.toml` reintroduz o 401 (já aconteceu com `process-familia`). A regra 9 do
  CLAUDE.md + `docs/reference/edge-functions.md` registram a checagem.
- **Monitoramento:** após o deploy, conferir nos `function_edge_logs` que `ml-webhook` volta a
  responder 2xx e que `sync-venda` passa a aparecer (enfileirado de novo).
