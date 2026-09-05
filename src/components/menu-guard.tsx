import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useProfile } from '@/hooks/useProfile';
import { visibleMenus, menuKeyForPath, pathForMenu } from '@/lib/menus';
import { menusDeModulosDesabilitados, MODULOS } from '@/lib/modulos';
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { useSupportStore } from '@/stores/support-store';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function MenuGuard() {
  const { profile, profileLoading } = useProfile();
  const location = useLocation();
  const context = useSupportStore((state) => state.context);
  // Diferente da sidebar (onde "carregando" esconde o menu), aqui é preciso ESPERAR:
  // redirecionar antes da resposta chegar tiraria o operador de um deep-link válido.
  const { data: modulos, isLoading: modulosLoading, refetch: refetchModulos } = useModulosHabilitados();
  const key = menuKeyForPath(location.pathname);

  if (profileLoading || modulosLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  const menusDoPerfil = visibleMenus(profile ?? { is_admin: false, is_active: true, allowed_menus: [] }, !!context);

  // RPC de módulos falhou na 1ª carga da sessão: `modulos` fica `undefined` sem estar
  // carregando, e não dá pra saber se o módulo da rota atual está habilitado. Só é "não sei"
  // quando o PERFIL já daria acesso ao menu — se o perfil nem permite, o motivo é permissão,
  // não rede, e o fluxo normal decide. `?? []` esconderia como se a org não tivesse contratado
  // (ADR-0153 D5); o resto do app (Dashboard, Lotes...) continua liberado, pois não depende de
  // `modulos`.
  if (modulos === undefined && key !== null && MODULOS.some((m) => m.menu === key) && menusDoPerfil.includes(key)) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Card className="w-full max-w-sm p-6 text-center">
          <h1 className="mb-2 text-h1">Módulos indisponíveis</h1>
          <p className="mb-4 text-sm text-muted-foreground">
            Não foi possível confirmar os módulos habilitados. Verifique a conexão e tente novamente.
          </p>
          <Button variant="outline" onClick={() => void refetchModulos()}>
            Tentar novamente
          </Button>
        </Card>
      </div>
    );
  }

  const escondidos = new Set(menusDeModulosDesabilitados(modulos ?? []));
  const menus = menusDoPerfil.filter((m) => !escondidos.has(m));

  // Rota sem menu mapeado (ex.: /style-guide) → libera.
  if (key === null) return <Outlet />;

  if (!menus.includes(key)) {
    return menus.length > 0
      ? <Navigate to={pathForMenu(menus[0])} replace />
      : <Navigate to="/sem-acesso" replace />;
  }

  return <Outlet />;
}
