# Obsidian Vault Full Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sincronizar todas as notas do `obsidian-vault/` com as fontes oficiais atuais do PubliAI, preservando a estrutura e alterando somente divergências comprovadas.

**Architecture:** A auditoria usa `docs/` como fonte de verdade e Graphify como confirmação estrutural. O trabalho é dividido em inventário automático, revisão semântica por domínio, correções mínimas e validação integral de metadados e wikilinks.

**Tech Stack:** Markdown, Obsidian wikilinks, frontmatter YAML, Graphify CLI, Git e utilitários POSIX.

## Global Constraints

- Auditar todas as notas Markdown em `obsidian-vault/`.
- Preservar nomes, pastas, estilo e granularidade atuais.
- Não reorganizar pastas ou renomear notas.
- Não alterar `docs/`, código, banco ou infraestrutura.
- Não reescrever notas corretas apenas por preferência editorial.
- `docs/` prevalece sobre o vault; Graphify confirma estrutura, mas não substitui decisões ou status.
- Não consultar fontes externas.

---

### Task 1: Inventário e mapa de divergências

**Files:**
- Read: `obsidian-vault/**/*.md`
- Read: `docs/project-status.md`
- Read: `docs/TASKS.md`
- Read: `docs/ROADMAP.md`
- Read: `docs/decisions/*.md`
- Read: `graphify-out/graph.json`
- Create: `/tmp/publiai-vault-audit/findings.tsv`

**Interfaces:**
- Consumes: fontes oficiais e notas atuais.
- Produces: lista tabular `categoria<TAB>nota<TAB>fonte<TAB>achado`, usada pelas Tasks 2 e 3.

- [ ] **Step 1: Inventariar notas e wikilinks**

Run:

```bash
mkdir -p /tmp/publiai-vault-audit
find obsidian-vault -type f -name '*.md' -print | sort > /tmp/publiai-vault-audit/notes.txt
rg -n '\[\[[^]]+\]\]' obsidian-vault > /tmp/publiai-vault-audit/wikilinks.txt
```

Expected: `notes.txt` contém todas as notas; `wikilinks.txt` contém todas as ocorrências de wikilinks.

- [ ] **Step 2: Mapear fontes por domínio**

Run:

```bash
find docs/decisions -type f -name '*.md' -print | sort > /tmp/publiai-vault-audit/adrs.txt
graphify query "Map current PubliAI architecture, modules, integrations and active roadmap work" \
  --graph "/Users/diego/Desktop/IA/Anuncios MktPlace/graphify-out/graph.json" \
  --budget 4000 > /tmp/publiai-vault-audit/graphify.txt
```

Expected: inventário de ADRs e contexto Graphify disponíveis para comparação.

- [ ] **Step 3: Registrar somente divergências comprovadas**

Compare, nesta ordem:

1. `00-Home/` com `docs/project-status.md` e glossário oficial.
2. `01-Arquitetura/` e `02-Fluxos/` com Graphify e ADRs.
3. `03-Módulos/` com `docs/project-status.md`, `TASKS.md` e ADRs.
4. `04-Decisões/` com `docs/decisions/`.
5. `05-Bugs/` com entregas e incidentes registrados em `TASKS.md`.
6. `06-Roadmap/` com `project-status.md` e `ROADMAP.md`.

Para cada divergência, adicione uma linha a `findings.tsv` com uma destas categorias exatas:
`factual`, `link`, `metadata`, `missing`.

- [ ] **Step 4: Revisar o mapa**

Run:

```bash
sort -u /tmp/publiai-vault-audit/findings.tsv -o /tmp/publiai-vault-audit/findings.tsv
cut -f1 /tmp/publiai-vault-audit/findings.tsv | sort | uniq -c
```

Expected: nenhuma categoria fora de `factual`, `link`, `metadata`, `missing`; nenhuma recomendação puramente editorial.

- [ ] **Step 5: Commit**

Não há commit nesta task: os artefatos ficam em `/tmp` e servem somente à execução.

### Task 2: Corrigir estado, arquitetura, módulos e fluxos

**Files:**
- Modify: notas listadas em `findings.tsv` sob `00-Home/`, `01-Arquitetura/`, `02-Fluxos/` e `03-Módulos/`

**Interfaces:**
- Consumes: achados `factual`, `metadata` e `missing` da Task 1.
- Produces: notas operacionais e técnicas coerentes com `docs/` e Graphify.

- [ ] **Step 1: Atualizar fatos e metadados**

Em cada nota afetada:

