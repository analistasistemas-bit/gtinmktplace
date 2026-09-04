# Changelog — docs/architecture/

## 2026-09-03 — Varredura Geral e Atualização Arquitetural

- Atualizados os diagramas Archify com os avanços recentes do sistema:
  - `01-platform-overview`: Adicionado módulo de Inteligência de Mercado (Pulse / Radar & Sonar) e Apify Web Scraper.
  - `02-general-architecture`: Adicionado serviço Pulse, integração Apify e 6 Edge Functions do Radar/Sonar.
  - `03-publication-flow`: Atualizado fluxo de publicação com suporte a Kit Vinculado (ADR-0151).
  - `04-marketplace-sync`: Adicionado fluxo de sincronização de estoque para kits vinculados (baixa no componente base).
  - `05-simplified-data-model`: Adicionadas entidades `pulse_concorrentes`, `pulse_snapshots`, `empresa_fiscal` e campos de Kit em `familias`.
  - `07-infrastructure`: Adicionados nós do Apify Scraper e serviços de monitoramento/concorrência.
  - `08-to-be`: Atualizado status dos módulos (Pulse ativo em produção com Radar/Sonar).
- Todos os diagramas foram validados via `archify validate` (v2.11) e `archify check`, e exportados para SVG e PNG.

## 2026-07-19 — Criação inicial

- Criada a documentação arquitetural completa com 8 diagramas (Archify v2.11): Visão Geral, Arquitetura Geral, Fluxo de Publicação, Fluxo de Sincronização, Modelo de Dados Simplificado, Multi-Tenant, Infraestrutura, TO-BE.
- Fontes: Obsidian vault (`obsidian-vault/`), `docs/` (explanation, reference, decisions, project-status), Graphify (snapshot `graphify-out/2026-07-18`).
- Divergência resolvida: nota do vault sobre multi-tenancy estava desatualizada (pré-E7) — ver `open-questions.md`.
- Diagramas C4 anteriores (`docs/diagrams/*.drawio`, 2026-06-28) mantidos como estão — não substituídos, complementares (ERD completo e sequências de Faturamento/Financeiro continuam só lá).
