# ADR-0037 — Módulo Faturamento: vendas persistidas via webhooks ML + reconciliação

**Status:** Aceito
**Data:** 2026-06-22
**Relacionado:** [ADR-0006](0006-qstash-em-vez-de-postgres-queue.md) (QStash), [ADR-0012](0012-refresh-token-oauth-ml-com-lock-redis.md) (token ML), [ADR-0024](0024-camada-de-abstracao-de-canais.md) (conectores), [ADR-0027](0027-multi-tenancy-organizations.md) (RLS), [ADR-0031](0031-integracao-financeira-mercado-pago.md) (financeiro MP), [ADR-0035](0035-monitoramento-anuncios-moderados.md) (Telegram/polling), spec `2026-06-22-menu-faturamento-vendas-design.md`

## Contexto

O app já lê `/orders/search` (em `metricas-vendas`, `resumo-financeiro`, `_shared/ml/pedidos.ts`)
mas **só para agregar por produto** e mapear pagamento→custo. Os campos ricos do pedido
(comprador, status, envio, `sale_fee`, datas) são buscados e **descartados**. Não há visão
pedido a pedido, nem pós-venda (devoluções, perguntas).

Investigação na API do ML (2026-06-22) confirmou:
- `/orders/search` + `/orders/{id}` funcionam com a conexão atual (a nota de memória sobre 403
  em `/orders` estava **desatualizada** — as telas Publicados/Detalhe de vendas provam acesso).
- Pós-venda disponível sem permissão extra: `/post-purchase/v1/claims/search` (o legacy
  `/v1/claims` foi descontinuado em 2024) e `/questions/search?api_version=4` + `POST /answers`.
- O ML oferece **webhooks reais** para `orders_v2`, `questions`, `claims`, `shipments`,
  `payments` — diferente da moderação (ADR-0035), onde não há tópico e por isso usamos polling.
- Webhook do ML **não traz assinatura HMAC**; o payload é só um ponteiro (`resource`, `topic`,
  `user_id`). Entrega não é garantida (precisa ACK 200 <500ms, com retries + `/missed_feeds`).

## Decisão

**Persistir vendas/pós-venda em tabelas locais, alimentadas por webhooks com reconciliação.**

1. **Receiver `ml-webhook`** (`verify_jwt = false`): ACK 200 imediato, dedup em
   `ml_webhook_eventos`, enfileira no QStash por tópico. **Nunca confia no corpo** — resolve o
   `user_id` por `ml_credentials` e sempre refaz o fetch autenticado.
2. **Workers idempotentes** (`sync-venda`, `sync-pergunta`, `sync-devolucao`) fazem o fetch do
   recurso e `upsert` por id do ML. Disparam alerta Telegram só em evento novo.
3. **Backfill** (`backfill-faturamento`) popula o histórico (12m) e serve o botão "Sincronizar".
4. **Reconciliação** (`reconciliar-faturamento`, QStash schedule 1h) com `/missed_feeds` +
   janela recente, como rede de segurança para webhooks perdidos.
5. **Frontend lê sempre das tabelas** — rápido e resiliente à indisponibilidade da API do ML.
6. **Tabelas** `ml_vendas`, `ml_vendas_itens`, `ml_devolucoes`, `ml_perguntas`,
   `ml_webhook_eventos`, todas com RLS por `user_id`.
7. **Perguntas** respondíveis pelo app (`POST /answers`) com **sugestão de IA** (OpenRouter),
   sempre sob revisão humana.

## Por que webhooks + persistência (e não polling ao vivo como o ADR-0035)

- A feature pede **alertas proativos** (nova venda/pergunta/devolução) — webhook dá tempo real;
  polling de 6h não serve para "responder pergunta rápido".
- O ML **oferece os tópicos** aqui (ao contrário da moderação), então o custo de webhook se paga.
- Persistir dá **histórico, busca instantânea e telas que não quebram** se a API do ML cair.
- A **reconciliação** elimina o calcanhar do webhook (entrega não garantida) sem reintroduzir
  polling agressivo.

## Por que o receiver não valida assinatura

O ML não assina o webhook. Mitigação em camadas: (a) `user_id` precisa casar com uma
`ml_credentials` conhecida; (b) dedup por `(topic, resource)`; (c) o dado só entra após
**fetch autenticado** do recurso com o token do vendedor — um corpo forjado não produz escrita.
O endpoint é público (`verify_jwt=false`), igual aos workers QStash, mas inerte sem fetch válido.

## Consequências

- Visão pedido a pedido + pós-venda, com push proativo, reusando token/Telegram/QStash/IA.
- Depende de **configuração manual no DevCenter** (URL de notificações + tópicos) e de um
  **QStash schedule**. Sem isso, backfill + reconciliação ainda mantêm as telas populadas.
- Nova superfície de dados (5 tabelas). Nascem com `user_id` para migração aditiva a org (E7).
- `liquido` é **estimado** (total − sale_fee − frete do vendedor); o líquido financeiro
  "de caixa" continua no menu Financeiro (MP, ADR-0031). Os dois coexistem: Faturamento = visão
  de vendas/operação; Financeiro = visão de recebíveis.
- Atualiza a memória `reference_ml_permissao_pedidos`: `/orders` **funciona**; o que estava
  bloqueado era `/moderations` e `/orders` de *outros* contextos, não a venda do próprio seller.
