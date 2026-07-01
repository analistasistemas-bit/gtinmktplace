---
tags: [bugs, conhecidos]
atualizado: 2026-07-01
---

# Bugs Conhecidos

Problemas identificados e **ainda abertos** (não resolvidos). Fonte: `docs/project-status.md`
("Riscos e ressalvas abertas"), `docs/reference/edge-functions.md`, `docs/TASKS.md`. Ver
[[Incidentes]] (o que já foi corrigido), [[Problemas Resolvidos]].

## ⚠️ Divergência de `verify_jwt` (confirmado em produção, correção pendente)

Funções acionadas por QStash/webhook mas com `verify_jwt=true` no `config.toml` são rejeitadas
pelo gateway (401) antes de rodar sua própria checagem — porque o enfileirador não envia
`Authorization` e o ML não manda JWT no webhook.

- `ml-webhook`: 221 requisições, 401 em 100%
- `backfill-faturamento`: 92 requisições, 401 em 100%
- Cascata: `sync-venda`/`sync-pergunta`/`sync-devolucao` nunca são enfileiradas → faturamento em
  tempo real parado (só entra via backfill manual)

Correção conhecida, pendente de aprovação + ADR: `verify_jwt=false` para as 4 funções listadas.
Ver [[Edge Functions]].

## Retry de foto — cobertura parcial

O retry de foto transiente foi reforçado e validado no `CREATE` (`publish-familia-ml`), mas o
mesmo padrão ainda **não foi estendido de forma consistente ao `UPDATE`**
(`update-familia-ml`). Fica pendente até haver necessidade operacional real.

## E4 — publicação de vertical nova ainda não comprovada ponta a ponta

Validado até Revisão/banco (categoria `MLB189007` + `VOLTAGE` closed-set + publicabilidade) para
uma furadeira, mas o único CREATE real de prova da reauditoria foi com família de fita —
**não** com uma furadeira de verdade. Decisão registrada: não forçar um publish sintético;
fechar quando uma furadeira real entrar num lote de produção normal.

## Conexão ML da operação (pré-`E7`)

Hoje a publicação usa a credencial OAuth de quem conectou (normalmente o admin-dono). Falta
resolver "conexão da operação" (não do usuário que clicou) para que qualquer membro da operação
compartilhada consiga publicar. Até lá, publicação fica restrita ao admin-dono.

## Módulo Financeiro impecável — pendente validação/deploy

Branch `worktree-financeiro-impecavel` (ADR-0040) implementado (caixa, margem, evolução,
comparativo, export, notificação Telegram) mas pendente de validação local + deploy (migration +
edge `notificar-liberacao` + schedule QStash).
