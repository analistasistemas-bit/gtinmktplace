import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Layers, ListChecks, Settings, Package, Scale, Wallet, Receipt } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/ui/logo';

export const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/lotes', label: 'Lotes', icon: Layers, end: false },
  { to: '/revisao', label: 'Revisão', icon: ListChecks, end: false },
  { to: '/publicados', label: 'Publicados', icon: Package, end: false },
  { to: '/faturamento', label: 'Faturamento', icon: Receipt, end: false },
  { to: '/financeiro', label: 'Financeiro', icon: Wallet, end: false },
  { to: '/viabilidade', label: 'Viabilidade', icon: Scale, end: false },
  { to: '/configuracoes', label: 'Configurações', icon: Settings, end: false },
];

export function BrandMark() {
  return <Logo />;
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
