import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { JornadaLote } from '@/components/jornada-lote';
import { destinoDoLote } from '@/lib/jornada';
import type { Lote, LoteStatus } from '@/lib/tipos-dominio';

function ctaLabel(status: LoteStatus): string {
  if (status === 'revisao') return 'Revisar';
  if (status === 'erro') return 'Corrigir';
  return 'Acompanhar';
}

/** Bloco "continuar de onde parei": lotes ainda em curso, com a etapa atual e o atalho de retomada. */
export function LotesEmAndamento({ lotes }: { lotes: Lote[] }) {
  const emAndamento = lotes.filter((l) => l.status !== 'concluido');
  if (emAndamento.length === 0) return null;

  return (
    <div className="mb-6">
      <h2 className="mb-2 text-sm font-medium text-muted-foreground">Continuar de onde parei</h2>
      <div className="flex flex-col gap-2">
        {emAndamento.map((lote) => (
          <Card
            key={lote.id}
            className="flex flex-col gap-3 border border-border p-4 shadow-none ring-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
              <span className="whitespace-nowrap font-semibold">Lote #{lote.numero}</span>
              <JornadaLote status={lote.status} />
            </div>
            <Button asChild size="sm" className="self-start sm:self-auto">
              <Link to={destinoDoLote(lote.status, lote.id)}>
                {ctaLabel(lote.status)} <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
