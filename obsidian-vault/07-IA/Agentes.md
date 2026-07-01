---
tags: [ia, agentes]
atualizado: 2026-07-01
---

# Agentes de IA neste projeto

Como assistentes de IA operam no PubliAI — meta-documentação sobre o processo, não sobre as
features de IA do produto (isso é [[IA]] em `03-Módulos`). Ver [[Claude]], [[Graphify]],
[[Serena]].

## Quem trabalha no repositório

- **Claude Code** — agente principal, opera via `CLAUDE.md` na raiz do repo
- **Codex** — usado em paralelo em algumas sessões (ex.: fix de faturamento "usar comprador real
  nas vendas")

## Regras de fluxo (fonte: `CLAUDE.md` + convenção observada)

- App em produção: todo trabalho de dev sai em **branch/worktree separado** da `main`, nunca
  editar a `main` direto
- Merge → push → deploy só acontece **sob comando explícito** do operador (Diego)
- ADR antes de decisão arquitetural não-trivial
- Edge Functions devem ser idempotentes (regra inegociável)
- Checagem de documentação é parte da definição de "pronto" — ver mapa código→doc no
  `CLAUDE.md`

## Cuidado operacional descoberto nesta sessão

`EnterWorktree` (a ferramenta de isolamento) parte da `origin/main`, não da `main` local — se a
`main` local tiver commits não enviados, o worktree novo nasce sem eles. Fazer `git push`
depois de cada merge evita esse problema para o próximo worktree.

Também foi observado, duas vezes nesta sessão, um worktree nascer com centenas de arquivos
existentes no HEAD mas fisicamente ausentes do disco (bug de infraestrutura, não do código do
projeto). Mitigação: nunca usar `git add -A`; sempre `git add <caminho específico>` e conferir
`git status` antes de commitar.
