import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoteCard } from '@/components/lote-card';
import { useLotes } from '@/hooks/useLotes';

export default function Dashboard() {
  const { data: lotes = [], isLoading, error } = useLotes();

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Lotes recentes</h1>
        <Button asChild>
          <Link to="/novo-lote">
            <Plus className="mr-1 h-4 w-4" />
            Novo lote
          </Link>
        </Button>
      </div>
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando lotes...</div>
      ) : error ? (
        <div className="text-sm text-destructive">
          Erro ao carregar lotes: {(error as Error).message}
        </div>
      ) : lotes.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhum lote ainda. Clique em "Novo lote" para começar.
        </div>
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
