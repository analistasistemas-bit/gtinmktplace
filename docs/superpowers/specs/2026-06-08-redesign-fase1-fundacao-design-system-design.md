# Redesign PubliAI — Fase 1: Fundação & Design System

> Spec de design (brainstorming). Parte do redesign profissional/premium do PubliAI.
> **Data:** 2026-06-08 · **Branch:** `feat/redesign-publiai` · **Skill de design:** `ui-ux-pro-max`

## Contexto e decomposição do redesign

O pedido original é um redesign completo (design system + theming + 5 telas + componentes + docs). Para reduzir risco ao fluxo de negócio e manter PRs revisáveis, o trabalho foi **decomposto em fases**, todas na mesma branch `feat/redesign-publiai`, **sem merge na main até aprovação explícita do Diego**. Cada fase tem spec → plano → subagent-driven → review (`/code-review` + Codex) → screenshot antes/depois.

| Fase | Escopo | Status |
|---|---|---|
| **1** | **Fundação & Design System** (este doc) | em design |
| 2 | App shell (sidebar/topbar premium, toggle de tema, menu de usuário, responsivo) | pendente |
| 3 | Revisão (tela mais importante — centro de comando) | pendente |
| 4 | Dashboard executivo (KPIs com dado real) | pendente |
| 5 | Publicados (tabela SaaS) | pendente |
| 6 | Novo Lote (upload) | pendente |
| 7 | Configurações (painel admin) | pendente |

**Decisões já tomadas com o Diego:** abordagem **faseada**; cor de marca **indigo/violeta**; **dark como padrão** + toggle persistido.

## Objetivo da Fase 1

Substituir a fundação visual genérica (tema cinza default do shadcn, dark mode morto) por um **design system próprio do PubliAI**: paleta de marca indigo/violeta, tokens semânticos, elevação, motion, tipografia, dark mode funcional como padrão, primitivos shadcn faltantes e um conjunto de componentes reutilizáveis — tudo validável numa rota `/style-guide`. **Zero mudança de lógica de negócio.**

## Estado atual (auditoria)

- `src/index.css` — Tailwind v4 (`@theme inline` + `:root`/`.dark`). **Todos os tokens de cor são `oklch(L 0 0)` (croma 0 = cinza puro)** = tema neutro default do shadcn.
- O bloco `.dark` existe e está completo, mas **nada aplica a classe `.dark`** (sem `ThemeProvider`/toggle) → o app roda só no claro.
- Sem tokens semânticos (success/warning/info) — componentes hardcodam `green-50/amber-50/red-500` etc.
- Sem tokens de shadow/elevação nem de motion. Tipografia só Geist sans, sem escala.
- `src/components/ui/` tem 12 primitivos. **Faltam:** `table, tabs, tooltip, skeleton, sonner, switch, sheet, separator, avatar, scroll-area`. Sem lib de gráficos.
- Shell: `AppShell` = `Sidebar` (180px fixa) + `<Outlet>`; sem responsividade nem toggle. (Redesenhado na Fase 2.)

## Design

### A. Tokens de cor (oklch) — valores iniciais

Mantém os **nomes** dos tokens shadcn (não quebra componentes existentes) e **recolore**. Valores iniciais abaixo; a fase de build (ui-ux-pro-max) afina para garantir contraste **AA**. Hue de marca ≈ **277 (indigo)**, acento ≈ **300 (violeta)**.

**Light (`:root`):**
```
--background:        oklch(0.99 0.004 277);
--foreground:        oklch(0.21 0.02 277);
--card:              oklch(1 0 0);
--card-foreground:   oklch(0.21 0.02 277);
--popover:           oklch(1 0 0);
--popover-foreground:oklch(0.21 0.02 277);
--primary:           oklch(0.55 0.20 277);
--primary-foreground:oklch(0.985 0.005 277);
--secondary:         oklch(0.96 0.008 277);
--secondary-foreground: oklch(0.30 0.03 277);
--muted:             oklch(0.965 0.006 277);
--muted-foreground:  oklch(0.52 0.02 277);
--accent:            oklch(0.95 0.03 300);
--accent-foreground: oklch(0.35 0.10 300);
--border:            oklch(0.91 0.006 277);
--input:             oklch(0.91 0.006 277);
--ring:              oklch(0.55 0.20 277);
--destructive:       oklch(0.58 0.22 25);
/* semânticos novos */
--success:           oklch(0.62 0.15 150);
--success-foreground:oklch(0.99 0 0);
--warning:           oklch(0.72 0.16 75);
--warning-foreground:oklch(0.21 0.02 75);
--info:              oklch(0.60 0.14 240);
--info-foreground:   oklch(0.99 0 0);
--danger:            var(--destructive);
/* charts categóricos */
--chart-1: oklch(0.55 0.20 277);  /* indigo  */
--chart-2: oklch(0.58 0.21 300);  /* violeta */
--chart-3: oklch(0.70 0.12 190);  /* teal    */
--chart-4: oklch(0.76 0.15 75);   /* âmbar   */
--chart-5: oklch(0.63 0.20 12);   /* rosé    */
```

