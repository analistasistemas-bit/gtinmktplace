import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import type { Lote, LoteStatus } from '@/lib/mocks/types';

function destinoDoLote(status: LoteStatus, id: string): string {
  if (status === 'revisao') return `/revisao/${id}`;
  if (status === 'concluido' || status === 'erro') return `/relatorio/${id}`;
  return `/progresso/${id}`;
}

function formatarData(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LoteCard({ lote }: { lote: Lote }) {
  return (
    <Link to={destinoDoLote(lote.status, lote.id)} className="block">
      <Card className="p-4 transition-colors hover:bg-accent">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">Lote #{lote.numero}</h3>
              <StatusBadge status={lote.status} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{formatarData(lote.criadoEm)}</p>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            <div>{lote.totalFamilias} famílias</div>
            {lote.status === 'concluido' && (
              <div className="text-xs">
                {lote.totalPublicadas} publicadas · {lote.totalErros}{' '}
                {lote.totalErros === 1 ? 'erro' : 'erros'}
              </div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}
