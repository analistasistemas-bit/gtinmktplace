# Plano de diagramas

> As 8 posições fixas definidas no processo de criação desta documentação. Ver `docs/architecture/README.md` para o índice navegável e `archify-usage.md` para o processo de geração.

| # | Diagrama | Objetivo | Público | Fonte principal | Tipo Archify | Status | Observações |
|---|----------|----------|---------|------------------|--------------|--------|-------------|
| 01 | [Visão Geral da Plataforma](diagrams/01-platform-overview/) | Explicar o SaaS como um todo | Gestor, novo dev | `obsidian-vault/00-Home/Visão Geral.md`, `docs/explanation/arquitetura.md` | architecture | validado | — |
| 02 | [Arquitetura Geral](diagrams/02-general-architecture/) | Módulos internos e responsabilidades | Novo dev, arquiteto | `docs/explanation/arquitetura.md` | architecture | validado | Substitui em conteúdo o `docs/diagrams/c4-n2-conteineres.drawio` (pré-E6/E7); drawio mantido como histórico |
| 03 | [Fluxo de Publicação](diagrams/03-publication-flow/) | Fluxo principal do produto | Novo dev, arquiteto | `docs/explanation/arquitetura.md`, ADR-0061 | workflow | validado | Inclui o fan-out de canais extras (E6) como ramo, não como diagrama separado |
| 04 | [Fluxo de Sincronização](diagrams/04-marketplace-sync/) | Sincronização inversa (webhooks/status) | Novo dev, arquiteto | `docs/reference/modelo-de-dados.md`, ADR-0037/0035 | workflow | validado | **Não consolidado com o 03** — direção oposta (inbound vs. outbound); ver justificativa abaixo |
| 05 | [Modelo de Dados Simplificado](diagrams/05-simplified-data-model/) | Domínio de negócio | Novo dev, arquiteto | `docs/reference/modelo-de-dados.md` | architecture (pseudo-ERD) | validado | Archify não tem modo ERD — componentes fazem o papel de entidades |
| 06 | [Arquitetura Multi-Tenant](diagrams/06-multi-tenant/) | Isolamento entre empresas | Novo dev, arquiteto, segurança | ADR-0027 | architecture | validado | Substitui a nota desatualizada do vault ("sem org_id ainda", 2026-07-01) |
| 07 | [Infraestrutura Simplificada](diagrams/07-infrastructure/) | Ambiente de execução | Infra, novo dev | `CLAUDE.md`, `docs/how-to/deploy-e-migrations.md` | architecture | validado | Mesmo layout do 02, foco em deploy em vez de protocolo |
| 08 | [Arquitetura Futura Simplificada](diagrams/08-to-be/) | Evolução proporcional | Arquiteto, gestor | ADR-0027, ADR-0061, `project-status.md` | architecture | validado | 5 melhorias, todas já sinalizadas em ADR/status — nenhuma inventada |

## Status possíveis

`planejado` · `em elaboração` · `validado` · `consolidado com outro` · `substituído` · `não aplicável` · `pendente de informação`

## Decisões de consolidação/substituição

- **03 e 04 permanecem separados.** O prompt de origem permite consolidar "quando o fluxo de sincronização for essencialmente igual ao de publicação". Aqui não são iguais: 03 é o caminho de escrita (operador → publicação no marketplace); 04 é o caminho de leitura inversa (marketplace → PubliAI via webhook/reconciliação/monitoramento). Consolidá-los exigiria um diagrama bidirecional denso, violando o limite de 12-16 elementos e a regra de uma ideia principal por diagrama.
- **Nenhum diagrama foi substituído por um Mapa de Capacidades.** Os 8 temas mapeiam bem em tipos Archify existentes (ver `archify-usage.md`); um mapa de capacidades adicionaria uma 9ª visão sem substituir nenhuma das 8, então ficou no `backlog.md` como complementar, não como substituição.
- **Os diagramas C4 antigos (`docs/diagrams/*.drawio`) não foram apagados.** Continuam válidos para ERD completo (05 aqui é simplificado) e para as sequências de Faturamento/Financeiro (não recriadas aqui — 04 cobre só a sincronização, não o cálculo financeiro). `docs/diagrams/README.md` já linka para a documentação textual; nenhuma mudança feita lá.
