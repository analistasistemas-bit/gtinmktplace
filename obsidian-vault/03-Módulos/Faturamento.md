---
tags: [modulo, faturamento]
atualizado: 2026-07-27
---

# Faturamento

Módulo em produção para vendas, devoluções e perguntas do Mercado Livre. Ver [[Financeiro]] e
[[Notificações]].

## Operação

- Menu Faturamento com vendas, devoluções e perguntas com IA.
- Webhooks ML recebidos por `ml-webhook` para `orders_v2`, `questions`, `claims` e `shipments`.
- Reconciliação por `reconciliar-faturamento` em schedule QStash horário (inclui estornos de devoluções de até 30 dias).
- `upsertDevolucao` resolve `order_id` via `shipping_id` em devoluções do tipo `shipment`.

Fonte: `docs/decisions/0037-modulo-faturamento-webhooks-ml.md`.
