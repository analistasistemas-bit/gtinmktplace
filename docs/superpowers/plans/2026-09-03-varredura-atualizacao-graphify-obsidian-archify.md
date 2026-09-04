# Plano de Implementação: Varredura e Atualização do Graphify, Obsidian Vault e Archify

> **Para executores:** SUB-SKILL REQUERIDA: Utilize o fluxo de execução estruturado para implementar este plano tarefa por tarefa. Cada passo utiliza caixas de seleção (`- [ ]`) para acompanhamento rigoroso.

**Objetivo:** Realizar a varredura completa do repositório PubliAI e atualizar integralmente os três pilares de documentação e modelagem do projeto: o Obsidian Vault (`obsidian-vault/`), os diagramas visuais de arquitetura Archify (`docs/architecture/`) e o grafo de conhecimento Graphify (`graphify-out/`), refletindo todas as entregas recentes (Kit Vinculado, Módulo Pulse, Módulo Fiscal, Estoque avançado, novas Edge Functions e papéis de agentes).

**Arquitetura:** O processo segue estritamente a hierarquia de verdade do projeto: `docs/` e ADRs são a fonte de verdade normativa; o Obsidian Vault é o Segundo Cérebro vivo; o Archify materializa os diagramas visuais canônicos em HTML/SVG/PNG; e o Graphify indexa a topologia real do código (`src/`, `supabase/`, `docs/`, `obsidian-vault/`), com poda determinística de falsos positivos via AST e reclusterização.

**Stack Tecnológica:**
- **Obsidian Vault:** Markdown, Frontmatter YAML, Wikilinks Obsidian (`[[Nota]]`).
- **Archify:** Archify v2.11 (JSON schemas `architecture` e `workflow`, template HTML canônico, renderizadores SVG/PNG).
- **Graphify:** Graphify 0.9.6, Python 3.9+ (`scripts/graphify-podar-falsos.py`), AST parsing, Louvain community clustering.
- **Validação:** Node.js, bash, `pnpm docs:links`, `pnpm lint`.

---

## Restrições Globais

1. Todo texto e documentação deve ser redigido em Português do Brasil (pt-BR).
2. Preservar a estrutura existente de diretórios e convenções de nomenclatura.
3. Não inventar dados nem simplificar requisitos de segurança/auditoria.
4. Manter o isolamento e as regras de RLS descritas no `CLAUDE.md`.
5. No Graphify, nunca podar arestas envolvendo `supabase/functions/_shared/**` (código isomórfico importado por ambos os runtimes).
6. No Archify, o arquivo `diagram.html` gerado a partir do `diagram.<tipo>.json` validado é a fonte canônica.
7. Realizar backups de segurança antes de qualquer mutação de grafo ou diagramas.

---

### Tarefa 1: Atualização e Complementação do Obsidian Vault (`obsidian-vault/`)

**Arquivos:**
- Criar: `obsidian-vault/03-Módulos/Pulse.md`
- Modificar: `obsidian-vault/00-Home/Home.md`
- Modificar: `obsidian-vault/00-Home/Visão Geral.md`
- Modificar: `obsidian-vault/01-Arquitetura/Arquitetura Geral.md`
- Modificar: `obsidian-vault/01-Arquitetura/Edge Functions.md`
- Modificar: `obsidian-vault/01-Arquitetura/Banco de Dados.md`
- Modificar: `obsidian-vault/03-Módulos/Estoque.md`
- Modificar: `obsidian-vault/06-Roadmap/Sprint Atual.md`
- Modificar: `obsidian-vault/09-Logs/Changelog.md`

**Interfaces:**
- Consome: `docs/project-status.md`, `docs/TASKS.md`, ADR-0119 a ADR-0151.
- Produz: Notas integradas com wikilinks válidos e metadados atualizados com data `2026-09-03`.

- [x] **Passo 1: Criar a nota do módulo `Pulse.md`**
  Criar `obsidian-vault/03-Módulos/Pulse.md` documentando detalhadamente:
  - Rota `/pulse`, módulo org-gated (`organizations.modulos_habilitados`).
  - Abas: Radar de concorrência (ADR-0119) e Sonar (garimpo por termo e por EAN, ADR-0120, 0122, 0140).
  - Concorrência qualificada (mercado observado vs. relevante, ADR-0130).
  - Apify fallback multi-conta e consultas pagas.
  - Tabelas: `pulse_produtos`, `pulse_ofertas`, `pulse_vendedores`, `pulse_alertas`.
  - Simulador de margem unificado e DRE (ADR-0148, 0149, 0150).

