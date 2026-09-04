---
tags: [home, indice]
atualizado: 2026-07-24
---

# PubliAI — Vault

Base de conhecimento viva do projeto. As fontes de verdade são `docs/` (Diátaxis) e
`docs/decisions/` (ADRs); **[[Graphify]]** confirma relações do código `src/` + `supabase/`.
Este vault referencia esses documentos, não os substitui.

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
- [[Estoque]] *(módulo pago, ligado por org)*
- [[Pulse]] *(módulo pago de inteligência de mercado e garimpo, ligado por org)*
- [[Marketplace]]
- [[IA]]
- [[Configurações]]
- [[Usuários]]
- [[Faturamento]]
- [[Financeiro]]
- [[Notificações]]
- [[Billing]]
- [[Assinaturas]]
- [[Landing Page]] *(artefato de marketing standalone em `docs/brand/`, não integrado ao app — publicação em produção a confirmar)*

## Outras seções do vault

- `04-Decisões/` — ADRs espelhados de `docs/decisions/`
- `05-Bugs/` — bugs conhecidos e incidentes
- `06-Roadmap/` — backlog e próximos passos
- `07-IA/` — como os agentes de IA (Claude, Graphify, Serena) operam neste projeto
- `09-Logs/` — changelog e deploys

## Estado atual (resumo)

- Marketplace ativo em produção: **Mercado Livre**
- Épicos validados em produção: `E1`, `E1b`, `E2`, `E3`, `E4`, `E7`, `E6`, `E6b` (Bloco A e B)
- Módulos avançados em produção: Estoque único cross-canal, Kit Vinculado (ADR-0151), Pulse Radar & Sonar (ADR-0119/ADR-0130/ADR-0140), Cadastro Fiscal (ADR-0135)
- Próximo épico de produto: `E5` — conector Shopee (worker genérico já pronto)
- Fonte detalhada e sempre atualizada: `docs/project-status.md`
