import { Link, Navigate } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useLotes } from '@/hooks/useLotes';

export default function RevisaoIndex() {
  const { data: lotes, isLoading } = useLotes();

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  }

  if (!lotes || lotes.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          icon={ClipboardList}
          title="Nenhum lote para revisar ainda"
          description="Crie um lote para começar a revisar e publicar."
          action={
            <Button asChild>
              <Link to="/novo-lote">Criar primeiro lote</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return <Navigate to={`/revisao/${lotes[0].id}`} replace />;
}
