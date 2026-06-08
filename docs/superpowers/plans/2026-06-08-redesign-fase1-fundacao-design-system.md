# Redesign PubliAI — Fase 1 (Fundação & Design System) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a fundação visual genérica (tema cinza default, dark mode morto) por um design system próprio do PubliAI — paleta indigo/violeta em oklch (light+dark), tokens semânticos/elevação/motion, tipografia, dark mode padrão com toggle persistido sem flash, primitivos shadcn faltantes + recharts, e componentes reutilizáveis — validável numa rota `/style-guide`.

**Architecture:** Tokens recoloridos em `src/index.css` mantendo os nomes shadcn (não quebra telas). `ThemeProvider` próprio (localStorage `publiai-theme`, default dark, aplica classe `.dark`) montado no `main.tsx` + script anti-flash no `index.html`. Componentes genéricos novos em `src/components/ui/`. Zero mudança de lógica de negócio.

**Tech Stack:** React 18 + TypeScript + Tailwind v4 (`@theme inline`) + shadcn/ui (style `radix-nova`, pacote `radix-ui`) + lucide + vitest/@testing-library + recharts. Gerenciador: pnpm. Branch: `feat/redesign-publiai`.

**Spec:** `docs/superpowers/specs/2026-06-08-redesign-fase1-fundacao-design-system-design.md`

---

## File Structure

- **Modificar:** `src/index.css` (tokens), `index.html` (anti-flash), `src/main.tsx` (montar provider), `src/App.tsx` (rota `/style-guide`), `package.json` (deps).
- **Criar (fundação):** `src/components/theme-provider.tsx` (+ `useTheme`).
- **Criar (primitivos shadcn, via CLI):** `src/components/ui/{table,tabs,tooltip,skeleton,sonner,switch,sheet,separator,avatar,scroll-area}.tsx`.
- **Criar (reutilizáveis):** `src/components/ui/{page-header,section,empty-state,status-pill,kpi-card,data-table}.tsx`.
- **Criar (validação/doc):** `src/pages/StyleGuide.tsx`, `docs/design-system/README.md`.
- **Criar (testes):** `tests/components/theme-provider.test.tsx`, `tests/components/ui-components.test.tsx`.
- **Não tocar:** `supabase/`, `_shared/`, queries/hooks de domínio, schema.

---

## Task 1: Tokens de cor (indigo/violeta) + semânticos no index.css

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Recolorir `:root` (light) e `.dark`, adicionar semânticos e charts**

Substitua os blocos `:root { … }` e `.dark { … }` atuais (linhas ~51–118) por estes (mantém todos os nomes existentes + adiciona `--success/--warning/--info/--danger` e recolore charts):

