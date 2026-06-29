import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { supabase } from '@/lib/supabase';

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const { profile, profileLoading } = useProfile();
  const location = useLocation();

  const desativada = !!profile && profile.is_active === false;
  useEffect(() => {
    if (desativada) void supabase.auth.signOut();
  }, [desativada]);

  if (loading || (user && profileLoading)) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Conta desativada: a sessão é derrubada no efeito acima.
  if (desativada) {
    return <Navigate to="/login" replace state={{ desativada: true }} />;
  }

  return <Outlet />;
}
