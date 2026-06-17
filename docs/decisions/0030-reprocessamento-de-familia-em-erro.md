# ADR-0030 — Reprocessamento de família em erro + erro com detalhe por etapa

**Status:** Aceito
**Data:** 2026-06-17
**Relacionado:** [ADR-0005](0005-lifecycle-publish-update.md) (lifecycle), `process-familia`, trigger `update_lote_counters`

## Contexto

No lote #41 (FITA CETIM PROGRESSO N.9, CREATE, 1 família) o `process-familia` abortou
após ~32s e a família ficou em `status='erro'` com `erro_mensagem='The signal has been
aborted'`. Investigação (logs da edge function + DLQ do QStash) apontou a causa: a chamada
de copywriting (`gerarCopy` → OpenRouter, `AbortSignal.timeout(30_000)`) excedeu 30s e o
fetch foi abortado. Como `gerarCopy` é a única etapa de IA **sem** rede de proteção
(Vision, concorrência, categoria e mercado já têm `try/catch` resiliente), o abort derrubou
a família inteira.

Dois problemas ficaram evidentes:

1. **Mensagem de erro inútil.** O `catch` geral do `process-familia` salva apenas
   `err.message`, que para um abort de `fetch` é o texto genérico *"The signal has been
   aborted"* — não diz **qual etapa** falhou. Diego: *"deu erro, mas não disse qual erro…
   preciso de detalhes quando der erro"*.

2. **Família travada sem saída.** Depois de cair em `erro`, o retry automático do QStash
   não recupera a família: o claim atômico do `process-familia` exige `status='pendente'`
   (`UPDATE … WHERE status='pendente'`), e a família já está em `erro`. Não havia nenhuma
   ação no app para re-disparar o processamento. A tela de Revisão sequer exibia o status
   `erro` nem a `erro_mensagem` (o campo já existia no tipo `Familia`, só não era renderizado).

## Decisão

### 1. Erro com rótulo de etapa no `process-familia`

As etapas externas que **não** têm fallback passam a ser envolvidas com um rótulo de
contexto, convertendo o erro cru em mensagem acionável. Em especial a copy:

- `gerarCopy` ganha **1 retry** antes de desistir (lentidão pontual do OpenRouter é o caso
  comum) e, ao falhar de vez, lança `Copy (IA/OpenRouter): excedeu 30s` (timeout) ou a
  mensagem original prefixada por `Copy (IA): …`.
- O `catch` geral continua salvando `erro_mensagem`, mas agora recebe uma mensagem que
  identifica a etapa, não o `AbortSignal` genérico.

### 2. Nova edge function `reprocessar-familia`

Endpoint autenticado (JWT do operador, mesmo padrão de `regenerar-copy-familia`), idempotente:

- Aceita `{ familia_id }` (uma família) **ou** `{ lote_id }` (todas as famílias em `erro`
  do lote).
- Só age sobre famílias do próprio usuário com `status='erro'` (guard — RLS por `user_id`).
- Para cada família: `status → 'pendente'`, `erro_mensagem → null`, re-enfileira o
  `process-familia` via `enfileirarFamilia` (o QStash do projeto — assinatura válida) e
  grava o novo `qstash_message_id`.
- Coloca o lote em `status='processando'`. O trigger `update_lote_counters` recalcula
  `total_erros` e, quando a última família termina a IA, devolve o lote a `revisao`.

> Por que uma função, e não re-enfileirar "na mão": o `process-familia` valida a assinatura
> do QStash do projeto. Re-publicar por fora (ex.: MCP) não reproduz essa assinatura de
> forma confiável e o body pode chegar duplo-encodado. `enfileirarFamilia` é o único caminho
> que reproduz exatamente o enfileiramento legítimo.

### 3. UI: status de erro visível + botão "Reenviar"

- **Linha da família (`FamiliaRow`):** quando `status==='erro'`, exibe selo vermelho com a
  `erro_mensagem` (tooltip) e um botão **"Reenviar"** que reprocessa aquela família.
- **Header da Revisão:** quando o lote tem ≥1 família em `erro`, um botão
  **"Reenviar N com erro"** reprocessa todas de uma vez.

## Consequências

- Falhas futuras dizem **onde** quebraram; o operador resolve sem precisar de logs.
- Família/lote em erro deixa de ser beco sem saída: o operador reenvia com um clique.
- Lentidão pontual de IA passa a ser absorvida pelo retry da copy, reduzindo o nº de erros.
- O reprocessamento reusa todo o pipeline do `process-familia` (cor → copy → concorrência →
  categoria → preço), então uma família reenviada é reconstruída do zero, não remendada.
