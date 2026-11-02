import { Link, Navigate } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { escolherLoteRevisao } from '@/lib/escolher-lote-revisao';
import { useLotes } from '@/hooks/useLotes';
import { CarregandoMarca } from '@/components/ui/carregando-marca';

export default function RevisaoIndex() {
  const { data: lotes, isLoading } = useLotes();

  if (isLoading) {
    return <div className="p-4 sm:p-6"><CarregandoMarca rotulo="Carregando" mensagem="Procurando o lote para revisar…" /></div>;
  }

  if (!lotes || lotes.length === 0) {
    return (
      <div className="p-4 sm:p-6">
        <EmptyState
          icon={ClipboardList}
          title="Nenhum lote para revisar ainda"
          description="Crie um lote para começar a revisar e publicar."
          action={
            <Button asChild>
              <Link to="/lotes">Criar primeiro lote</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const alvo = escolherLoteRevisao(lotes) ?? lotes[0];
  return <Navigate to={`/revisao/${alvo.id}`} replace />;
}
