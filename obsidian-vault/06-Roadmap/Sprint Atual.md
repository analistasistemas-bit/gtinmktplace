---
tags: [roadmap, sprint]
atualizado: 2026-07-01
---

# Sprint Atual

Fonte de verdade viva: `docs/TASKS.md` (marcador "📍 Passo atual" no topo) e
`docs/project-status.md`. Ver [[Próximas Features]], [[Backlog]].

## 📍 Passo atual (docs/TASKS.md)

> Evolução SaaS · Fase 1 · **E1 + E1b + E2 + E3 + E4 ✅ validados em produção** — a camada de
> canais, o modelo multicanal `anuncios_externos`, a categoria genérica e os atributos por IA
> closed-set estão em produção. Bug bash real do E4 cobriu publicação de vertical nova pela UI
> (`MLB4779431383`, depois removido do sistema; `anuncios_externos` voltou a 21). Próximo:
> **E5** (conector Shopee).

## Entregas mais recentes já em produção (fonte: `docs/project-status.md`)

- Split de produto em N anúncios para produtos com >100 cores (ADR-0048, 2026-06-29)
- Multiusuário com permissão de menu (ADR-0047, 2026-06-29) — antecipa parte do `E7`
- Repaginação visual premium + Tarefa 2 (workflow operacional, todas as 3 ondas)

## Pendente de validação/deploy (não fechado ainda)

- **Módulo Financeiro impecável** (ADR-0040) — branch `worktree-financeiro-impecavel`,
  implementado, aguardando validação local + deploy
- **Correção de `verify_jwt`** — pendente de aprovação, ver [[Bugs Conhecidos]]

## Ver também

- [[Publicação Shopee]] — o que já foi pesquisado para o épico `E5`
- [[Backlog]] — os 9 épicos da evolução SaaS
