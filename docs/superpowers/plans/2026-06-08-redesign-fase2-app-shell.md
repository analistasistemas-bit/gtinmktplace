# Redesign PubliAI — Fase 2 (App Shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps usam checkbox.

**Goal:** App shell premium e responsivo: sidebar com marca + nav indigo, topbar com toggle de tema e menu de usuário (e-mail real), drawer mobile (Sheet), Toaster montado. Zero mudança em páginas/rotas/lógica.

**Architecture:** Extrai `NAV_ITEMS`/`SidebarNav`/`BrandMark` de `sidebar.tsx` (reuso desktop + drawer). Novos `theme-toggle.tsx` e `user-menu.tsx`. `topbar.tsx` reescrito (hambúrguer mobile + toggle + user menu). `app-shell.tsx` compõe tudo + `<Sheet>` mobile com estado + `<Toaster/>`.

**Tech Stack:** React+TS, react-router (HashRouter), shadcn (sheet/dropdown-menu/avatar/button), lucide, `useTheme` (Fase 1), `useAuth`/`signOut`. Branch: `feat/redesign-publiai`.

**Spec:** `docs/superpowers/specs/2026-06-08-redesign-fase2-app-shell-design.md`

---

## Task 1: theme-toggle.tsx + user-menu.tsx

**Files:** Create `src/components/theme-toggle.tsx`, `src/components/user-menu.tsx`

- [ ] **Step 1: ThemeToggle**

```tsx
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme-provider';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}
      title={isDark ? 'Tema claro' : 'Tema escuro'}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
```

> Se `size="icon"` não existir no `button.tsx` gerado, use o nome de tamanho de ícone que existir (ex.: `icon-sm`). Verifique `src/components/ui/button.tsx`.

- [ ] **Step 2: UserMenu**

```tsx
import { LogOut } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { signOut } from '@/lib/auth';

function iniciais(email: string | undefined): string {
  if (!email) return '?';
  return email.split('@')[0].slice(0, 2).toUpperCase();
}

export function UserMenu() {
  const { user } = useAuth();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Menu do usuário">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="text-xs">{iniciais(user?.email)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
          {user?.email ?? 'Sessão'}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut()}>
          <LogOut className="mr-2 h-4 w-4" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 3: build**

Run: `pnpm build` → `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add src/components/theme-toggle.tsx src/components/user-menu.tsx
git commit -m "feat(redesign): ThemeToggle + UserMenu (topbar)"
```

---

## Task 2: Refatorar sidebar.tsx (NAV_ITEMS/SidebarNav/BrandMark + marca)

**Files:** Modify `src/components/sidebar.tsx`

- [ ] **Step 1: Reescrever o arquivo**

Substitua TODO o conteúdo de `src/components/sidebar.tsx` por:

```tsx
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Upload, ListChecks, Settings, Package, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/novo-lote', label: 'Novo lote', icon: Upload, end: false },
  { to: '/revisao', label: 'Revisão', icon: ListChecks, end: false },
  { to: '/publicados', label: 'Publicados', icon: Package, end: false },
  { to: '/configuracoes', label: 'Configurações', icon: Settings, end: false },
];

export function BrandMark() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Sparkles className="h-4 w-4" />
      </div>
      <span className="text-base font-semibold tracking-tight">PubliAI</span>
    </div>
  );
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-0.5 px-2 py-3">
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
            )
          }
        >
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="flex h-screen w-[220px] flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-14 items-center border-b border-sidebar-border px-4">
        <BrandMark />
      </div>
      <SidebarNav />
    </aside>
  );
}
```

- [ ] **Step 2: build**

Run: `pnpm build` → `✓ built`.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar.tsx
git commit -m "feat(redesign): sidebar com marca + nav indigo + SidebarNav reutilizavel"
```

---

## Task 3: Reescrever topbar.tsx

**Files:** Modify `src/components/topbar.tsx`

- [ ] **Step 1: Reescrever o arquivo**

Substitua TODO o conteúdo de `src/components/topbar.tsx` por:

```tsx
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';
import { BrandMark } from '@/components/sidebar';

export function Topbar({ onOpenMobile }: { onOpenMobile: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b bg-background/80 px-4 backdrop-blur">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onOpenMobile}
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <div className="lg:hidden">
          <BrandMark />
        </div>
      </div>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
```

