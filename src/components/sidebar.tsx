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
