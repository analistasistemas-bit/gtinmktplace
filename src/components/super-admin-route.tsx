import { Navigate, Outlet } from 'react-router-dom';
import { useProfile } from '@/hooks/useProfile';

// Guard do painel de plataforma (/admin): só super-admin (Diego, D-E7.8 do ADR-0027).
// Fica dentro do ProtectedRoute, então user/profile já estão resolvidos aqui; não-super-admin
// (inclusive admin de empresa) volta pra operação. A proteção real de dado é a edge `usuarios`
// (list_orgs/create_org validam super_admin no backend) — este guard é só de navegação.
export function SuperAdminRoute() {
  const { profile, profileLoading } = useProfile();
  if (profileLoading) {
    return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  }
  return profile?.is_super_admin ? <Outlet /> : <Navigate to="/" replace />;
}