```css
:root {
    --background: oklch(0.99 0.004 277);
    --foreground: oklch(0.21 0.02 277);
    --card: oklch(1 0 0);
    --card-foreground: oklch(0.21 0.02 277);
    --popover: oklch(1 0 0);
    --popover-foreground: oklch(0.21 0.02 277);
    --primary: oklch(0.55 0.20 277);
    --primary-foreground: oklch(0.985 0.005 277);
    --secondary: oklch(0.96 0.008 277);
    --secondary-foreground: oklch(0.30 0.03 277);
    --muted: oklch(0.965 0.006 277);
    --muted-foreground: oklch(0.52 0.02 277);
    --accent: oklch(0.95 0.03 300);
    --accent-foreground: oklch(0.35 0.10 300);
    --destructive: oklch(0.58 0.22 25);
    --success: oklch(0.62 0.15 150);
    --success-foreground: oklch(0.99 0 0);
    --warning: oklch(0.72 0.16 75);
    --warning-foreground: oklch(0.21 0.02 75);
    --info: oklch(0.60 0.14 240);
    --info-foreground: oklch(0.99 0 0);
    --danger: oklch(0.58 0.22 25);
    --danger-foreground: oklch(0.99 0 0);
    --border: oklch(0.91 0.006 277);
    --input: oklch(0.91 0.006 277);
    --ring: oklch(0.55 0.20 277);
    --chart-1: oklch(0.55 0.20 277);
    --chart-2: oklch(0.58 0.21 300);
    --chart-3: oklch(0.70 0.12 190);
    --chart-4: oklch(0.76 0.15 75);
    --chart-5: oklch(0.63 0.20 12);
    --radius: 0.625rem;
    --sidebar: oklch(0.985 0.004 277);
    --sidebar-foreground: oklch(0.21 0.02 277);
    --sidebar-primary: oklch(0.55 0.20 277);
    --sidebar-primary-foreground: oklch(0.985 0.005 277);
    --sidebar-accent: oklch(0.95 0.03 300);
    --sidebar-accent-foreground: oklch(0.35 0.10 300);
    --sidebar-border: oklch(0.91 0.006 277);
    --sidebar-ring: oklch(0.55 0.20 277);
}

.dark {
    --background: oklch(0.165 0.012 277);
    --foreground: oklch(0.96 0.005 277);
    --card: oklch(0.205 0.014 277);
    --card-foreground: oklch(0.96 0.005 277);
    --popover: oklch(0.195 0.014 277);
    --popover-foreground: oklch(0.96 0.005 277);
    --primary: oklch(0.64 0.18 277);
    --primary-foreground: oklch(0.985 0.005 277);
    --secondary: oklch(0.26 0.015 277);
    --secondary-foreground: oklch(0.96 0.005 277);
    --muted: oklch(0.255 0.012 277);
    --muted-foreground: oklch(0.71 0.015 277);
    --accent: oklch(0.30 0.045 300);
    --accent-foreground: oklch(0.96 0.01 300);
    --destructive: oklch(0.68 0.19 25);
    --success: oklch(0.70 0.15 150);
    --success-foreground: oklch(0.16 0.02 150);
    --warning: oklch(0.80 0.15 75);
    --warning-foreground: oklch(0.16 0.02 75);
    --info: oklch(0.70 0.14 240);
    --info-foreground: oklch(0.16 0.02 240);
    --danger: oklch(0.68 0.19 25);
    --danger-foreground: oklch(0.99 0 0);
    --border: oklch(1 0 0 / 10%);
    --input: oklch(1 0 0 / 14%);
    --ring: oklch(0.64 0.18 277);
    --chart-1: oklch(0.64 0.18 277);
    --chart-2: oklch(0.62 0.21 300);
    --chart-3: oklch(0.72 0.12 190);
    --chart-4: oklch(0.80 0.15 75);
    --chart-5: oklch(0.68 0.20 12);
    --sidebar: oklch(0.205 0.014 277);
    --sidebar-foreground: oklch(0.96 0.005 277);
    --sidebar-primary: oklch(0.64 0.18 277);
    --sidebar-primary-foreground: oklch(0.985 0.005 277);
    --sidebar-accent: oklch(0.30 0.045 300);
    --sidebar-accent-foreground: oklch(0.96 0.01 300);
    --sidebar-border: oklch(1 0 0 / 10%);
    --sidebar-ring: oklch(0.64 0.18 277);
}
```

- [ ] **Step 2: Registrar os tokens semânticos no `@theme inline`**

No bloco `@theme inline { … }` (após a linha `--color-destructive: var(--destructive);`), adicione:

```css
    --color-success: var(--success);
    --color-success-foreground: var(--success-foreground);
    --color-warning: var(--warning);
    --color-warning-foreground: var(--warning-foreground);
    --color-info: var(--info);
    --color-info-foreground: var(--info-foreground);
    --color-danger: var(--danger);
    --color-danger-foreground: var(--danger-foreground);
    --color-destructive-foreground: var(--destructive-foreground);
```

E em `:root` adicione `--destructive-foreground: oklch(0.99 0 0);` e em `.dark` `--destructive-foreground: oklch(0.99 0 0);` (para `text-destructive-foreground` existir).

- [ ] **Step 3: Verificar build**

Run: `pnpm build`
Expected: build conclui sem erro (`✓ built`).

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "feat(redesign): paleta indigo/violeta + tokens semanticos (light/dark)"
```

---

## Task 2: Tokens de elevação/motion + escala tipográfica

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Adicionar shadow/motion no `@theme inline`**

Dentro do bloco `@theme inline { … }`, antes do fechamento `}`, adicione:

```css
    --shadow-xs: 0 1px 2px oklch(0 0 0 / 0.16);
    --shadow-sm: 0 1px 3px oklch(0 0 0 / 0.22), 0 1px 2px oklch(0 0 0 / 0.14);
    --shadow-md: 0 4px 12px oklch(0 0 0 / 0.26);
    --shadow-lg: 0 12px 32px oklch(0 0 0 / 0.32);
    --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
    --ease-emph: cubic-bezier(0.65, 0, 0.35, 1);
    --duration-fast: 120ms;
    --duration-base: 180ms;
    --duration-slow: 240ms;
