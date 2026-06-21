import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { montarPendencias } from '@/lib/pendencias';
import type { Lote } from '@/lib/tipos-dominio';

/** Painel "Precisa da sua atenção": pendências pós-publicação acionáveis. Some quando não há nenhuma. */
export function Pendencias({ comProblema, lotes }: { comProblema: number; lotes: Lote[] }) {
  const pendencias = montarPendencias(comProblema, lotes);
  if (pendencias.length === 0) return null;

  return (
    <div className="mb-6">
      <h2 className="mb-2 text-sm font-medium text-muted-foreground">Precisa da sua atenção</h2>
      <div className="flex flex-col gap-2">
        {pendencias.map((p) => (
          <div
            key={p.chave}
            className="flex items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3"
          >
            <span className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
              {p.label}
            </span>
            <Button asChild size="sm" variant="outline">
              <Link to={p.destino}>
                Ver <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
