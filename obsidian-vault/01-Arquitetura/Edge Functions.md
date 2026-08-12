---
tags: [arquitetura, backend, edge-functions]
atualizado: 2026-08-11
---

# Edge Functions

Espelho resumido de `docs/reference/edge-functions.md` (fonte de verdade — atualize lá
primeiro). **47 funções** Deno em `supabase/functions/` (contagem de 2026-08-11).
Ver [[Backend]], [[Segurança]].

## Como ler `verify_jwt`

- **`true`** → gateway do Supabase exige JWT válido antes de executar.
- **`false`** → função pública, autentica por conta própria (assinatura QStash, JWT manual, ou
  endpoint público OAuth/webhook).

## Por domínio

| Domínio | Funções |
|---|---|
| **OAuth / conexão ML** | ml-oauth-start, ml-oauth-callback, ml-oauth-claim, ml-oauth-disconnect |
| **Ingest de planilha** | ingest-lote, upload-imagens-lote |
| **Processamento / publicação** | process-familia, publicar-familias, publish-familia-ml, update-familia-ml, publicar-split-ml, **publicar-anuncio** (worker genérico p/ canais ≠ ML), regenerar-copy-familia, definir-categoria-familia, atributos-familia, vincular-catalogo |
| **User Products (ADR-0088)** | reconciliar-convergencia-up (`*/15 * * * *`), reconciliar-user-products (backfill de itens planos) |
| **Remoção / reprocessamento** | remover-publicado, excluir-lote, reprocessar-familia, invalidar-cache-cor |
| **Faturamento** | ml-webhook, sync-venda, sync-pergunta, sync-mensagem, sync-devolucao, responder-pergunta, responder-mensagem, sugerir-resposta-pergunta, backfill-faturamento, reconciliar-faturamento |
| **Estoque** (módulo pago) | cadastrar-produto, entrada-estoque, **ajustar-estoque** (admin-only, ADR-0110) — as três com `verify_jwt=true` e gate de módulo 403; **sincronizar-estoque** e **reconciliar-estoque** (`30 12 * * *`), workers com `verify_jwt=false`. Ver [[Estoque]] |
| **Monitoramento / alertas** | monitorar-moderados, notificar-liberacao |
| **Status / métricas / viabilidade** | status-publicados, atualizar-status-publicado, metricas-vendas, analisar-viabilidade, calcular-tarifa-ml |
| **Acesso / usuários** | usuarios, suporte |
| **Utilitário** | hello |

Ver [[Publicação Mercado Livre]] (fluxo de publicação), [[Marketplace]] (módulo Faturamento).

## Padrões transversais

- **Idempotência** — claims atômicos (`UPDATE … WHERE status=…`), upserts, reuso de
  `picture_id`/IDs já gravados.
- **Fila serial de publicação** — `parallelism=1` por `(canal, org)`, evitando publicações
  concorrentes da mesma conexão de canal.
- **Dedup de webhook** — `(topic, resource)` único em `ml_webhook_eventos`.
- **Fan-out multicanal (E6, ADR-0061)** — `publicar-familias` publica ML dentro de `if(incluiML)`
  (intocado) e, para cada canal extra conectado pela org, faz claim próprio na linha de
  `anuncios_externos` e enfileira `publicar-anuncio`. O worker **verifica** o status (não
  re-claima), preservando a idempotência do retry do QStash. Auth do gateway agora por
  `requireUserOrg` (org do E7).

## Incidente resolvido — divergência de `verify_jwt`

Confirmado em produção via logs (2026-06-28): funções acionadas por QStash/webhook mas com
`verify_jwt=true` são **rejeitadas pelo gateway (401) antes de executar** sua própria checagem —
porque o enfileirador não envia `Authorization` e o ML não manda JWT Supabase no webhook.

| Função | `verify_jwt` | Resultado observado |
|---|---|---|
| `ml-webhook` | true | 401 (100%) — webhooks do ML rejeitados |
| `backfill-faturamento` | true | 401 (100%) — backfill agendado rejeitado |
| `monitorar-moderados` | false | 200 ✓ |
| `notificar-liberacao` | false | 200 ✓ |

O ADR-0046 foi aceito: `ml-webhook`, `sync-venda`, `reconciliar-faturamento` e
`backfill-faturamento` estão deployadas com `verify_jwt=false`; todas mantêm autenticação interna.
Detalhe completo em `docs/reference/edge-functions.md`.