- [ ] **Step 2: build** → `pnpm build` → `✓ built`.

- [ ] **Step 3: Commit**

```bash
git add src/components/topbar.tsx
git commit -m "feat(redesign): topbar com hamburguer mobile + toggle de tema + menu de usuario"
```

---

## Task 4: Compor o AppShell (Toaster + Sheet mobile)

**Files:** Modify `src/components/app-shell.tsx`

- [ ] **Step 1: Reescrever o arquivo**

Substitua TODO o conteúdo de `src/components/app-shell.tsx` por:

```tsx
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar, SidebarNav, BrandMark } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { Toaster } from '@/components/ui/sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="flex h-screen overflow-hidden">
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar onOpenMobile={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-auto bg-muted/30">
          <Outlet />
        </main>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[260px] p-0">
          <SheetHeader className="h-14 flex-row items-center border-b px-4">
            <SheetTitle className="flex items-center"><BrandMark /></SheetTitle>
          </SheetHeader>
          <SidebarNav onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <Toaster />
    </div>
  );
}
```

> Verifique no `src/components/ui/sheet.tsx` gerado se `SheetContent` aceita a prop `side="left"` (padrão shadcn). Se a API diferir, ajuste para abrir pela esquerda conforme o componente real. `SheetTitle` é obrigatório para a11y do Radix (não remover).

- [ ] **Step 2: build + tsc** → `pnpm build` (`✓ built`) e `pnpm exec tsc --noEmit` (sem erros).

- [ ] **Step 3: Commit**

```bash
git add src/components/app-shell.tsx
git commit -m "feat(redesign): AppShell responsivo (sidebar desktop + topbar + drawer mobile + Toaster)"
```

---

## Task 5: Testes de fumaça + verificação final

**Files:** Create `tests/components/shell.test.tsx`

- [ ] **Step 1: Testes**

Crie `tests/components/shell.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { SidebarNav } from '@/components/sidebar';

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('alterna o tema ao clicar (dark -> light)', () => {
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
    const btn = screen.getByRole('button', { name: /tema claro/i }); // default dark
    fireEvent.click(btn);
    expect(localStorage.getItem('publiai-theme')).toBe('light');
  });
});

describe('SidebarNav', () => {
  it('renderiza os 5 links com hrefs corretos', () => {
    render(<MemoryRouter><SidebarNav /></MemoryRouter>);
    expect(screen.getAllByRole('link')).toHaveLength(5);
    expect(screen.getByRole('link', { name: /Dashboard/i }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: /Publicados/i }).getAttribute('href')).toBe('/publicados');
  });
});
```

- [ ] **Step 2: rodar os testes novos**

Run: `pnpm test -- tests/components/shell.test.tsx`
Expected: PASS.

- [ ] **Step 3: verificação final**

Run: `pnpm test` → todos verdes (331 + 3 novos = ~334).
Run: `pnpm exec tsc --noEmit` → sem erros.
Run: `pnpm lint` → 0 errors.
Run: `pnpm build` → `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add tests/components/shell.test.tsx
git commit -m "test(redesign): smoke tests do shell (ThemeToggle + SidebarNav)"
```

---

## Self-Review (cobertura do spec)

- **A. Sidebar premium** → Task 2. ✓
- **B. Topbar (toggle + user menu, e-mail real)** → Tasks 1 + 3. ✓
- **C. Responsivo / drawer mobile** → Task 4 (Sheet + estado). ✓
- **D. Toaster** → Task 4. ✓
- **E-mail hardcoded removido** → Task 2 (sidebar sem rodapé hardcoded) + UserMenu mostra `user.email`. ✓
- **Zero mudança em páginas/rotas/lógica** → só `app-shell/sidebar/topbar` + 2 componentes novos; `App.tsx` intocado. ✓
- **Testes** → Task 5. ✓

**Consistência de tipos:** `BrandMark`/`SidebarNav`/`NAV_ITEMS` exportados na Task 2 e usados nas Tasks 3/4. `Topbar` recebe `onOpenMobile` (Task 3) passado pelo AppShell (Task 4). ✓

**Riscos sinalizados:** (1) `size="icon"` no Button — nota na Task 1; (2) `SheetContent side="left"` — nota na Task 4.
