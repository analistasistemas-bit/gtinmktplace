import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useProfile } from '@/hooks/useProfile';
import { visibleMenus, menuKeyForPath, pathForMenu } from '@/lib/menus';

export function MenuGuard() {
  const { profile, profileLoading } = useProfile();
  const location = useLocation();

  if (profileLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  const menus = visibleMenus(profile ?? { is_admin: false, is_active: true, allowed_menus: [] });
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
