# Redesign PubliAI — Fase 2: App Shell

> Spec de design. Parte do redesign faseado (ver Fase 1 em `2026-06-08-redesign-fase1-fundacao-design-system-design.md`).
> **Data:** 2026-06-08 · **Branch:** `feat/redesign-publiai` · **Pré-requisito:** Fase 1 (Design System) concluída.

## Objetivo

Transformar o app shell genérico (sidebar plana de 180px, topbar órfã, sem toggle de tema, sem menu de usuário, sem responsividade) num shell premium e responsivo, usando os tokens/componentes da Fase 1. **Zero mudança nas páginas, rotas ou lógica de negócio** — só o entorno.

## Estado atual

- `src/components/app-shell.tsx`: `<div flex h-screen>` com `<Sidebar/>` + `<main>` com `<Outlet/>`. **Não monta o `Topbar`.**
- `src/components/sidebar.tsx`: `<aside w-[180px]>` fixa; `NAV_ITEMS` (Dashboard, Novo lote, Revisão, Publicados, Configurações); rodapé com `diego@empresa` **hardcoded**.
- `src/components/topbar.tsx`: existe mas **não é usado**; mostra "PubliAI" + e-mail + botão Sair.
- Sem toggle de tema, sem menu de usuário, sem drawer mobile. `useAuth()` retorna `{ user, session, loading }`; `signOut()` em `@/lib/auth`.

## Design

### A. Sidebar (desktop, ≥ `lg`)

`<aside>` ~`w-[220px]`, `bg-sidebar` / `border-sidebar-border`. Estrutura:
- **Marca** no topo: logomark (ícone `Sparkles` num quadrado arredondado `bg-primary text-primary-foreground`) + wordmark "PubliAI".
- **Nav**: itens com ícone + label; estado ativo com **acento indigo** (fundo `bg-sidebar-accent` + texto `text-sidebar-accent-foreground` + barra/realce); inativo `text-muted-foreground hover:...`. Transições com os tokens de motion.
- A lista de navegação é extraída num componente `SidebarNav` (reutilizado no drawer mobile). `NAV_ITEMS` exportado.

### B. Topbar (todas as larguras)

Passa a ser montada no shell. `<header>` `h-14`, `border-b`, `sticky top-0 z-30`, `bg-background/80 backdrop-blur`.
- **Esquerda:** botão **hambúrguer** visível só em mobile (`lg:hidden`) que abre o drawer; ao lado, a marca PubliAI compacta (só mobile, já que a sidebar some).
- **Direita:** **toggle de tema** (botão ícone Sol/Lua, usa `useTheme()`); **menu de usuário** (`Avatar` com iniciais do e-mail → `DropdownMenu` com o e-mail real e item "Sair" → `signOut()`). Acaba o e-mail hardcoded.

### C. Responsivo / mobile (< `lg`)

Sidebar desktop escondida (`hidden lg:block`). O hambúrguer abre um **`Sheet`** (`side="left"`, ~`w-[260px]`, `p-0`) renderizando o **mesmo** `SidebarNav` (com `onNavigate` que fecha o drawer ao clicar num link). Estado `mobileOpen` no `AppShell`.

### D. Toaster

Montar `<Toaster/>` (sonner, já corrigido para usar o `ThemeProvider` do projeto) no `AppShell` — habilita toasts de feedback nas fases seguintes. Sem uso ainda nesta fase (só disponível).

## Arquivos

- **Modificar:** `src/components/app-shell.tsx` (compõe sidebar desktop + topbar + Outlet + Toaster + Sheet mobile), `src/components/sidebar.tsx` (extrai `NAV_ITEMS`/`SidebarNav` + marca), `src/components/topbar.tsx` (hambúrguer + toggle + user menu).
- **Criar:** `src/components/theme-toggle.tsx`, `src/components/user-menu.tsx`.
- **Não tocar:** páginas, rotas, hooks de domínio, queries, edge functions, schema. `App.tsx` permanece igual (AppShell já está no router).

## Acessibilidade

- Hambúrguer e toggle com `aria-label`. Toggle anuncia o estado.
- `Sheet` (Radix) já trata foco/escape/scroll-lock.
- Estado ativo da nav não depende só de cor (mantém peso/realce). Foco visível em todos os interativos.

## Testes e verificação

- Testes de fumaça (vitest + RTL): `theme-toggle` alterna o tema ao clicar (dentro de `ThemeProvider`); `SidebarNav` renderiza os 5 links com hrefs corretos. Montados em `MemoryRouter`.
- Não-regressão: 331 testes seguem verdes; tsc/lint/build limpos.
- Visual: validar ao vivo (desktop + responsivo via devtools) — sidebar, topbar, toggle, user menu, drawer mobile.

## Critérios de aceite

- [ ] Sidebar premium (marca + nav com acento indigo) no desktop.
- [ ] Topbar com toggle de tema + menu de usuário (e-mail real, Sair).
- [ ] Drawer mobile (`Sheet`) com a mesma navegação; sidebar some < `lg`.
- [ ] `<Toaster/>` montado.
- [ ] E-mail hardcoded removido.
- [ ] Páginas/rotas/lógica inalteradas; 331 testes verdes + novos; tsc/lint/build limpos.

## Fora de escopo

Sidebar colapsável (YAGNI por ora), migração das páginas para `PageHeader`, KPIs, breadcrumbs dinâmicos. Cada um nas fases seguintes.
