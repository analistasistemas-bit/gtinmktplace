import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Layers, ListChecks, Settings, Package, Scale, Wallet, Receipt, Plug, Boxes, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/ui/logo';
import { useProfile } from '@/hooks/useProfile';
import { visibleMenus, type MenuKey } from '@/lib/menus';
import { menusDeModulosDesabilitados } from '@/lib/modulos';
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { usePrefetchEstoque } from '@/hooks/usePrefetchEstoque';
import { useSupportStore } from '@/stores/support-store';
import { useQuery } from '@tanstack/react-query';
import { GlowEffect } from '@/components/ui/glow-effect';
import { contarPulseAlertas } from '@/lib/pulse-contagem';
import { QK } from '@/lib/queries';

export const NAV_ITEMS: { to: string; label: string; icon: typeof LayoutDashboard; end: boolean; key: MenuKey }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, key: 'dashboard' },
  { to: '/lotes', label: 'Lotes', icon: Layers, end: false, key: 'lotes' },
  { to: '/revisao', label: 'Revisão', icon: ListChecks, end: false, key: 'revisao' },
  { to: '/publicados', label: 'Publicados', icon: Package, end: false, key: 'publicados' },
  { to: '/estoque', label: 'Estoque', icon: Boxes, end: false, key: 'estoque' },
  { to: '/pulse', label: 'Pulse', icon: Activity, end: false, key: 'pulse' },
  { to: '/faturamento', label: 'Faturamento', icon: Receipt, end: false, key: 'faturamento' },
  { to: '/financeiro', label: 'Financeiro', icon: Wallet, end: false, key: 'financeiro' },
  { to: '/viabilidade', label: 'Viabilidade', icon: Scale, end: false, key: 'viabilidade' },
  { to: '/canais', label: 'Canais', icon: Plug, end: false, key: 'canais' },
  { to: '/configuracoes', label: 'Configurações', icon: Settings, end: false, key: 'configuracoes' },
];

export function BrandMark() {
  return <Logo />;
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { profile } = useProfile();
  const context = useSupportStore((state) => state.context);
  const { data: modulos, isLoading: modulosLoading } = useModulosHabilitados();
  const { prefetchEstoque } = usePrefetchEstoque();
  const pulseHabilitado = !!modulos?.includes('pulse');
  const allowed = new Set(visibleMenus(profile ?? { is_admin: false, is_active: true, allowed_menus: [] }, !!context));
  // Módulo desligado (ou ainda carregando) → menu some. Falha fechada durante o carregamento:
  // mostrar e sumir é pior que aparecer um instante depois. Mas se a RPC falhou na 1ª carga da
  // sessão, `modulos` fica `undefined` sem estar carregando — aí não dá pra saber se o módulo
  // está habilitado, e "não sei" não pode virar "sei que não tem" (ADR-0153 D5): pula o filtro e
  // deixa o menu visível, quem barra de verdade é a edge (ADR-0047).
  if (modulosLoading || modulos !== undefined) {
    for (const m of menusDeModulosDesabilitados(modulos ?? [])) allowed.delete(m);
  }
  // Quem não vê o menu Pulse não paga a query do badge — não é hook, então não afeta a ordem.
  const { data: alertasPulse = 0 } = useQuery({
    queryKey: QK.pulseAlertasContagem('acao'),
    queryFn: () => contarPulseAlertas('acao'),
    enabled: pulseHabilitado && allowed.has('pulse'),
    staleTime: 30_000,
  });
  return (
    <nav className="flex flex-1 flex-col gap-0.5 px-2 py-3">
      {NAV_ITEMS.filter((item) => allowed.has(item.key)).map(({ to, label, icon: Icon, end, key }) => (
        // Glow só no Pulse: aura permanente marca o módulo, e a versão forte diz que há alerta
        // esperando. Item comum passa reto pelo wrapper, sem aura.
        <GlowEffect
          key={to}
          ativo={key === 'pulse'}
          forte={key === 'pulse' && alertasPulse > 0}
          radius={6}
        >
          <NavLink
            to={to}
            end={end}
            onClick={onNavigate}
            onMouseEnter={key === 'estoque' ? prefetchEstoque : undefined}
            onFocus={key === 'estoque' ? prefetchEstoque : undefined}
            className={({ isActive }) => cn(
              'relative z-[2] flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
              key === 'pulse' && 'tracking-[0.01em]',
              isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
            )}
          >
            <Icon className={cn('h-4 w-4 shrink-0', key === 'pulse' && 'text-primary')} />
            <span>{label}</span>
            {key === 'pulse' && alertasPulse > 0 && (
              <span
                aria-label={`${alertasPulse} alertas de ação`}
                className="ml-auto min-w-5 rounded-full bg-primary/12 px-1.5 py-0.5 text-center text-[10px] font-semibold leading-none text-primary"
              >
                {alertasPulse > 99 ? '99+' : alertasPulse}
              </span>
            )}
          </NavLink>
        </GlowEffect>
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
