import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useProfile } from '@/hooks/useProfile';
import { useSupportStore } from '@/stores/support-store';

export function SupportRoute() {
  const { profile, profileLoading } = useProfile();
  const { context, loaded, loading, error, loadContext } = useSupportStore();
  const needsSupportContext = profile?.is_super_admin && !profile.org_id;

  useEffect(() => {
    if (needsSupportContext && !loaded && !loading) void loadContext();
  }, [needsSupportContext, loaded, loading, loadContext]);

  if (profileLoading || (needsSupportContext && (!loaded || loading))) {
    return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  }

  if (needsSupportContext && error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-sm text-muted-foreground" role="alert">
        <span>{error}</span>
        <button type="button" className="rounded-md border px-3 py-1.5 text-foreground" onClick={() => void loadContext()}>
          Tentar novamente
        </button>
      </div>
    );
  }

  return profile?.org_id || context ? <Outlet /> : <Navigate to="/admin" replace />;
}