- preserve o frontmatter existente;
- atualize `atualizado:` para `2026-07-24` somente quando o corpo mudar;
- use a terminologia exata das fontes oficiais;
- mantenha detalhes técnicos em `docs/` e resuma no vault com wikilinks.

- [ ] **Step 2: Conferir o diff temático**

Run:

```bash
git diff -- obsidian-vault/00-Home obsidian-vault/01-Arquitetura \
  obsidian-vault/02-Fluxos obsidian-vault/03-Módulos
git diff --check
```

Expected: somente correções respaldadas por linhas de `findings.tsv`; zero erro de whitespace.

- [ ] **Step 3: Commit**

```bash
git add obsidian-vault/00-Home obsidian-vault/01-Arquitetura \
  obsidian-vault/02-Fluxos obsidian-vault/03-Módulos
git commit -m "docs(vault): sincroniza arquitetura fluxos e módulos"
```

### Task 3: Corrigir decisões, bugs, roadmap e índices

**Files:**
- Modify: `obsidian-vault/04-Decisões/Índice de ADRs.md`
- Modify: notas listadas em `findings.tsv` sob `04-Decisões/`, `05-Bugs/` e `06-Roadmap/`

**Interfaces:**
- Consumes: achados da Task 1 e notas corrigidas na Task 2.
- Produces: índice de decisões completo, histórico vivo coerente e roadmap atual.

- [ ] **Step 1: Sincronizar o índice de ADRs**

Compare cada arquivo enumerado em `/tmp/publiai-vault-audit/adrs.txt` com
`04-Decisões/Índice de ADRs.md`. Adicione entradas ausentes usando o formato já existente e corrija
status ou títulos divergentes com base no cabeçalho do ADR oficial.

- [ ] **Step 2: Atualizar bugs e roadmap**

Corrija somente entradas presentes em `findings.tsv`. `Sprint Atual.md` deve refletir:

- entregas em produção registradas em `project-status.md`;
- próximo foco oficial;
- pendências ainda abertas, sem reabrir itens concluídos.

- [ ] **Step 3: Conferir o diff temático**

Run:

```bash
git diff -- obsidian-vault/04-Decisões obsidian-vault/05-Bugs obsidian-vault/06-Roadmap
git diff --check
```

Expected: índice e roadmap coerentes com as fontes; nenhuma reorganização estrutural.

- [ ] **Step 4: Commit**

```bash
git add obsidian-vault/04-Decisões obsidian-vault/05-Bugs obsidian-vault/06-Roadmap
git commit -m "docs(vault): atualiza decisões bugs e roadmap"
```

### Task 4: Validação integral e relatório

**Files:**
- Verify: `obsidian-vault/**/*.md`
- Modify: somente notas que falharem nas verificações abaixo

**Interfaces:**
- Consumes: vault atualizado nas Tasks 2 e 3.
- Produces: vault validado e resumo final baseado em evidências.

- [ ] **Step 1: Validar frontmatter**

Verifique que toda nota que já possuía frontmatter continua começando e terminando o bloco com
`---`, e que notas alteradas usam `atualizado: 2026-07-24`.

Run:

```bash
rg -l '^---$' obsidian-vault | sort > /tmp/publiai-vault-audit/frontmatter.txt
rg -n '^atualizado:' obsidian-vault
```

Expected: nenhum bloco truncado e nenhuma data futura ou inválida.

- [ ] **Step 2: Validar wikilinks**

Para cada `[[Alvo]]` ou `[[Alvo|Rótulo]]`, remova alias e fragmento `#...`, e confirme que existe
uma nota com o mesmo basename ou caminho relativo. Links de canvas, anexos e referências externas
devem ser classificados separadamente, não tratados como notas quebradas.

Expected: zero wikilink interno quebrado não documentado.

- [ ] **Step 3: Validar consistência factual**

Run:

```bash
rg -n 'próximo foco|em produção|pendente|concluído|E5|E6b|ADR-00' obsidian-vault
git diff --check
git status --short
```

Compare os resultados com `docs/project-status.md`, `docs/TASKS.md` e o índice de ADRs.

Expected: nenhuma contradição remanescente e somente arquivos de documentação esperados alterados.

- [ ] **Step 4: Revisar o diff completo**

Run:

```bash
git diff main...HEAD -- obsidian-vault
git diff --stat main...HEAD
```

Expected: menor diff suficiente para eliminar todos os itens de `findings.tsv`.

- [ ] **Step 5: Commit de correções de validação, se necessário**

```bash
git add obsidian-vault
git commit -m "docs(vault): corrige links e metadados da auditoria"
```

Se nenhuma correção adicional for necessária, não crie commit vazio.

