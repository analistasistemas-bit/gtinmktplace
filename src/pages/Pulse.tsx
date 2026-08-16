import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { Navigate } from 'react-router-dom';
import { PageHeader } from '@/components/ui/page-header';

export default function Pulse() {
  const { data: modulos, isLoading } = useModulosHabilitados();
  if (isLoading) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  if (!modulos?.includes('pulse')) return <Navigate to="/" replace />;
  return (
    <div className="p-4 md:p-6">
      <PageHeader title="Pulse" subtitle="Inteligência de mercado" />
    </div>
  );
}
