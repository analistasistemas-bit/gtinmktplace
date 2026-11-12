// Aba "Imagens IA" de Publicados: uma linha por anúncio e cor com imagens prontas ainda não aplicadas.
import { Images } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { guardarRetorno } from '@/lib/galeria/retorno';
import { useGaleriaPendentes } from '@/hooks/useGaleriaPendentes';

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function ListaPendentesGaleria() {
  const { data, isPending, isError, refetch } = useGaleriaPendentes();
  const navigate = useNavigate();
  const { search } = useLocation();

  if (isPending) return <div className="space-y-2">{[0, 1, 2].map((k) => <Skeleton key={k} className="h-16 w-full" />)}</div>;
  if (isError) {
    return (
      <EmptyState icon={Images} title="Não foi possível carregar as imagens pendentes."
        action={<Button variant="outline" size="sm" onClick={() => refetch()}>Tentar de novo</Button>} />
    );
  }
  if (data.length === 0) {
    return <EmptyState icon={Images} title="Nada pendente" description="Todas as imagens aprovadas já foram aplicadas nos anúncios." />;
  }
  return (
    <ul className="divide-y rounded-lg border">
      {data.map((p) => (
        <li key={`${p.ml_item_id}:${p.cor}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{p.titulo}</p>
            <p className="text-xs text-muted-foreground"><span className="tabular-nums">{p.ml_item_id}</span> · <span>{p.cor}</span></p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {p.prontas > 0 && <StatusPill tone="success">{plural(p.prontas, 'pronta', 'prontas')} para aplicar</StatusPill>}
            {p.aguardando_aprovacao > 0 && <StatusPill tone="warning">{p.aguardando_aprovacao} aguardando aprovação</StatusPill>}
            {p.aplicando && <StatusPill tone="info">Aplicando</StatusPill>}
          </div>
          <Button variant="outline" size="sm" onClick={() => { guardarRetorno(search); navigate(`/publicados/${encodeURIComponent(p.ml_item_id)}/galeria`); }}>
            Abrir galeria
          </Button>
        </li>
      ))}
    </ul>
  );
}
