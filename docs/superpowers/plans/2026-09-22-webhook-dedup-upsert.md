# Plano — dedup do ml-webhook sem erro 23505 no log do Postgres

**Data:** 2026-09-22 · **Branch:** `worktree-fix-webhook-dedup-upsert` · **ADR:** 0037 (sem ADR novo: não muda a decisão, só a mecânica)

## Problema

`ml-webhook` faz dedup por `INSERT` em `ml_webhook_eventos` e trata `23505` (índice único `topic,resource`) como "já recebido". O ML reenvia o mesmo resource ~10x por pedido/envio (cada mudança de status), então cada repetição vira uma linha **ERROR** no log do Postgres: ~136/h medidos em 22/09 contra 12 eventos novos. Nada quebra; é ruído que esconde erro real.

## Solução

Trocar o `insert` por `upsert(..., { onConflict: 'topic,resource', ignoreDuplicates: true }).select('id')` — vira `ON CONFLICT DO NOTHING`: duplicado = 0 linhas retornadas, sem erro no Postgres. Precedente no repo: `pulse-coletar/processar.ts:375`.

Semântica preservada (ADR-0037 + plano 035):
- linha nova → `enfileirar`
- duplicado `orders_v2`/`shipments` → `ignorar` (backstop reconciliar-faturamento)
- duplicado `questions`/`claims` → `enfileirar` (transição de estado)
- duplicado `messages` → `checar-messages` (decisão temporal em `deveReenfileirarMensagens`)
- erro de banco (RLS/timeout/pool) → `enfileirar` (não engole evento)

## Tarefas

1. **`_shared/ml/reenfileirar-mensagens.ts`** — `classificarDedupWebhook(resultado, topic)` passa a receber `{ erro: { code?: string } | null; inseriu: boolean }` em vez do erro do INSERT. `erro` → `enfileirar`; `inseriu` → `enfileirar`; senão ramo de duplicado (igual ao atual). Atualizar o comentário (não fala mais em 23505).
2. **`_shared/ml/__tests__/reenfileirar-mensagens.test.ts`** — reescrever o `describe('classificarDedupWebhook')` para a nova assinatura (TDD: teste primeiro, vermelho, depois o código). Cobrir os 5 casos acima + erro sem code.
3. **`ml-webhook/index.ts:77-90`** — `upsert` com `ignoreDuplicates` + `.select('id')`; `inseriu = (data?.length ?? 0) > 0`; o `else if` de erro não-duplicado vira `else if (error)` (qualquer erro do upsert é não-duplicado agora). Ajustar o comentário das linhas 73-76.
4. **Verificar** — `pnpm vitest run supabase/functions/_shared/ml/__tests__/reenfileirar-mensagens.test.ts` verde; `pnpm preflight:static` verde.
5. **Entrega** — revisão Fable do diff; commit; push da branch. Deploy `supabase functions deploy ml-webhook` + merge ficam para o OK do Diego (merge não deploya função).

## Fora de escopo

Latência do webhook vs. os 500 ms do ML (não medida; só afetaria o volume, não o diagnóstico).
