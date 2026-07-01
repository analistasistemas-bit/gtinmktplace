---
tags: [ia, claude]
atualizado: 2026-07-01
---

# Claude (Claude Code)

Espelho resumido de `CLAUDE.md` na raiz do repositório (fonte de verdade — atualize lá
primeiro). Ver [[Agentes]].

## Ordem de leitura antes de tocar em código

1. Graphify (arquitetura/impacto) — ver [[Graphify]]
2. `docs/README.md`, `docs/project-status.md`, `docs/ROADMAP.md`, `docs/TASKS.md`
3. ADR relacionado em `docs/decisions/`

## Regras operacionais inegociáveis

- ADR antes de mudança arquitetural não-trivial
- Edge Functions idempotentes
- Tokens/segredos nunca em código ou repo
- RLS por `user_id`/`org_id` obrigatória em tabela de domínio
- Revisão humana antes de publicar em marketplace
- Documentação afetada é checada **antes** de considerar a tarefa concluída (mapa código→doc no
  `CLAUDE.md`)

## O que nunca fazer (lista literal do `CLAUDE.md`)

Inventar dado de produto, publicar sem revisão humana, quebrar idempotência, salvar token em
texto puro, ignorar RLS, criar estrutura sem ADR, mexer em anúncio real de produção fora de
fluxo controlado.

## Este vault

Preenchido por Claude seguindo regras explícitas do operador: nunca inventar informação, usar só
código/docs existentes, usar links internos do Obsidian, usar Mermaid quando fizer sentido,
atualizar só arquivos já existentes (sem criar notas novas sem necessidade). Fonte primária de
arquitetura: [[Graphify]].
