import { Check, Circle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StepperProps {
  etapas: string[];
  atual: number; // index of in-progress step; -1 = none; etapas.length = all done
}

export function Stepper({ etapas, atual }: StepperProps) {
  return (
    <ol className="flex flex-col gap-3">
      {etapas.map((etapa, idx) => {
        const concluida = idx < atual;
        const emAndamento = idx === atual;
        return (
          <li
            key={etapa}
            className={cn(
              'flex items-center gap-3 rounded-md border p-3',
              concluida && 'border-green-200 bg-green-50',
              emAndamento && 'border-primary bg-accent'
            )}
            aria-label={
              concluida
                ? `Etapa concluída: ${etapa}`
                : emAndamento
                ? `Etapa atual: ${etapa}`
                : `Etapa pendente: ${etapa}`
            }
          >
            {concluida ? (
              <Check className="h-4 w-4 text-green-700" />
            ) : emAndamento ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground" />
            )}
            <span className={cn('text-sm', concluida && 'text-muted-foreground line-through')}>
              {etapa}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
