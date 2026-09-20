# Changelog — docs/architecture/

## 2026-09-20 — Atualização Arquitetural (Archify v2.17, Moda, Size Charts e Billing)

- Atualização da engine Archify de **v2.11** para **v2.17** com nova suíte de validação de clearance de rótulos e rotas ortogonais.
- Incorporadas as entregas de setembro de 2026 em todos os 8 diagramas:
  - `01-platform-overview`: Adicionado suporte a vestuário/calçados (duplo eixo Cor × Tamanho e Size Charts) e Central de Cobrança (`/admin`, ADR-0165).
  - `02-general-architecture`: Atualizado inventário para **71 Edge Functions** Deno, módulo de Platform Admin & Billing e expansão de domínios.
  - `03-publication-flow`: Incorporado fluxo de entrada bidimensional de grade (ADR-0166) e vinculação de Guia de Tamanhos (Size Charts) via API ML (ADR-0167).
  - `04-marketplace-sync`: Adicionado encerramento automático de anúncio sem vendas no Mercado Livre ao remover publicado (ADR-0168) e convergência UP a cada 15min.
  - `05-simplified-data-model`: Adicionada entidade `ml_size_charts` (ADR-0167), par unívoco Cor × Tamanho em `variacoes` (ADR-0166) e termos de billing da plataforma nos cards.
  - `06-multi-tenant`: Adicionada governança do Platform Admin / Super-admin na Central `/admin` com escopo auditado cross-tenant.
  - `07-infrastructure`: Atualizado para 71 Edge Functions e detalhados os agendamentos QStash periódicos.
  - `08-to-be`: Promovidas features já consolidadas em produção (Pulse, Kits Vinculados/Virtuais, Central de Cobrança) e foco no E5 Shopee.
- Todos os 8 diagramas validados com 0 erros via Archify v2.17, renderizados para `diagram.html`, com `diagram.svg` e `diagram.png` (2000×1136) 100% atualizados.

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
