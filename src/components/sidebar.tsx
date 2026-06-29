import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Layers, ListChecks, Settings, Package, Scale, Wallet, Receipt, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/ui/logo';
import { useProfile } from '@/hooks/useProfile';
import { visibleMenus, type MenuKey } from '@/lib/menus';

export const NAV_ITEMS: { to: string; label: string; icon: typeof LayoutDashboard; end: boolean; key: MenuKey }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, key: 'dashboard' },
  { to: '/lotes', label: 'Lotes', icon: Layers, end: false, key: 'lotes' },
  { to: '/revisao', label: 'Revisão', icon: ListChecks, end: false, key: 'revisao' },
  { to: '/publicados', label: 'Publicados', icon: Package, end: false, key: 'publicados' },
  { to: '/faturamento', label: 'Faturamento', icon: Receipt, end: false, key: 'faturamento' },
  { to: '/financeiro', label: 'Financeiro', icon: Wallet, end: false, key: 'financeiro' },
  { to: '/viabilidade', label: 'Viabilidade', icon: Scale, end: false, key: 'viabilidade' },
  { to: '/configuracoes', label: 'Configurações', icon: Settings, end: false, key: 'configuracoes' },
  { to: '/usuarios', label: 'Usuários', icon: Users, end: false, key: 'usuarios' },
];

export function BrandMark() {
  return <Logo />;
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { profile } = useProfile();
  const allowed = new Set(visibleMenus(profile ?? { is_admin: false, is_active: true, allowed_menus: [] }));
  return (
    <nav className="flex flex-1 flex-col gap-0.5 px-2 py-3">
      {NAV_ITEMS.filter((item) => allowed.has(item.key)).map(({ to, label, icon: Icon, end }) => (
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