- [x] **Passo 2: Atualizar `00-Home/Home.md` e `00-Home/Visão Geral.md`**
  - Adicionar `[[Pulse]]` na lista de módulos em `00-Home/Home.md`.
  - Atualizar a visão geral de capacidades em `00-Home/Visão Geral.md` incluindo inteligência de mercado (Pulse), kits vinculados e faturamento fiscal.

- [x] **Passo 3: Atualizar `01-Arquitetura/Edge Functions.md`**
  - Atualizar contagem total de Edge Functions de 47 para 62 funções.
  - Adicionar o domínio **Pulse** (`pulse-coletar`, `pulse-adicionar`, `pulse-sonar-vendas`, `pulse-sonar-ean`, `pulse-sonar-visitas`, `pulse-analise-secoes237`).
  - Adicionar o domínio **Fiscal** (`sincronizar-fiscal-ml`, `atualizar-fiscal-familia`, `sugerir-ncm`).
  - Adicionar as funções de **Estoque/Kit/Catálogo** (`criar-kit-vinculado`, `adicionar-variacoes-familia`, `excluir-produto`, `retentar-catalogo`, `tabela-frete-ml`, `buscar-categorias-ml`).

- [x] **Passo 4: Atualizar `01-Arquitetura/Banco de Dados.md`**
  - Adicionar as tabelas `pulse_produtos`, `pulse_ofertas`, `pulse_vendedores`, `pulse_alertas`, `empresa_fiscal`.
  - Registrar as colunas de kit em `familias` (`kit_base_codigo_pai`, `kit_multiplicador` - ADR-0151) e colunas fiscais (`ncm`, `cest`, `origem_nfe`, etc. - ADR-0135).
  - Adicionar novas RPCs do kit vinculado e regras de integridade referencial.

- [x] **Passo 5: Atualizar `03-Módulos/Estoque.md`**
  - Adicionar seção dedicada ao **Kit Vinculado (ADR-0151)**: criação de packs N unidades a partir de produto existente, estoque 100% derivado (`floor(estoque_base/N)`), lote técnico dedicado, trava de catálogo simétrica nos dois sentidos, 19 Edge Functions deployadas.
  - Adicionar detalhes sobre entrada de mercadorias em múltiplas cores simultâneas.
  - Adicionar detalhes sobre "Adicionar variação a família publicada" direto do Estoque (ADR-0129).
  - Adicionar novos estados de feedback: badge "atualizando no ML", botão "Revisar" no card com erro.

- [x] **Passo 6: Atualizar `06-Roadmap/Sprint Atual.md` e `09-Logs/Changelog.md`**
  - Atualizar `Sprint Atual.md` marcando o status real de 2026-09-03: Kit Vinculado 100% implementado e em produção com as 19 Edge Functions deployadas; trava de catálogo fechada; papéis Maestri adicionados.
  - Atualizar `Changelog.md` registrando as entregas de 2026-08-25 a 2026-09-03 (ADR-0135 a ADR-0151).

- [x] **Passo 7: Validar consistência do Obsidian Vault**
  Executar:
  ```bash
  pnpm docs:links
  ```
  Verificar que nenhum link do vault foi quebrado e que todos os metadados estão consistentes.

---

### Tarefa 2: Atualização dos Diagramas de Arquitetura Archify (`docs/architecture/`)

**Arquivos:**
- Modificar: `docs/architecture/diagrams/01-platform-overview/diagram.architecture.json`
- Modificar: `docs/architecture/diagrams/02-general-architecture/diagram.architecture.json`
- Modificar: `docs/architecture/diagrams/03-publication-flow/diagram.workflow.json`
- Modificar: `docs/architecture/diagrams/04-marketplace-sync/diagram.workflow.json`
- Modificar: `docs/architecture/diagrams/05-simplified-data-model/diagram.architecture.json`
- Modificar: `docs/architecture/diagrams/07-infrastructure/diagram.architecture.json`
- Modificar: `docs/architecture/diagrams/08-to-be/diagram.architecture.json`
- Modificar: `docs/architecture/CHANGELOG.md`
- Modificar: `docs/architecture/README.md` e READMEs individuais de cada diagrama

**Interfaces:**
- Consome: JSON Schemas do Archify (`~/.agents/skills/archify/schemas/`).
- Produz: Diagramas atualizados validados, HTML canônico, SVG e PNG exportados.

