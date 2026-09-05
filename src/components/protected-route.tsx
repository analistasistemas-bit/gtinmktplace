import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const { profile, profileLoading, profileOffline } = useProfile();
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

  // Perfil nunca carregou por falha de rede (cold start offline, ADR-0153 D5). Sem este corte,
  // profile: null desceria até o MenuGuard, que trata "sem perfil" como "sem permissão" e manda
  // para /sem-acesso — offline não é falta de acesso.
  if (!profile && profileOffline) {
    return (
      <div className="flex h-screen items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-sm p-6 text-center">
          <h1 className="mb-2 text-h1">Sem conexão</h1>
          <p className="mb-4 text-sm text-muted-foreground">
            Não foi possível carregar seu perfil. Verifique a conexão e tente novamente.
          </p>
          <Button variant="outline" onClick={() => void useAuthStore.getState().loadProfile(user.id)}>
            Tentar novamente
          </Button>
        </Card>
      </div>
    );
  }

  // Conta desativada: a sessão é derrubada no efeito acima.
  if (desativada) {
    return <Navigate to="/login" replace state={{ desativada: true }} />;
  }

  return <Outlet />;
}
