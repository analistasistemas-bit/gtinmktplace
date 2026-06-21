# Repaginação Visual Premium (Tarefa 1) — Design

**Data:** 2026-06-20
**Branch:** `worktree-design+repaginacao-visual-premium`
**Status:** aprovado para planejamento
**Sessão:** grilling (`/grill-with-docs`)

## Contexto

O PubliAI vai evoluir para SaaS comercial. A interface atual já tem fundação sólida
(design system tokenizado em OKLCH, dark mode, cores semânticas com contraste AA,
tipografia Geist, `prefers-reduced-motion`), mas tem "cara de ferramenta interna".
O objetivo é elevá-la a um nível **premium/vendável** sem mexer em comportamento.

Este trabalho é a **Tarefa 1 de duas, totalmente distintas**:

- **Tarefa 1 (esta):** repaginação **visual** (estética).
- **Tarefa 2 (futura, sessão separada):** reestruturação de **UX/fluxos** (navegação, organização de telas, nº de cliques).

## Objetivo

Dar uma cara **premium desktop** ao app, **light-first**, inspirada na referência
CentralFlow CRM, **sem alterar** lógica, rotas, dados, queries ou backend.

## Referência visual

CentralFlow CRM / Email SaaS (Behance — RonDesignLab). Características capturadas:
dark grafite premium, **accent roxo/violeta vibrante** (coincide com a primária atual
do app), **cantos bem arredondados** (~12–16px), **gradientes pontuais** em destaques,
cards com elevação suave, muito respiro, tipografia sans limpa.
Adaptada para **light-first** no PubliAI.

## Decisões travadas

| # | Decisão | Detalhe |
|---|---|---|
| 1 | **Escopo** | Só estética. UX = Tarefa 2 |
| 2 | **Tema** | **Light-first premium**; dark refinado junto (propaga via tokens) |
| 3 | **Sabor** | **Híbrido com regra fixa** (ver abaixo) |
| 4 | **Primária** | Roxo atual mantido (`oklch 0.55 0.20 277`), só calibrar vivacidade |
| 5 | **Gradiente de marca** | roxo→índigo (`oklch 0.55 0.20 277` → `oklch 0.58 0.21 300`), **só na vitrine** |
| 6 | **Tons quentes** | Fora da cor de marca; no máximo em ilustrações de empty-state |
| 7 | **Tipografia** | **Geist mantida**; só refinar escala/pesos |
| 8 | **Rollout** | Faseado: Fase 0 → piloto → validação → propagação |
| 9 | **Piloto** | **Dashboard + Publicados + Financeiro** |

### Regra do híbrido (sabor)

- **Áreas de vitrine** (Dashboard, KPIs, navegação, telas de entrada, empty-states):
  expressivas — roxo presente, gradiente de marca pontual, profundidade, cantos arredondados.
- **Áreas de dados** (tabelas: Publicados, Financeiro, Revisão): disciplina minimalista —
  **sem gradiente**, máxima legibilidade, bordas finas, sombras sutis.

## Plano de execução (rollout faseado)

### Fase 0 — Fundação (tokens + StyleGuide)
- Calibrar primária roxa; definir token de gradiente de marca.
- Sombras premium, radius um pouco maior, escala tipográfica, espaçamento (grid 4/8px).
- Atualizar a página `StyleGuide` como vitrine do novo sistema.
- Como muito é tokenizado em `src/index.css`, parte propaga automaticamente.

### Fase 1 — Piloto (3 telas)
- **Dashboard** — vitrine: hero, KPIs com gradiente, profundidade.
- **Publicados** — dados densos: disciplina minimalista nas tabelas.
- **Financeiro** — meio-vitrine: gradiente nos KPI cards (`kpi-card`, `card-voce-recebe`),
  disciplina nas tabelas de lançamentos.
- Entrega: screenshots **antes/depois** (light + dark) via browser-use.

### ➤ Gate de validação (Diego)
Roda local (`pnpm dev`) na branch e aprova antes da propagação.

### Fase 2 — Propagação
Só após OK: aplicar o novo sistema nas demais ~14 telas.

## Guard-rails (inegociáveis)

- Mudança **puramente visual**: tokens + componentes de apresentação.
  **Zero** alteração de lógica, rotas, dados, queries, Edge Functions.
- **Testes verdes** (`pnpm test`) ao fim de cada fase.
- **Acessibilidade AA** mantida (contraste dos tokens semânticos).
- Branch própria de design; **nenhum commit/push/deploy sem OK explícito** do Diego.
- Validação **somente local** (sem deploy preview no Render).

## Fora de escopo

- Qualquer mudança de UX/fluxo/navegação (é a Tarefa 2).
- Troca de fonte de marca, paleta nova, ou cor quente como cor primária.
- Mexer em backend, dados, ou comportamento de qualquer tela.
- Mobile/responsivo dedicado (app é desktop-first nesta tarefa).

## Ferramentas

- **ui-ux-pro-max** como referência de design/cores/componentes na construção.
- **browser-use (skill)** para capturar screenshots antes/depois.
