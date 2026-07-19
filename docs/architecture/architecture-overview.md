# Visão geral da arquitetura — PubliAI

> Introdução de poucos minutos. Para o mapa completo dos diagramas, ver [diagram-plan.md](diagram-plan.md); para o índice navegável, [README.md](README.md).

## O que é

PubliAI é um **SaaS multi-tenant** que transforma planilhas de produtos em anúncios publicados em marketplaces. Usa IA como copywriter e para resolução de cor/atributos, com um pipeline assíncrono e **revisão humana obrigatória** antes de cada publicação.

## Quem utiliza

Operadores de empresas clientes (organizações/tenants). Hoje 1 organização real em produção (Avil); a arquitetura já suporta múltiplas empresas com isolamento de dados desde o épico E7 (2026-07-05).

## Qual problema resolve

Cadastrar e manter anúncios em marketplaces manualmente é lento e repetitivo (copywriting, categorização, precificação competitiva, atributos obrigatórios). O PubliAI automatiza esse trabalho a partir de uma planilha + fotos, mantendo o operador no controle via uma etapa de revisão antes de qualquer publicação real.

## Principais capacidades

- Ingestão de planilha + fotos, com validação e agrupamento por produto (família/variações)
- Enriquecimento por IA: copy, resolução de cor, categoria, estratégia de preço, análise de concorrência
- Revisão humana com edição antes de publicar
- Publicação e atualização de anúncios no Mercado Livre (CREATE/UPDATE), com split automático para produtos com muitas variações ou faixas de preço divergentes
- Sincronização inversa: pedidos, perguntas, devoluções e moderação via webhook + reconciliação periódica
- Módulos de Faturamento, Financeiro (Mercado Pago) e Monitoramento de anúncios pausados/moderados
- Orquestração multicanal (fan-out por família×canal) pronta para o 2º marketplace (Shopee, próximo épico — E5)

## Módulos principais

Ver [02 · Arquitetura Geral](diagrams/02-general-architecture/) para o mapa completo. Resumo: Frontend (React SPA) → Edge Functions (Deno, hub de toda lógica de backend) → Postgres/Storage/Vault (Supabase) + QStash/Redis (Upstash, fila e cache assíncronos).

## Integrações

- **Mercado Livre** — OAuth, publicação, leitura de status/vendas, webhooks (marketplace ativo)
- **Mercado Pago** — leitura de liberações financeiras
- **OpenRouter** — IA (copy + visão computacional)
- **Telegram** — alertas operacionais

## Fluxo de publicação

Upload → Ingestão → Enriquecimento por IA → **Revisão humana** → Publicação (Mercado Livre + canais extras opcionais). Ver [03 · Fluxo de Publicação](diagrams/03-publication-flow/).

## Sincronização

O que acontece no marketplace depois da publicação (pedido, pergunta, devolução, moderação) chega de volta ao PubliAI por webhook, reconciliação horária e monitoramento periódico. Ver [04 · Fluxo de Sincronização](diagrams/04-marketplace-sync/).

## Multi-tenancy

Isolamento por `org_id` — shared DB + shared schema, RLS por organização, sem schema/DB por tenant. O maior risco estrutural não é a RLS (que não protege os workers, que rodam com `service_role`), e sim a propagação obrigatória de `org_id` em todo caminho de escrita. Ver [06 · Arquitetura Multi-Tenant](diagrams/06-multi-tenant/).

## Infraestrutura (resumo)

Frontend no Render (Static Site); todo o backend no Supabase (Postgres, Auth, Storage, Edge Functions, Vault); fila e cache no Upstash (QStash, Redis) — tudo gerenciado, sem servidor próprio. Ver [07 · Infraestrutura Simplificada](diagrams/07-infrastructure/).

## Próximo passo arquitetural

Nenhuma reescrita planejada. As pendências identificadas (LGPD/auditoria, cutover do worker de publicação, limpeza de tabela legada) são propostas pequenas e condicionais — ver [08 · Arquitetura Futura Simplificada](diagrams/08-to-be/).

## Todos os diagramas

1. [Visão Geral da Plataforma](diagrams/01-platform-overview/)
2. [Arquitetura Geral](diagrams/02-general-architecture/)
3. [Fluxo de Publicação de Anúncio](diagrams/03-publication-flow/)
4. [Fluxo de Sincronização com Marketplaces](diagrams/04-marketplace-sync/)
5. [Modelo de Dados Simplificado](diagrams/05-simplified-data-model/)
6. [Arquitetura Multi-Tenant](diagrams/06-multi-tenant/)
7. [Infraestrutura Simplificada](diagrams/07-infrastructure/)
8. [Arquitetura Futura Simplificada (TO-BE)](diagrams/08-to-be/)
