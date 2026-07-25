---
tags: [modulo, notificacoes]
atualizado: 2026-07-24
---

# Notificações

Notificação in-app em produção: espelha os alertas operacionais enviados por Telegram. Ver
[[Faturamento]] e [[Financeiro]].

## Operação

- `notificarCategoria` grava em `notificacoes` no mesmo ponto dos alertas Telegram.
- Sino no topbar, badge de não lidas e RPC `marcar_notificacoes_lidas`.
- RLS permite leitura própria; workers gravam via service role.

Fonte: `docs/decisions/0085-notificacao-in-app.md`.
