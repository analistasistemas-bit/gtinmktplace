import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useProfile } from '@/hooks/useProfile';
import { visibleMenus, menuKeyForPath, pathForMenu } from '@/lib/menus';
import { menusDeModulosDesabilitados } from '@/lib/modulos';
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { useSupportStore } from '@/stores/support-store';

export function MenuGuard() {
  const { profile, profileLoading } = useProfile();
  const location = useLocation();
  const context = useSupportStore((state) => state.context);
  // Diferente da sidebar (onde "carregando" esconde o menu), aqui é preciso ESPERAR:
  // redirecionar antes da resposta chegar tiraria o operador de um deep-link válido.
  const { data: modulos, isLoading: modulosLoading } = useModulosHabilitados();

  if (profileLoading || modulosLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  const escondidos = new Set(menusDeModulosDesabilitados(modulos ?? []));
  const menus = visibleMenus(profile ?? { is_admin: false, is_active: true, allowed_menus: [] }, !!context)
    .filter((m) => !escondidos.has(m));
  const key = menuKeyForPath(location.pathname);

  // Rota sem menu mapeado (ex.: /style-guide) → libera.
  if (key === null) return <Outlet />;

  if (!menus.includes(key)) {
    return menus.length > 0
      ? <Navigate to={pathForMenu(menus[0])} replace />
      : <Navigate to="/sem-acesso" replace />;
  }

  return <Outlet />;
}
