---
tags: [roadmap, sprint]
atualizado: 2026-07-02
---

# Sprint Atual

Fonte de verdade viva: `docs/TASKS.md` (marcador "📍 Passo atual" no topo) e
`docs/project-status.md`. Ver [[Próximas Features]], [[Backlog]].

## 📍 Passo atual (2026-07-02)

> **Próximo épico: E7 — Multi-tenancy** (decisão Diego 2026-07-02), seguido de **E6**
> (orquestração multicanal) e **E6b** (estoque único cross-canal, épico novo). O `E5` (Shopee)
> fica para depois. Os três planos de implementação estão completos em
> `docs/superpowers/plans/` (`2026-07-02-e7-*`, `2026-07-02-e6-*`, `2026-07-02-e6b-*`).
> Racional: o objetivo é SaaS multi-empresa com isolamento por org; o E6 nasce tenant-aware;
> a validação real de E6/E6b com 2 canais depende do E5. A execução do E7 inicia pela Task 1
> (reescrever [[ADRs|ADR-0027]]) e cada ponto de deploy exige OK explícito do Diego.

## Entregas mais recentes já em produção (fonte: `docs/project-status.md`)

- **Módulo Financeiro impecável** (ADR-0040) — validado e deployado 2026-07-02 (migration +
  `notificar-liberacao` + schedule QStash diário)
- **Módulo Faturamento** (ADR-0037) — webhooks ML no DevCenter + schedule QStash horário
  ativos (2026-07-02)
- **Lote #49 barbante** (ADR-0051) — fix deployado e 3 famílias reprocessadas (2026-07-02)
- Camadas 2A + 2B de atributos por IA com fallback do operador (ADR-0052, 2026-07-01)
- Split de produto em N anúncios para produtos com >100 cores (ADR-0048, 2026-06-29)
- Multiusuário com permissão de menu (ADR-0047, 2026-06-29) — antecipa parte do `E7`

## Ver também

- [[Backlog]] — os épicos da evolução SaaS (agora com E6b)
- [[Publicação Shopee]] — pesquisa do épico `E5` (adiado para depois de E7/E6)
