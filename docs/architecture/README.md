# Documentação de Arquitetura — PubliAI

Documentação visual e navegável da arquitetura do PubliAI, gerada com a skill [Archify](archify-usage.md) a partir do conhecimento já existente no projeto (Obsidian vault, `docs/`, Graphify, ADRs) — não é engenharia reversa de código.

**Comece por:** [architecture-overview.md](architecture-overview.md) — introdução de poucos minutos.

## Os 8 diagramas

| # | Diagrama | Para quem |
|---|----------|-----------|
| 01 | [Visão Geral da Plataforma](diagrams/01-platform-overview/) | Gestor, novo desenvolvedor |
| 02 | [Arquitetura Geral](diagrams/02-general-architecture/) | Novo desenvolvedor, arquiteto |
| 03 | [Fluxo de Publicação de Anúncio](diagrams/03-publication-flow/) | Novo desenvolvedor, arquiteto |
| 04 | [Fluxo de Sincronização com Marketplaces](diagrams/04-marketplace-sync/) | Novo desenvolvedor, arquiteto |
| 05 | [Modelo de Dados Simplificado](diagrams/05-simplified-data-model/) | Novo desenvolvedor, arquiteto |
| 06 | [Arquitetura Multi-Tenant](diagrams/06-multi-tenant/) | Novo desenvolvedor, arquiteto, segurança |
| 07 | [Infraestrutura Simplificada](diagrams/07-infrastructure/) | Infraestrutura, novo desenvolvedor |
| 08 | [Arquitetura Futura Simplificada (TO-BE)](diagrams/08-to-be/) | Arquiteto, gestor |

Cada pasta tem: `diagram.html` (fonte canônica, abrir em qualquer navegador — tem toggle claro/escuro e menu de exportação), `diagram.svg` + `diagram.png` (exportados), `diagram.<tipo>.json` (fonte editável) e `README.md` (o que mostra, como ler, fontes, limitações, como atualizar).

## Outros documentos

- [architecture-overview.md](architecture-overview.md) — introdução ao sistema
- [diagram-plan.md](diagram-plan.md) — tabela de planejamento dos 8 diagramas, com status e justificativas de consolidação
- [archify-usage.md](archify-usage.md) — como a skill Archify foi usada, comandos, limitações e como regenerar
- [open-questions.md](open-questions.md) — divergências entre fontes encontradas e como foram resolvidas
- [backlog.md](backlog.md) — diagramas complementares possíveis, não criados nesta rodada
- [CHANGELOG.md](CHANGELOG.md) — histórico desta documentação

## Como isto foi feito

Ordem de fontes: Segundo Cérebro (Obsidian vault) → documentação existente (`docs/`) → Graphify → configurações/infraestrutura → código-fonte (só quando uma dúvida importante não era resolvida pelas fontes anteriores). Ver `open-questions.md` para os 2 casos em que fontes divergiram (ambos resolvidos, nenhum bloqueante).

## Como manter

Cada diagrama muda por um motivo diferente — a seção "Atualização" de cada README lista os gatilhos específicos. Regra geral: **o HTML é a fonte canônica**; edite o `diagram.<tipo>.json`, rode `validate` + `render` (ver `archify-usage.md`), depois reexporte SVG/PNG. Nunca edite o HTML gerado à mão.
