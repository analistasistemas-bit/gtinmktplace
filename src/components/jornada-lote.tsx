import { Check, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ETAPAS_JORNADA, jornadaDoLote } from '@/lib/jornada';
import type { LoteStatus } from '@/lib/tipos-dominio';

interface Props {
  status: LoteStatus;
  /** Versão reduzida (sem rótulos), para o card do Dashboard. */
  compact?: boolean;
  className?: string;
}

/** Stepper horizontal "você está aqui" da jornada do lote. */
export function JornadaLote({ status, compact = false, className }: Props) {
  const { indiceAtual, erro } = jornadaDoLote(status);
  const iconeSize = compact ? 'h-3 w-3' : 'h-4 w-4';
  return (
    <ol className={cn('flex items-center overflow-x-auto no-scrollbar py-1 shrink-0 w-full gap-2', className)} aria-label="Progresso do lote">
      {ETAPAS_JORNADA.map((etapa, i) => {
        const concluida = i < indiceAtual;
        const atual = i === indiceAtual;
        const comErro = atual && erro;
        return (
          <li key={etapa.chave} className="flex items-center shrink-0">
            <div className="flex items-center gap-2">
              <span
                aria-current={atual ? 'step' : undefined}
                className={cn(
                  'flex shrink-0 items-center justify-center rounded-full border font-medium transition-colors',
                  compact ? 'h-5 w-5 text-[10px]' : 'h-7 w-7 text-xs',
                  concluida && 'border-transparent bg-success text-success-foreground',
                  atual && !erro && 'border-transparent bg-primary text-primary-foreground',
                  comErro && 'border-transparent bg-destructive text-destructive-foreground',
                  !concluida && !atual && 'border-border bg-muted text-muted-foreground',
                )}
              >
                {concluida ? (
                  <Check className={iconeSize} />
                ) : comErro ? (
                  <AlertTriangle className={iconeSize} />
                ) : (
                  i + 1
                )}
              </span>
              {!compact && (
                <span
                  className={cn(
                    'whitespace-nowrap text-sm',
                    comErro
                      ? 'font-medium text-destructive'
                      : atual
                        ? 'font-medium text-foreground'
                        : concluida
                          ? 'text-foreground'
                          : 'text-muted-foreground',
                  )}
                >
                  {etapa.label}
                </span>
              )}
            </div>
            {i < ETAPAS_JORNADA.length - 1 && (
              <span
                aria-hidden="true"
                className={cn(
                  'h-px shrink-0',
                  compact ? 'w-4' : 'mx-2 w-6 sm:mx-3 sm:w-8',
                  concluida ? 'bg-success' : 'bg-border',
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
