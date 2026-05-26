import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoteCard } from '@/components/lote-card';
import { useLotes } from '@/hooks/useLotes';

export default function Dashboard() {
  const lotes = useLotes();

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
      <div className="flex flex-col gap-3">
        {lotes.map((lote) => (
          <LoteCard key={lote.id} lote={lote} />
        ))}
      </div>
    </div>
  );
}
