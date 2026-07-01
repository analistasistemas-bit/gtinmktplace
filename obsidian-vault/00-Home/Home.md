---
tags: [home, indice]
atualizado: 2026-07-01
---

# PubliAI — Vault

Base de conhecimento viva do projeto. Fonte de verdade primária para arquitetura: **[[Graphify]]**
(grafo de código `src/` + `supabase/`, regenerável a qualquer momento) e o código-fonte do
repositório. Documentação técnica formal complementar vive em `docs/` (Diátaxis) e
`docs/decisions/` (ADRs) — este vault referencia esses documentos, não os substitui.

## Começar por aqui

- [[Visão Geral]] — o que é o PubliAI, estado atual, stack
- [[Glossário]] — termos do domínio

## Arquitetura

- [[Arquitetura Geral]]
- [[Frontend]]
- [[Backend]]
- [[Supabase]]
- [[Edge Functions]]
- [[Banco de Dados]]
- [[APIs]]
- [[Integrações]]
- [[Segurança]]

## Fluxos

- [[Fluxo Completo]]
- [[Login]]
- [[Upload Planilha]]
- [[Upload Fotos]]
- [[Processamento IA]]
- [[Publicação Mercado Livre]]
- [[Publicação Shopee]] *(planejado — ainda não implementado, épico `E5`)*
- [[Amazon]] *(pesquisa técnica registrada, sem épico numerado nem código — 4º na fila de canais)*

## Módulos

- [[Dashboard]]
- [[Produtos]]
- [[Marketplace]]
- [[IA]]
- [[Configurações]]
- [[Usuários]]
- [[Billing]]
- [[Assinaturas]]

## Outras seções do vault

- `04-Decisões/` — ADRs espelhados de `docs/decisions/`
- `05-Bugs/` — bugs conhecidos e incidentes
- `06-Roadmap/` — backlog e próximos passos
- `07-IA/` — como os agentes de IA (Claude, Graphify, Serena) operam neste projeto
- `09-Logs/` — changelog e deploys

## Estado atual (resumo)

- Marketplace ativo em produção: **Mercado Livre**
- Épicos validados em produção: `E1`, `E1b`, `E2`, `E3`, `E4`
- Próximo épico de produto: `E5` — conector Shopee (ainda não implementado)
- Fonte detalhada e sempre atualizada: `docs/project-status.md`
