import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Upload, ListChecks, Settings, Package } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/novo-lote', label: 'Novo lote', icon: Upload, end: false },
  { to: '/revisao', label: 'Revisão', icon: ListChecks, end: false },
  { to: '/publicados', label: 'Publicados', icon: Package, end: false },
  { to: '/configuracoes', label: 'Configurações', icon: Settings, end: false },
];

export function Sidebar() {
  return (
    <aside className="flex h-screen w-[180px] flex-col border-r bg-background">
      <div className="flex h-11 items-center px-4 font-semibold">PubliAI</div>
      <nav className="flex-1 px-2 py-2">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t px-4 py-3 text-xs text-muted-foreground">diego@empresa</div>
    </aside>
  );
}
