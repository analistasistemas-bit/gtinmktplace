import { Outlet } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';
import { Toaster } from '@/components/ui/sonner';

// Layout do painel de plataforma (super-admin), deliberadamente distinto da operação de uma
// empresa: sem a sidebar de operação e com header escuro/âmbar, para deixar claro que você
// saiu do contexto de uma organização e está na visão global do SaaS (D-E7.8).
export function AdminShell() {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-amber-500/30 bg-zinc-900 px-4 text-zinc-100">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-amber-400" />
          <span className="text-sm font-semibold">Daludi · Administração da plataforma</span>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <UserMenu />
        </div>
      </header>
      <main className="flex-1 overflow-y-auto overflow-x-hidden bg-muted/30">
        <Outlet />
      </main>
      <Toaster />
    </div>
  );
}
