---
tags: [roadmap, features]
atualizado: 2026-07-02
---

# Próximas Features

Fonte: `docs/project-status.md` ("Próximo foco") e o backlog explícito pós-Tarefa 2
em `docs/TASKS.md`. Ver [[Sprint Atual]], [[Backlog]].

## Próximo épico: `E7` — Multi-tenancy (decisão Diego 2026-07-02)

Isolamento total de dados por organização (todos os dados atuais são da **Avil**). Plano
completo: `docs/superpowers/plans/2026-07-02-e7-multi-tenancy-org-id.md` — 7 fases
expand→migrate→contract, RLS por `org_id`, `marketplace_connections` por org (destrava
publicação por membros, pendência do ADR-0047), suite executável de isolamento cross-tenant.

Na sequência:

- **`E6` — Orquestração multicanal** — worker genérico `publicar-anuncio`, estado por canal em
  `anuncios_externos`, caminho ML intocado. Plano: `2026-07-02-e6-orquestracao-multicanal.md`.
- **`E6b` — Estoque único cross-canal** (épico novo, 2026-07-02) — venda paga em qualquer canal
  baixa o estoque canônico e propaga aos demais canais. Plano:
  `2026-07-02-e6b-estoque-unico-cross-canal.md`.
- **`E5` — conector Shopee** (adiado para depois) — auth OAuth + HMAC, item/variações, mídia,
  estoque/preço, status. Pesquisa registrada: ver [[Publicação Shopee]].

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

- [[Backlog]] — épicos maiores (E5–E9 + E6b) da evolução SaaS
- [[Bugs Conhecidos]] — correções pendentes que competem por prioridade com features novas
