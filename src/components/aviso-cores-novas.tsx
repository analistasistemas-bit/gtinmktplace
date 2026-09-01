import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { FamiliaCorNova } from '@/lib/cores-novas';
import { cn } from '@/lib/utils';

interface AvisoCoresNovasProps {
  coresNovas: FamiliaCorNova[];
  totalCoresNovas: number;
}

export function AvisoCoresNovas({ coresNovas, totalCoresNovas }: AvisoCoresNovasProps) {
  const [expandido, setExpandido] = useState(false);
  const detalheId = useId();
  const qtdFamilias = coresNovas.length;

  return (
    <div className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-xs text-warning">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1">
          <strong>{totalCoresNovas} cor(es) nova(s)</strong> vieram na planilha e precisam de foto
          para publicar.
          {!expandido && qtdFamilias > 0 && (
            <>
              {' '}
              Afetam {qtdFamilias} família{qtdFamilias !== 1 ? 's' : ''}.
            </>
          )}
        </p>
        <button
          type="button"
          onClick={() => setExpandido((v) => !v)}
          aria-expanded={expandido}
          aria-controls={detalheId}
          className="inline-flex min-h-6 shrink-0 items-center gap-1 rounded-sm font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expandido ? 'Recolher aviso' : 'Ver famílias afetadas'}
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 motion-safe:transition-transform motion-safe:duration-(--motion-duration-micro)',
              expandido && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
      </div>
      {expandido && (
        <div
          id={detalheId}
          className="mt-2 motion-safe:animate-in fade-in-0 slide-in-from-top-1 duration-(--motion-duration-state) motion-reduce:animate-none"
        >
          <p>
            Expanda{' '}
            {coresNovas.map((f, i) => (
              <span key={f.codigoPai}>
                {i > 0 && ', '}
                <span className="font-medium">{f.titulo || f.codigoPai}</span> ({f.codigos.length})
              </span>
            ))}{' '}
            e use o botão de foto em cada cor nova.
          </p>
        </div>
      )}
    </div>
  );
}
