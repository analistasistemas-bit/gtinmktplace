# ADR-0006: Fila assíncrona via Upstash QStash (não Postgres queue caseira)

**Status:** Aceito
**Data:** 2026-05-26
**Decisores:** Diego

## Contexto

O pipeline de processamento de um lote envolve, **por família**:

1. Extração de cor (texto + Vision se necessário)
2. Chamada de LLM para gerar título, descrição e atributos
3. Chamada à API do Mercado Livre para verificar concorrência
4. Cálculo de preço sugerido

E, na fase de publicação (após aprovação):

5. Refresh do token OAuth da Meli se necessário
6. POST para `/items` na API Meli (com payload de variações)
7. Tratamento de erros com retry

Cada família demora **vários segundos** (chamadas a APIs externas), e um lote pode ter 5–50 famílias. Processar tudo síncrono dentro de uma Edge Function do Supabase **estoura o timeout de 150s**.

Adicionalmente, precisamos de:
- **Rate limiting** para respeitar limites da API Meli (~1000–10000 req/h por app)
- **Retry com backoff** para tratar erros transientes (5xx, rede, rate limit)
- **Dead-letter** para mensagens que falham N vezes
- **Observabilidade** para debugar quando algo trava

## Decisão

Adotamos o **Upstash QStash** como motor de fila assíncrona. Cada família a processar vira uma mensagem HTTP entregue por QStash a uma Edge Function dedicada (`process-familia` para o pipeline pré-publicação; `publish-familia` para a publicação no ML).

QStash entrega as configurações de:
- Retry com backoff exponencial (até 3 tentativas)
- Rate limit por endpoint (ex: 5 req/seg para `publish-familia`)
- Delay/scheduling (útil para retry após espera)
- Dead-letter (mensagens que falham todas as tentativas ficam visíveis no dashboard)

A correlação entre família e mensagem é feita por uma coluna `qstash_message_id text` na tabela `familias`.

## Alternativas consideradas

- **Opção A: Fila caseira em Postgres (DIY)**
  - Pros: zero dependência externa; atomicidade com dados via transação; SQL visível
  - Cons: ~200–400 linhas de código para escrever e testar (locking via `FOR UPDATE SKIP LOCKED`, retry, backoff, DLQ, scheduler via pg_cron); filas caseiras são notoriamente difíceis e cheias de race conditions; tempo desproporcional ao MVP
  - Rejeitada — para o volume (~500 produtos/mês) e o prazo (2-3 meses), é trabalho com baixo retorno

- **Opção B: Sem fila — chunks dentro da edge function**
  - Pros: zero infra adicional; código simples
  - Cons: limitada a ~5–10 famílias por execução; se lote crescer, vira complexidade pra contornar; sem retry/backoff embutido
  - Aceitável para "Sprint Zero" se quiséssemos testar o pipeline; rejeitada como solução de MVP

- **Opção C: Worker próprio (Node/Bun) no Render**
  - Pros: controle total; pode usar libs maduras (BullMQ, BeeQueue)
  - Cons: +1 serviço para deployar e monitorar; precisa Redis externo (que terei mesmo pra cache, mas duplica responsabilidade); custo $7+/mês de instância Render Worker
  - Rejeitada porque QStash dá os mesmos benefícios sem instância dedicada

- **Opção D: QStash do Upstash (escolhida)**
  - Pros: MCP já configurado; ~5 linhas de código por enfileiramento; retry/backoff/rate-limit/DLQ built-in; free tier (500 msg/dia) cobre nosso volume 30×
  - Cons: dependência de terceiro; não-atômico com dados (mitigado por idempotência nas Edge Functions)
  - Aceita

## Consequências

**Boas:**
- Tempo de implementação: ~30 minutos para integrar (vs. dias para fila caseira)
- Pipeline naturalmente paralelo (várias famílias processam ao mesmo tempo, respeitando rate limit)
- Dashboard do Upstash mostra estado da fila, retries, falhas e payload — debugging fácil
- Custo: $0 para o volume previsto (free tier 500 msg/dia = 15k/mês; precisamos de ~500)
- Retry com backoff já resolve 80% dos erros transientes da Meli API automaticamente

**Tradeoffs aceitos:**
- Dependência externa: se Upstash cair, fila para
- Mensagens em QStash não são atômicas com dados no Postgres — Edge Functions **devem ser idempotentes** (verificar `status` antes de processar; usar `qstash_message_id` para de-duplicação)
- Limite de timeout das Edge Functions (150s) ainda existe, mas agora por família, não por lote — uma família individual sempre cabe nesse limite

**Idempotência (mandatória):**

Toda Edge Function disparada pelo QStash deve:
```
1. Ler família/lote pelo ID
2. Verificar status atual:
   - se já está em status "processed" → return early (mensagem é duplicata)
   - se está em "processing" → return early (outra execução em curso, evita corrida)
3. Marcar status = "processing" via UPDATE atômico (com WHERE status = 'pending')
4. Se UPDATE não afetou linha, return early (race condition resolvida)
5. Executar trabalho
6. Marcar status = "processed" ou "failed"
```

**Como reverter:**
- O código que enfileira (`qstash.publishJSON(...)`) está isolado num módulo `lib/queue.ts`
- Trocar QStash por BullMQ, Inngest, Trigger.dev ou fila Postgres → mudar a implementação do módulo, mantendo a interface