- [x] **Passo 1: Atualizar os JSONs dos diagramas**
  - `01-platform-overview`: Incluir cadastro manual, kits vinculados, módulo Pulse e serviço externo Apify. Atualizar card multi-tenant (2 organizações em produção: Avil e DSA).
  - `02-general-architecture`: Atualizar Edge Functions para ~60 funções, incluir Apify e ledger de estoque.
  - `03-publication-flow`: Incluir rota de Cadastro Manual / Kit Vinculado, validação fiscal `can_invoice` e sugestão de categoria por catálogo.
  - `04-marketplace-sync`: Incluir fluxo de baixa e push de estoque (`sync-venda` -> `estoque_movimentos` -> QStash `estoque-{orgId}` -> `sincronizar-estoque`), mais cron diário `reconciliar-estoque`.
  - `05-simplified-data-model`: Adicionar nós `estoque_movimentos`, `pulse_produtos`/`pulse_ofertas`, `empresa_fiscal` e conexões correspondentes.
  - `07-infrastructure`: Atualizar contagem de funções e adicionar Apify.
  - `08-to-be`: Atualizar status dos itens implementados e novas metas.

- [x] **Passo 2: Executar validação Archify para todos os diagramas**
  Para cada diagrama, rodar a partir de `~/.agents/skills/archify`:
  ```bash
  node bin/archify.mjs validate <tipo> "<caminho>/diagram.<tipo>.json" --json
  ```
  Corrigir qualquer eventual overlap ou layout sugerido pelo validador.

- [x] **Passo 3: Renderizar os HTMLs canônicos**
  Para cada diagrama:
  ```bash
  node bin/archify.mjs render <tipo> "<caminho>/diagram.<tipo>.json" "<caminho>/diagram.html"
  node bin/archify.mjs check "<caminho>/diagram.html"
  ```

- [x] **Passo 4: Atualizar os artefatos SVG e PNG**
  Executar a extração/exportação dos SVGs e PNGs correspondentes a cada diagrama atualizado, garantindo que o SVG inline de `diagram.html` seja mantido atualizado em `diagram.svg` e renderizado em `diagram.png`.

- [x] **Passo 5: Atualizar a documentação do Archify**
  Atualizar `docs/architecture/CHANGELOG.md` e os `README.md` de cada diagrama registrando a rodada de atualização de 2026-09-03.

---

### Tarefa 3: Atualização e Sincronização do Graphify (`graphify-out/`)

**Arquivos:**
- Modificar: `graphify-out/graph.json`
- Modificar: `graphify-out/manifest.json`
- Modificar: `graphify-out/GRAPH_REPORT.md`
- Modificar: `obsidian-vault/07-IA/Graphify.md`

**Interfaces:**
- Consome: código-fonte de `src/`, `supabase/`, `docs/`, `obsidian-vault/`.
- Produz: Grafo canônico atualizado, podado de falsos positivos e reclusterizado.

- [x] **Passo 1: Criar snapshot de backup do Graphify**
  Fazer cópia de segurança antes de qualquer modificação:
  ```bash
  cp graphify-out/graph.json graphify-out/graph.json.bak-before-update-20260903
  cp graphify-out/manifest.json graphify-out/manifest.json.bak-before-update-20260903
  ```

- [x] **Passo 2: Executar atualização incremental do Graphify**
  Executar o comando de atualização do Graphify no repositório:
  ```bash
  graphify update .
  ```
  Verificar que novos arquivos em `src/`, `supabase/`, `docs/` e `obsidian-vault/` foram processados no manifesto.

- [x] **Passo 3: Aplicar poda determinística de falsos positivos**
  Executar o script oficial do projeto:
  ```bash
  python3 scripts/graphify-podar-falsos.py --aplicar
  ```
  Verificar que nenhuma aresta legítima de `_shared` foi afetada e que todas as premissas foram validadas.

- [x] **Passo 4: Reclusterizar o grafo e gerar relatório**
  Executar:
  ```bash
  graphify cluster-only . --no-label
  ```
  Gerar novo `GRAPH_REPORT.md` e verificar número de nós, links e comunidades.

- [x] **Passo 5: Atualizar a documentação do Graphify no Obsidian Vault**
  Atualizar `obsidian-vault/07-IA/Graphify.md` com as métricas auditadas pós-atualização (número total de nós, links e comunidades identificadas).

---

### Tarefa 4: Verificação Final e Consolidação

**Arquivos:**
- Verificar: `pnpm docs:links`
- Verificar: `pnpm lint`
- Verificar: `git status --short`

- [x] **Passo 1: Rodar checagem de links de documentação**
  ```bash
  pnpm docs:links
  ```
  Garantir zero erros de links quebrados.

- [x] **Passo 2: Rodar linter do projeto**
  ```bash
  pnpm lint
  ```
  Garantir que os arquivos e configurações continuam íntegros.

- [x] **Passo 3: Auditoria final das mudanças**
  Inspecionar `git status --short` e conferir que todas as atualizações foram aplicadas com cirurgia, sem modificações acidentais.
