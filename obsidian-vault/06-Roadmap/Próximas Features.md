---
tags: [roadmap, features]
atualizado: 2026-07-12
---

# Próximas Features

Fonte: `docs/project-status.md` ("Próximo foco") e `docs/Roadmap-Estrategico-PubliAI-v2.md`
(revisão de CTO do roadmap, PR #15, 2026-07-12 — 8 fases de construção da empresa, supersede a
priorização antiga). Ver [[Sprint Atual]], [[Backlog]].

## Próximo épico: `E5` — conector Shopee (antecipado, não mais "depois")

`E6` (orquestração multicanal) e `E7` (multi-tenancy) **já em produção** (2026-07-05/06) — o
worker genérico `publicar-anuncio` está pronto esperando só o conector. O roadmap v2 aponta
adiar Shopee como o erro mais caro do plano anterior: é a validação da tese central ("2º canal
real") e o maior multiplicador de valuation, e já está desbloqueado tecnicamente — deve rodar
**em paralelo** à Fase 1 comercial (billing mínimo), não depois dela.

- **`E5` — conector Shopee** — auth OAuth + HMAC, item/variações, mídia, estoque/preço, status.
  Pesquisa registrada: ver [[Publicação Shopee]].
- **`E6b` — Estoque único cross-canal com ledger** (Fase 3 do roadmap v2) — venda paga em
  qualquer canal baixa o estoque canônico e propaga aos demais; sem isso, multicanal é demo.

## Fase 0 — Fundação técnica (em andamento em paralelo)

Objetivo: nenhum tenant novo pode multiplicar dívida. Já feito: **Integration Health / liveness
por conexão** (spike 032 → ADR-0069, ver [[Índice de ADRs]], 2026-07-12). Pendentes: outbox de publicação,
paginação server-side, RBAC por ação no backend, audit trail, control tower de jobs,
instrumentação de funil, telemetria de IA (coleta).

## Fase 1 — Fundação comercial (paralela ao E5)

Billing **mínimo viável** (assinar, cobrar via Asaas, suspender — não o billing completo com
upgrade/downgrade/portal, que fica pra depois): decisão de founder é vender manualmente aos 3–5
primeiros design partners em paralelo, sem esperar o billing para a primeira venda.

## Fase 2 — Produto operacional (a seguir)

Novidade do roadmap v2: **funcionalidade 51 — Dashboard Executivo "Mission Control"**, primeira
tela do sistema (anúncios com erro, produtos sem margem, integrações offline, jobs falhos,
vendas/margem/caixa, ações prioritárias).

## Backlog pós-Tarefa 2 (adiado, fonte: `docs/project-status.md`)

Itens de UX identificados mas conscientemente adiados após fechar a Tarefa 2 (workflow
operacional):

- Busca global
- Ações em massa na Revisão (gate de publicação)
- Acessibilidade aprofundada (além do que a Fase 6 do redesign já cobriu)
- Período sincronizado entre Publicados ↔ Financeiro
- Links cruzados entre telas
- Scroll restoration
- Aviso global do worker (estado de fila visível fora da tela específica)

## Ver também

- [[Backlog]] — épicos maiores (E5–E9 + E6b) da evolução SaaS e as 8 fases do roadmap v2
- [[Bugs Conhecidos]] — correções pendentes que competem por prioridade com features novas
