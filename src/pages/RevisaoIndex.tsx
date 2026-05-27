import { Link, Navigate } from 'react-router-dom';
import { useLotes } from '@/hooks/useLotes';

export default function RevisaoIndex() {
  const { data: lotes, isLoading } = useLotes();

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  }

  if (!lotes || lotes.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Nenhum lote para revisar ainda.{' '}
        <Link to="/novo-lote" className="text-primary underline">
          Criar primeiro lote
        </Link>
        .
      </div>
    );
  }

  return <Navigate to={`/revisao/${lotes[0].id}`} replace />;
}