```

- [ ] **Step 2: Adicionar escala tipográfica utilitária no `@layer base`**

No fim de `src/index.css`, dentro de (ou após) o `@layer base { … }` existente, adicione:

```css
@layer components {
  .text-display { font-size: 2.25rem; line-height: 1.1; font-weight: 600; letter-spacing: -0.02em; }
  .text-h1 { font-size: 1.5rem; line-height: 1.2; font-weight: 600; letter-spacing: -0.01em; }
  .text-h2 { font-size: 1.25rem; line-height: 1.3; font-weight: 600; letter-spacing: -0.01em; }
  .text-h3 { font-size: 1.0625rem; line-height: 1.4; font-weight: 600; }
  .text-caption { font-size: 0.75rem; line-height: 1.4; color: var(--muted-foreground); }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

- [ ] **Step 3: Verificar build**

Run: `pnpm build`
Expected: `✓ built` sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "feat(redesign): tokens de elevacao/motion + escala tipografica"
```

---

## Task 3: ThemeProvider + useTheme (TDD)

**Files:**
- Create: `src/components/theme-provider.tsx`
- Test: `tests/components/theme-provider.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

Crie `tests/components/theme-provider.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ThemeProvider, useTheme, getStoredTheme } from '@/components/theme-provider';

function Probe() {
  const { theme, toggle } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={toggle}>toggle</button>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('default é dark quando não há valor salvo', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('lê o tema salvo no localStorage', () => {
    localStorage.setItem('publiai-theme', 'light');
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('toggle alterna e persiste no localStorage', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    act(() => { screen.getByText('toggle').click(); });
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(localStorage.getItem('publiai-theme')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('getStoredTheme retorna dark por default e respeita valor salvo', () => {
    expect(getStoredTheme()).toBe('dark');
    localStorage.setItem('publiai-theme', 'light');
    expect(getStoredTheme()).toBe('light');
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm test -- tests/components/theme-provider.test.tsx`
Expected: FAIL (módulo `@/components/theme-provider` não existe).

- [ ] **Step 3: Implementar o ThemeProvider**

Crie `src/components/theme-provider.tsx`:

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'publiai-theme';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const value: ThemeContextValue = {
    theme,
    setTheme: setThemeState,
    toggle: () => setThemeState((p) => (p === 'dark' ? 'light' : 'dark')),
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme deve ser usado dentro de <ThemeProvider>');
  return ctx;
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm test -- tests/components/theme-provider.test.tsx`
Expected: PASS (4 testes verdes).

- [ ] **Step 5: Commit**

```bash
git add src/components/theme-provider.tsx tests/components/theme-provider.test.tsx
git commit -m "feat(redesign): ThemeProvider dark-padrao com persistencia (TDD)"
```

---

## Task 4: Anti-flash no index.html + montar ThemeProvider

**Files:**
- Modify: `index.html`
- Modify: `src/main.tsx`

- [ ] **Step 1: Script anti-flash no `<head>`**

Em `index.html`, dentro de `<head>` (após a tag `<title>`), adicione:

```html
    <script>
      (function () {
        try {
          var t = localStorage.getItem('publiai-theme');
          if (t !== 'light') document.documentElement.classList.add('dark');
        } catch (e) {
          document.documentElement.classList.add('dark');
        }
      })();
    </script>
```

- [ ] **Step 2: Envolver `<App/>` com `ThemeProvider` no main.tsx**

Em `src/main.tsx`, importe e use o provider. Substitua o bloco de render por:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ThemeProvider } from '@/components/theme-provider';
import { useAuthStore } from '@/stores/auth-store';
import './index.css';

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

useAuthStore.getState().hydrate();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
);
```

- [ ] **Step 3: Verificar build + tipos**

Run: `pnpm build`
Expected: `✓ built` sem erro de tipo.

- [ ] **Step 4: Commit**

```bash
git add index.html src/main.tsx
git commit -m "feat(redesign): monta ThemeProvider + script anti-flash (dark padrao)"
```

---

## Task 5: Adicionar primitivos shadcn faltantes + recharts

**Files:**
- Create (gerados): `src/components/ui/{table,tabs,tooltip,skeleton,sonner,switch,sheet,separator,avatar,scroll-area}.tsx`
- Modify: `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Adicionar os primitivos via CLI shadcn**

Run: `pnpm dlx shadcn@latest add table tabs tooltip skeleton sonner switch sheet separator avatar scroll-area --yes`
Expected: cria os 10 arquivos em `src/components/ui/`. (Se o CLI pedir confirmação de overwrite, responder não para os já existentes — nenhum destes 10 existe hoje.)

- [ ] **Step 2: Adicionar recharts**

Run: `pnpm add recharts`
Expected: recharts entra em `dependencies`.

- [ ] **Step 3: Verificar tipos + build**

Run: `pnpm build`
Expected: `✓ built`. Se algum primitivo gerar erro de import (ex.: `sonner` precisa do pacote `sonner`), rodar `pnpm add sonner` e buildar de novo.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui package.json pnpm-lock.yaml
git commit -m "feat(redesign): primitivos shadcn (table/tabs/tooltip/skeleton/sonner/switch/sheet/separator/avatar/scroll-area) + recharts"
```

---

## Task 6: Componentes reutilizáveis (PageHeader, Section, EmptyState, StatusPill, KpiCard, DataTable)

**Files:**
- Create: `src/components/ui/page-header.tsx`, `src/components/ui/section.tsx`, `src/components/ui/empty-state.tsx`, `src/components/ui/status-pill.tsx`, `src/components/ui/kpi-card.tsx`, `src/components/ui/data-table.tsx`
- Test: `tests/components/ui-components.test.tsx`

- [ ] **Step 1: PageHeader**

Crie `src/components/ui/page-header.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-6 flex items-start justify-between gap-4', className)}>
      <div className="space-y-1">
        <h1 className="text-h1">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Section**

Crie `src/components/ui/section.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SectionProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Section({ title, description, actions, children, className }: SectionProps) {
  return (
    <section className={cn('space-y-3', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-4">
          <div>
            {title && <h2 className="text-h3">{title}</h2>}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
```

- [ ] **Step 3: EmptyState**

Crie `src/components/ui/empty-state.tsx`:

```tsx
import type { ReactNode, ComponentType } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-lg border border-dashed p-10 text-center', className)}>
      {Icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
```

- [ ] **Step 4: StatusPill**

Crie `src/components/ui/status-pill.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_CLASSES: Record<StatusTone, string> = {
  success: 'bg-success/10 text-success border-success/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  danger: 'bg-danger/10 text-danger border-danger/20',
  info: 'bg-info/10 text-info border-info/20',
  neutral: 'bg-muted text-muted-foreground border-border',
};

interface StatusPillProps {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
}

export function StatusPill({ tone = 'neutral', children, className }: StatusPillProps) {
  return (
    <span
      data-tone={tone}
      className={cn('inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', TONE_CLASSES[tone], className)}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 5: KpiCard**

Crie `src/components/ui/kpi-card.tsx`:

```tsx
import type { ComponentType } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export type DeltaTrend = 'up' | 'down' | 'neutral';

interface KpiCardProps {
  label: string;
  value: string | number;
  icon?: ComponentType<{ className?: string }>;
  delta?: string;
  deltaTrend?: DeltaTrend;
  hint?: string;
  loading?: boolean;
  className?: string;
}

export function KpiCard({ label, value, icon: Icon, delta, deltaTrend = 'neutral', hint, loading, className }: KpiCardProps) {
  if (loading) {
    return (
      <Card className={cn('p-4', className)}>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-8 w-20" />
      </Card>
    );
  }
  const trendCls =
    deltaTrend === 'up' ? 'text-success' : deltaTrend === 'down' ? 'text-destructive' : 'text-muted-foreground';
  const TrendIcon = deltaTrend === 'up' ? ArrowUp : deltaTrend === 'down' ? ArrowDown : null;
  return (
    <Card className={cn('p-4', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {(delta || hint) && (
        <div className="mt-1 flex items-center gap-1 text-xs">
          {delta && (
            <span className={cn('inline-flex items-center gap-0.5 font-medium', trendCls)}>
              {TrendIcon && <TrendIcon className="h-3 w-3" />}
              {delta}
            </span>
          )}
          {hint && <span className="text-muted-foreground">{hint}</span>}
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 6: DataTable**

Crie `src/components/ui/data-table.tsx`:

```tsx
import type { ReactNode } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: ReactNode;
  skeletonRows?: number;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  skeletonRows = 5,
  className,
}: DataTableProps<T>) {
  return (
    <div className={cn('overflow-x-auto rounded-lg border', className)}>
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur">
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.key} className={c.className}>{c.header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: skeletonRows }).map((_, i) => (
              <TableRow key={`sk-${i}`}>
                {columns.map((c) => (
                  <TableCell key={c.key}><Skeleton className="h-4 w-full" /></TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="p-0">
                {empty ?? (
                  <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                    Nenhum resultado.
                  </div>
                )}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={rowKey(row)}>
                {columns.map((c) => (
                  <TableCell key={c.key} className={c.className}>{c.cell(row)}</TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 7: Testes de fumaça dos componentes**

Crie `tests/components/ui-components.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusPill } from '@/components/ui/status-pill';
import { KpiCard } from '@/components/ui/kpi-card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';

describe('StatusPill', () => {
  it('aplica o tom via data-tone', () => {
    render(<StatusPill tone="success">Ativo</StatusPill>);
    expect(screen.getByText('Ativo').getAttribute('data-tone')).toBe('success');
  });
});

describe('KpiCard', () => {
  it('mostra label, valor e delta', () => {
    render(<KpiCard label="Publicados" value={42} delta="+3" deltaTrend="up" />);
    expect(screen.getByText('Publicados')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('+3')).toBeInTheDocument();
  });

  it('mostra skeleton quando loading', () => {
    const { container } = render(<KpiCard label="x" value={0} loading />);
    expect(container.querySelector('[data-slot="skeleton"]')).toBeTruthy();
  });
});

interface Linha { id: string; nome: string }
const cols: Column<Linha>[] = [
  { key: 'nome', header: 'Nome', cell: (r) => r.nome },
];

describe('DataTable', () => {
  it('renderiza linhas', () => {
    render(<DataTable columns={cols} rows={[{ id: '1', nome: 'Fita' }]} rowKey={(r) => r.id} />);
    expect(screen.getByText('Fita')).toBeInTheDocument();
  });

  it('mostra empty quando sem linhas', () => {
    render(<DataTable columns={cols} rows={[]} rowKey={(r) => r.id} empty={<EmptyState title="Vazio" />} />);
    expect(screen.getByText('Vazio')).toBeInTheDocument();
  });

  it('mostra skeleton quando loading', () => {
    const { container } = render(<DataTable columns={cols} rows={[]} rowKey={(r) => r.id} loading skeletonRows={3} />);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(3);
  });
});
```

> Nota: o teste usa `[data-slot="skeleton"]`. Confirme no arquivo gerado `src/components/ui/skeleton.tsx` que o elemento tem `data-slot="skeleton"` (padrão shadcn radix-nova). Se o atributo for outro, ajuste o seletor do teste para casar com o arquivo real.

- [ ] **Step 8: Rodar os testes**

Run: `pnpm test -- tests/components/ui-components.test.tsx`
Expected: PASS (todos verdes). Se o seletor de skeleton falhar, ajustar conforme a nota acima e rodar de novo.

- [ ] **Step 9: Verificar build**

Run: `pnpm build`
Expected: `✓ built`.

- [ ] **Step 10: Commit**

```bash
git add src/components/ui/page-header.tsx src/components/ui/section.tsx src/components/ui/empty-state.tsx src/components/ui/status-pill.tsx src/components/ui/kpi-card.tsx src/components/ui/data-table.tsx tests/components/ui-components.test.tsx
git commit -m "feat(redesign): componentes reutilizaveis (PageHeader/Section/EmptyState/StatusPill/KpiCard/DataTable)"
```

---

## Task 7: Rota /style-guide (validação + doc viva)

**Files:**
- Create: `src/pages/StyleGuide.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Página StyleGuide**

Crie `src/pages/StyleGuide.tsx`:

```tsx
import { Boxes, Inbox, Package, TrendingUp } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/ui/page-header';
import { Section } from '@/components/ui/section';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { KpiCard } from '@/components/ui/kpi-card';
import { DataTable, type Column } from '@/components/ui/data-table';

const TOKENS = ['background', 'card', 'primary', 'secondary', 'muted', 'accent', 'border'] as const;
const SEMANTIC = ['success', 'warning', 'info', 'danger'] as const;
const TONES: StatusTone[] = ['success', 'warning', 'danger', 'info', 'neutral'];

interface Row { id: string; nome: string; status: StatusTone }
const ROWS: Row[] = [
  { id: '1', nome: 'Fita Cetim N.3', status: 'success' },
  { id: '2', nome: 'Linha Setta XIK', status: 'warning' },
];
const COLS: Column<Row>[] = [
  { key: 'nome', header: 'Produto', cell: (r) => r.nome },
  { key: 'status', header: 'Status', cell: (r) => <StatusPill tone={r.status}>{r.status}</StatusPill> },
];

export default function StyleGuide() {
  const { theme, toggle } = useTheme();
  return (
    <div className="space-y-8 p-6">
      <PageHeader
        title="Design System — PubliAI"
        subtitle="Tokens, primitivos e componentes. Tema atual: {theme}."
        actions={
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Dark</span>
            <Switch checked={theme === 'light'} onCheckedChange={toggle} />
            <span className="text-muted-foreground">Light</span>
          </div>
        }
      />

      <Section title="Cores — superfícies">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {TOKENS.map((t) => (
            <div key={t} className="space-y-1">
              <div className={`h-14 rounded-md border bg-${t}`} />
              <p className="text-caption">{t}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Cores — semânticas">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SEMANTIC.map((t) => (
            <div key={t} className="space-y-1">
              <div className={`flex h-14 items-center justify-center rounded-md bg-${t} text-${t}-foreground text-sm font-medium`}>{t}</div>
              <p className="text-caption">{t}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Tipografia">
        <div className="space-y-1">
          <p className="text-display">Display 2.25rem</p>
          <p className="text-h1">Heading 1</p>
          <p className="text-h2">Heading 2</p>
          <p className="text-h3">Heading 3</p>
          <p className="text-sm">Body — texto corrido padrão.</p>
          <p className="text-caption">Caption — informação secundária.</p>
        </div>
      </Section>

      <Section title="KPIs">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Processados" value={128} icon={Boxes} />
          <KpiCard label="Publicados" value={42} icon={Package} delta="+3" deltaTrend="up" hint="vs. ontem" />
          <KpiCard label="Aguardando" value={9} icon={Inbox} />
          <KpiCard label="Receita potencial" value="R$ 12.430" icon={TrendingUp} loading />
        </div>
      </Section>

      <Section title="Botões & inputs">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primário</Button>
          <Button variant="secondary">Secundário</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destrutivo</Button>
          <Button disabled>Desabilitado</Button>
          <Input placeholder="Input…" className="w-48" />
          <Badge>Badge</Badge>
        </div>
      </Section>

      <Section title="Status pills">
        <div className="flex flex-wrap gap-2">
          {TONES.map((tone) => (
            <StatusPill key={tone} tone={tone}>{tone}</StatusPill>
          ))}
        </div>
      </Section>

      <Section title="Tabela (DataTable)">
        <DataTable columns={COLS} rows={ROWS} rowKey={(r) => r.id} />
      </Section>

      <Section title="DataTable — loading & empty">
        <div className="grid gap-4 lg:grid-cols-2">
          <DataTable columns={COLS} rows={[]} rowKey={(r) => r.id} loading skeletonRows={3} />
          <DataTable columns={COLS} rows={[]} rowKey={(r) => r.id} empty={<EmptyState icon={Inbox} title="Nada por aqui" description="Quando houver dados, eles aparecem nesta tabela." />} />
        </div>
      </Section>

      <Section title="Elevação">
        <div className="flex flex-wrap gap-4">
          {(['shadow-xs', 'shadow-sm', 'shadow-md', 'shadow-lg'] as const).map((s) => (
            <Card key={s} className={`flex h-20 w-32 items-center justify-center ${s}`}>{s}</Card>
          ))}
        </div>
      </Section>

      <Section title="Skeleton">
        <div className="space-y-2">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
      </Section>
    </div>
  );
}
```

> Nota sobre classes dinâmicas: `bg-${t}` é interpolação. No Tailwind v4 com tokens registrados no `@theme inline`, essas classes existem como utilitários estáticos (`bg-primary`, `bg-success`, etc.), mas o JIT pode não detectá-las por serem montadas em runtime. Se algum swatch sair sem cor, troque o mapa para classes literais (objeto `Record<token, 'bg-primary'|…>`) em vez de template string. Validar visualmente no Step 4.

- [ ] **Step 2: Registrar a rota**

Em `src/App.tsx`, importe a página e adicione a rota dentro do bloco `<Route element={<AppShell />}>`:

```tsx
import StyleGuide from '@/pages/StyleGuide';
```

E, junto às outras rotas internas (após a linha de `/publicados`):

```tsx
          <Route path="/style-guide" element={<StyleGuide />} />
```

- [ ] **Step 3: Verificar build + tipos**

Run: `pnpm build`
Expected: `✓ built` sem erro.

- [ ] **Step 4: Validar visualmente (dev server)**

Run: `pnpm dev` (background) e abrir `http://localhost:5173/#/style-guide`.
Expected: a página renderiza; o switch alterna dark/light; todos os swatches mostram cor (corrigir classes dinâmicas se necessário, ver nota). Capturar screenshot dark e light. Encerrar o dev server.

- [ ] **Step 5: Commit**

```bash
git add src/pages/StyleGuide.tsx src/App.tsx
git commit -m "feat(redesign): rota /style-guide (validacao do design system)"
```

---

## Task 8: Documentação do Design System + verificação final

**Files:**
- Create: `docs/design-system/README.md`

- [ ] **Step 1: Escrever o guia do DS**

Crie `docs/design-system/README.md` documentando: paleta (tokens light/dark com hue 277/300), tokens semânticos (`success/warning/info/danger` + uso `bg-success/10 text-success`), escala tipográfica (`text-display/h1/h2/h3/caption`), elevação (`shadow-xs…lg`), motion (`--ease-out`, durações), tema (dark padrão, `localStorage publiai-theme`, `useTheme()`), e os componentes reutilizáveis (`PageHeader`, `Section`, `EmptyState`, `StatusPill`, `KpiCard`, `DataTable`) com um exemplo de uso de cada e link para `/#/style-guide`. Incluir nota "fonte da verdade = `src/index.css` + `/style-guide`".

- [ ] **Step 2: Verificação final completa**

Run: `pnpm test`
Expected: todos os testes verdes (321 antigos + 4 do ThemeProvider + ~6 dos componentes).

Run: `pnpm exec tsc --noEmit`
Expected: sem erros.

Run: `pnpm lint`
Expected: 0 errors (warnings pré-existentes do shadcn são aceitáveis).

Run: `pnpm build`
Expected: `✓ built`.

- [ ] **Step 3: Commit**

```bash
git add docs/design-system/README.md
git commit -m "docs(redesign): guia do Design System PubliAI (Fase 1)"
```

---

## Self-Review (cobertura do spec)

- **A. Tokens de cor + semânticos** → Task 1. ✓
- **B. Modo de tema (dark padrão, toggle, anti-flash, persistência)** → Tasks 3 + 4. ✓
- **C. Tipografia** → Task 2 (Step 2). ✓
- **D. Elevação/radius/motion** → Task 2 (Step 1; radius já existe). ✓
- **E. Primitivos shadcn + recharts** → Task 5. ✓
- **F. Componentes reutilizáveis** → Task 6. ✓
- **G. /style-guide** → Task 7. ✓
- **Doc do DS** → Task 8. ✓
- **Não-regressão (321 testes, tsc/lint/build)** → Task 8 (Step 2). ✓
- **A11y (foco, reduced-motion, contraste)** → reduced-motion na Task 2; foco/contraste herdados dos tokens (`--ring` indigo) e validados no /style-guide.

**Consistência de tipos:** `Theme`, `getStoredTheme`, `useTheme` (Task 3) usados na Task 7. `StatusTone`/`Column<T>`/`DeltaTrend` definidos na Task 6 e usados na Task 7. ✓

**Riscos sinalizados (não placeholders):** (1) classes dinâmicas `bg-${token}` no style-guide — nota com correção; (2) `data-slot="skeleton"` no teste — nota para casar com o arquivo gerado; (3) `sonner` pode exigir `pnpm add sonner` — coberto na Task 5 Step 3.
