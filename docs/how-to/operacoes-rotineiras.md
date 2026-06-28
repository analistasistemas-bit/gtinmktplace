# How-to — Operações rotineiras

> **Tipo:** How-to (Diátaxis). Procedimentos operacionais recorrentes. Runbooks mais longos
> ficam em [../runbooks/](../runbooks/). Conceitos em
> [../explanation/arquitetura.md](../explanation/arquitetura.md).

## Reprocessar família travada em "erro"

**Pela UI:** tela de Revisão → família em erro → botão "Reenviar" (uma) ou "Reenviar N com
erro" (todas do lote).

**Por API** (precisa de JWT do usuário):

```bash
curl -X POST https://<project>.supabase.co/functions/v1/reprocessar-familia \
  -H "Authorization: Bearer <user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"familia_id":"<id>"}'      # ou {"lote_id":"<id>"} p/ todas as do lote
```

A função reseta `erro → pendente` e re-enfileira (guard idempotente — ADR-0030).

## Destravar família/worker enfileirando no QStash na mão

Quando uma família ficou em estado inconsistente e o reprocessamento normal não cobre:

1. **Reset do estado** via SQL (canal canônico): voltar `status` para `pendente`.
2. **Enfileirar** disparando o `curl` do QStash **do próprio projeto** (com `QSTASH_TOKEN` e a
   URL da função). **Não** use o MCP do QStash para isso — ele faz double-encode do body.
3. Deploy/ações de CLI usam o `SUPABASE_ACCESS_TOKEN` do `.env.local`.

Contexto e armadilhas em `reference_reenfileirar_qstash_manual` (memória do projeto) e ADR-0030.
A automação do botão "Reenviar" é a forma suportada (ADR-0030); o passo manual é exceção.

## Reconectar OAuth do Mercado Livre

Se a publicação falhar com "token expirado" e o refresh automático (lock Redis — ADR-0012) não
resolver:

1. Tela **Configurações** → "Reconectar Mercado Livre" (refaz o fluxo `ml-oauth-start` →
   `ml-oauth-callback`).
2. Confirme que `ml_credentials` foi atualizado (novo `expires_at`).

O refresh de token é automático e protegido por lock; não há ação manual no fluxo normal.

## Monitorar anúncios moderados

Configuração, deploy (`--no-verify-jwt`... veja a ressalva abaixo) e agendamento estão no
runbook dedicado: [../runbooks/monitorar-moderados.md](../runbooks/monitorar-moderados.md).
Resumo: configurar Telegram em Configurações, deployar `monitorar-moderados`, agendar no QStash
(ex.: a cada 6h). A função alerta moderações novas e marca resolvidas (ADR-0035).

> Nota: o runbook menciona `--no-verify-jwt`; o estado atual de `verify_jwt` por função vive no
> `config.toml` (ver [edge-functions.md](../reference/edge-functions.md)). Prefira manter o
> valor no `config.toml` a passar a flag no deploy.

## Faturamento: backfill e reconciliação

- **Backfill retroativo** (um período): tela de Faturamento dispara `backfill-faturamento` com
  o JWT do usuário. Não traz frete (shipment).
- **Reconciliação periódica**: `reconciliar-faturamento` roda por schedule do QStash e cobre
  webhooks perdidos (~72h). Ver [edge-functions.md](../reference/edge-functions.md).

> Antes de confiar nesses fluxos, confira a nota de inconsistências de `verify_jwt` em
> [edge-functions.md](../reference/edge-functions.md#inconsistências-conhecidas-de-verify_jwt) —
> `sync-venda`/`reconciliar-faturamento` podem não estar executando se o gateway rejeitar a
> chamada do QStash.

## Verificar/reconciliar histórico de migrations

```bash
pnpm db:check
```

Se divergir, ver [deploy-e-migrations.md](deploy-e-migrations.md#se-o-histórico-divergir).