**Dark (`.dark`) — modo padrão:**
```
--background:        oklch(0.165 0.012 277);
--foreground:        oklch(0.96 0.005 277);
--card:              oklch(0.205 0.014 277);
--card-foreground:   oklch(0.96 0.005 277);
--popover:           oklch(0.195 0.014 277);
--popover-foreground:oklch(0.96 0.005 277);
--primary:           oklch(0.64 0.18 277);
--primary-foreground:oklch(0.985 0.005 277);
--secondary:         oklch(0.26 0.015 277);
--secondary-foreground: oklch(0.96 0.005 277);
--muted:             oklch(0.255 0.012 277);
--muted-foreground:  oklch(0.71 0.015 277);
--accent:            oklch(0.30 0.045 300);
--accent-foreground: oklch(0.96 0.01 300);
--border:            oklch(1 0 0 / 10%);
--input:             oklch(1 0 0 / 14%);
--ring:              oklch(0.64 0.18 277);
--destructive:       oklch(0.68 0.19 25);
--success:           oklch(0.70 0.15 150);
--success-foreground:oklch(0.16 0.02 150);
--warning:           oklch(0.80 0.15 75);
--warning-foreground:oklch(0.16 0.02 75);
--info:              oklch(0.70 0.14 240);
--info-foreground:   oklch(0.16 0.02 240);
--danger:            var(--destructive);
--chart-1: oklch(0.64 0.18 277);
--chart-2: oklch(0.62 0.21 300);
--chart-3: oklch(0.72 0.12 190);
--chart-4: oklch(0.80 0.15 75);
--chart-5: oklch(0.68 0.20 12);
```

Os novos tokens semânticos entram também no `@theme inline` como `--color-success`, `--color-warning`, `--color-info`, `--color-danger` (+ `-foreground`) para virarem utilitários Tailwind (`bg-success`, `text-warning`, etc.). Sidebar tokens recoloridos no mesmo hue.

### B. Modo de tema (dark padrão + toggle)

- `ThemeProvider` próprio enxuto (`src/lib/theme.tsx` ou `src/components/theme-provider.tsx`): estado `'dark' | 'light'`, default **dark**, persistido em `localStorage['publiai-theme']`; aplica/remove a classe `.dark` no `document.documentElement`.
- Script **inline** no `index.html` (antes do bundle) lê o localStorage e seta a classe antes do primeiro paint → **sem flash**. Default dark quando não há valor salvo.
- Hook `useTheme()` expõe `{ theme, setTheme, toggle }`.
- O **controle visual** do toggle (Switch/ícone sol-lua) é montado na Fase 2 (topbar). Na Fase 1, o provider + um toggle no `/style-guide` provam o funcionamento.
- Decisão: **não** respeita `prefers-color-scheme` no 1º acesso — força dark por padrão (pedido do Diego).

### C. Tipografia

Mantém **Geist Variable** (já importada). Adiciona escala via utilitários no `@layer`/classes:
- `display` — 2.25rem, peso 600, tracking -0.02em, leading 1.1
- `h1` 1.5rem/600 · `h2` 1.25rem/600 · `h3` 1.0625rem/600 (tracking -0.01em)
- `body` 0.875rem/400 · `caption` 0.75rem/400 (muted)
- Números (preços/KPIs): `tabular-nums` (já em uso pontual; padronizar nos componentes de dado).

### D. Elevação, radius e motion (tokens)

- **Shadow** (calibrado p/ dark, baixa opacidade) no `@theme inline`: `--shadow-xs/sm/md/lg`. Ex.: `--shadow-sm: 0 1px 3px oklch(0 0 0 / 0.24), 0 1px 2px oklch(0 0 0 / 0.16)`.
- **Radius**: escala já existe (`--radius` 0.625rem + sm/md/lg/xl…). Mantida.
- **Motion**: `--ease-out: cubic-bezier(0.16,1,0.3,1)`, `--ease-emph: cubic-bezier(0.65,0,0.35,1)`, `--duration-fast: 120ms`, `--duration-base: 180ms`, `--duration-slow: 240ms`. Hover/focus/press padronizados via classes utilitárias.

### E. Primitivos shadcn a adicionar

Via **MCP do shadcn** (skill ui-ux-pro-max integra), adicionar a `src/components/ui/`: `table`, `tabs`, `tooltip`, `skeleton`, `sonner` (toaster), `switch`, `sheet`, `separator`, `avatar`, `scroll-area`. Adicionar dependência **recharts** (gráficos do Dashboard, Fase 4). O `<Toaster/>` (sonner) é montado no shell na Fase 2; nesta fase fica disponível e exercitado no style-guide.

### F. Componentes reutilizáveis novos (contratos)

Criados em `src/components/ui/` (genéricos) ou `src/components/` (de produto). Cada um com responsabilidade única e props tipadas:

