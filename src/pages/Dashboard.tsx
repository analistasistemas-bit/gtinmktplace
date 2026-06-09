import { Link } from 'react-router-dom';
import { Plus, PackageOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { LoteCard } from '@/components/lote-card';
import { useLotes } from '@/hooks/useLotes';

export default function Dashboard() {
  const { data: lotes = [], isLoading, error } = useLotes();

  return (
    <div className="p-6">
      <PageHeader
        title="Lotes recentes"
        actions={
          <Button asChild>
            <Link to="/novo-lote">
              <Plus className="mr-1 h-4 w-4" />
              Novo lote
            </Link>
          </Button>
        }
      />
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando lotes...</div>
      ) : error ? (
        <div className="text-sm text-destructive">
          Erro ao carregar lotes: {(error as Error).message}
        </div>
      ) : lotes.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          title="Nenhum lote ainda"
          description='Faça upload de uma planilha para começar. Clique em "Novo lote".'
          action={
            <Button asChild>
              <Link to="/novo-lote">
                <Plus className="mr-1 h-4 w-4" />
                Novo lote
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {lotes.map((lote) => (
            <LoteCard key={lote.id} lote={lote} />
          ))}
        </div>
      )}
    </div>
  );
}
