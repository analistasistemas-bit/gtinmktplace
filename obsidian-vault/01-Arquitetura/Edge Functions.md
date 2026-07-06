---
tags: [arquitetura, backend, edge-functions]
atualizado: 2026-07-06
---

# Edge Functions

Espelho resumido de `docs/reference/edge-functions.md` (fonte de verdade — atualize lá
primeiro). ~35 funções Deno em `supabase/functions/`. Ver [[Backend]], [[Segurança]].

## Como ler `verify_jwt`

- **`true`** → gateway do Supabase exige JWT válido antes de executar.
- **`false`** → função pública, autentica por conta própria (assinatura QStash, JWT manual, ou
  endpoint público OAuth/webhook).

## Por domínio

| Domínio | Funções |
|---|---|
| **OAuth / conexão ML** | ml-oauth-start, ml-oauth-callback, ml-oauth-disconnect |
| **Ingest de planilha** | ingest-lote, upload-imagens-lote |
| **Processamento / publicação** | process-familia, publicar-familias, publish-familia-ml, update-familia-ml, publicar-split-ml, **publicar-anuncio** (worker genérico p/ canais ≠ ML), regenerar-copy-familia, definir-categoria-familia, vincular-catalogo |
| **Remoção / reprocessamento** | remover-publicado, excluir-lote, reprocessar-familia, invalidar-cache-cor |
| **Faturamento** | ml-webhook, sync-venda, sync-pergunta, sync-devolucao, responder-pergunta, sugerir-resposta-pergunta, backfill-faturamento, reconciliar-faturamento |
| **Financeiro (MP)** | resumo-financeiro |
| **Monitoramento / alertas** | monitorar-moderados, notificar-liberacao |
| **Status / métricas / viabilidade** | status-publicados, metricas-vendas, analisar-viabilidade, calcular-tarifa-ml |
| **Acesso / usuários** | usuarios |
| **Utilitário** | hello |

Ver [[Publicação Mercado Livre]] (fluxo de publicação), [[Marketplace]] (módulo Faturamento).

## Padrões transversais

- **Idempotência** — claims atômicos (`UPDATE … WHERE status=…`), upserts, reuso de
  `picture_id`/IDs já gravados.
- **Fila serial de publicação** — `garantirFilaSerial(userId)` → `parallelism=1` por usuário,
  evita duas publicações concorrentes da mesma conta colidirem no ML.
- **Dedup de webhook** — `(topic, resource)` único em `ml_webhook_eventos`.
- **Fan-out multicanal (E6, ADR-0061)** — `publicar-familias` publica ML dentro de `if(incluiML)`
  (intocado) e, para cada canal extra conectado pela org, faz claim próprio na linha de
  `anuncios_externos` e enfileira `publicar-anuncio`. O worker **verifica** o status (não
  re-claima), preservando a idempotência do retry do QStash. Auth do gateway agora por
  `requireUserOrg` (org do E7).

## ⚠️ Incidente conhecido — divergência de `verify_jwt`

Confirmado em produção via logs (2026-06-28): funções acionadas por QStash/webhook mas com
`verify_jwt=true` são **rejeitadas pelo gateway (401) antes de executar** sua própria checagem —
porque o enfileirador não envia `Authorization` e o ML não manda JWT Supabase no webhook.

| Função | `verify_jwt` | Resultado observado |
|---|---|---|
| `ml-webhook` | true | 401 (100%) — webhooks do ML rejeitados |
| `backfill-faturamento` | true | 401 (100%) — backfill agendado rejeitado |
| `monitorar-moderados` | false | 200 ✓ |
| `notificar-liberacao` | false | 200 ✓ |

Correção pendente de aprovação: `verify_jwt=false` para `ml-webhook`, `sync-venda`,
`reconciliar-faturamento`, `backfill-faturamento` (todas já autenticam internamente). Detalhe
completo em `docs/reference/edge-functions.md`.