- **`PageHeader`** — `{ title, subtitle?, actions?, breadcrumb? }`. Cabeçalho padrão de toda página (hoje cada tela faz seu próprio `<div className="mb-4 flex…">`).
- **`KpiCard`** — `{ label, value, icon?, delta?, deltaTrend?: 'up'|'down'|'neutral', hint?, loading? }`. Card de métrica do Dashboard. Usa `tabular-nums`.
- **`DataTable`** — wrapper fino sobre o `Table` do shadcn: header sticky, suporte a estados `loading` (skeleton rows), `empty` (slot `EmptyState`), densidade compacta. Não reimplementa sort/filtro do TanStack — recebe linhas já prontas (as telas mantêm sua lógica). Objetivo: padronizar a casca visual da Publicados e futuras tabelas.
- **`EmptyState`** — `{ icon?, title, description?, action? }`. Hoje cada tela tem um `<div border-dashed>` ad-hoc.
- **`StatusPill`** — `{ tone: 'success'|'warning'|'danger'|'info'|'neutral', children }`. Substitui os badges com cor hardcoded (usa tokens semânticos). Os componentes `status-badge.tsx`/`status-inline.tsx` existentes são candidatos a migrar para ele (sem alterar a semântica atual).
- **`Section`** — agrupador com título opcional e espaçamento padrão.

**Migração nesta fase:** apenas introduzir os componentes e usá-los no `/style-guide`. A adoção tela-a-tela acontece nas fases de cada tela (3–7), para manter o diff revisável. Exceção: se a recolorização exigir tocar num badge hardcoded para não ficar quebrado em dark, migra-se aquele ponto pontualmente.

### G. Rota `/style-guide` (validação + doc viva)

Página só-dev (não entra no menu de produção) que renderiza: paletas (light/dark), tipografia, sombras/radius, todos os primitivos shadcn (estados: default/hover/focus/disabled/loading), e os componentes novos (KpiCard, DataTable com loading/empty, StatusPill em todos os tons, EmptyState). Toggle de tema no topo. É onde validamos a Fase 1 por screenshot e onde o guia do DS "vive".

## Arquivos afetados (previsão)

- **Modificar:** `src/index.css` (tokens), `index.html` (script anti-flash), `src/main.tsx` ou `src/App.tsx` (montar `ThemeProvider`), `src/App.tsx`/router (rota `/style-guide`), `package.json` (recharts + primitivos).
- **Criar:** `src/components/theme-provider.tsx` + `src/hooks/useTheme.ts`; `src/components/ui/{table,tabs,tooltip,skeleton,sonner,switch,sheet,separator,avatar,scroll-area}.tsx`; `src/components/ui/{kpi-card,data-table,empty-state,status-pill,page-header,section}.tsx`; `src/pages/StyleGuide.tsx`; doc `docs/design-system/README.md` (guia do DS).
- **Não tocar:** Edge Functions, `_shared/`, lógica de queries/hooks de domínio, schema. Telas existentes só herdam a recolorização (sem refactor).

## Estados, erros e acessibilidade

- **Foco visível:** ring com `--ring` (indigo) em todos os interativos; nunca remover outline sem substituto.
- **Contraste AA:** verificar pares texto/fundo na paleta nova (build afina os L/C). Dark é o caso crítico.
- **Motion reduzido:** respeitar `prefers-reduced-motion` (desliga transições não essenciais).
- **Teclado:** primitivos shadcn já são acessíveis (Radix); o toggle de tema e o DataTable preservam isso.

## Testes e verificação

- **Funções puras nesta fase: poucas.** O `ThemeProvider` tem lógica testável: default dark, persistência em localStorage, toggle. → teste (vitest + @testing-library) cobrindo: monta em dark por default; lê valor salvo; `toggle` alterna e persiste.
- **Não-regressão:** todos os testes atuais (321) seguem verdes; `tsc`, `eslint`, `pnpm build` limpos.
- **Visual:** screenshot do `/style-guide` em dark e light + 1 screenshot de uma tela existente (ex.: Publicados) já recolorida, antes/depois.

## Critérios de aceite da Fase 1

- [ ] Paleta indigo/violeta aplicada (light + dark), tokens semânticos disponíveis como utilitários.
- [ ] Dark mode **padrão**, toggle funcional e persistido, **sem flash** no load.
- [ ] Primitivos shadcn faltantes + recharts instalados.
- [ ] Componentes reutilizáveis criados e exibidos no `/style-guide`.
- [ ] `/style-guide` renderiza tudo em ambos os temas.
- [ ] Guia do DS documentado (`docs/design-system/README.md`).
- [ ] 321 testes verdes + testes novos do ThemeProvider; tsc/eslint/build limpos.
- [ ] Telas existentes continuam funcionando (fluxo preservado).

## Fora de escopo (Fase 1)

Redesenho das telas (Fases 2–7), KPIs reais do Dashboard, refactor de tabelas/telas para os novos componentes (acontece na fase de cada tela). Aqui só se constrói e valida a **base**.
