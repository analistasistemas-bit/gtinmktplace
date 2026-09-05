import { Check, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ETAPAS_JORNADA, jornadaDoLote, type ResultadoPublicacao } from '@/lib/jornada';
import type { LoteStatus } from '@/lib/tipos-dominio';

interface Props {
  status: LoteStatus;
  /** Desfecho da publicação. **Obrigatório de propósito**: o status do lote sozinho não sabe se
   *  publicou (`concluido` = "terminou de rodar"), e cada tela que esquecia de informar acendia
   *  "Publicado" em verde num lote recusado pelo ML — aconteceu na Revisão depois de corrigido no
   *  Relatório. Com a prop obrigatória o compilador cobra de toda tela nova. */
  resultado: ResultadoPublicacao;
  /** Versão reduzida (sem rótulos), para o card do Dashboard. */
  compact?: boolean;
  className?: string;
}

/** Stepper horizontal "você está aqui" da jornada do lote. */
export function JornadaLote({ status, resultado, compact = false, className }: Props) {
  const { indiceAtual, erro } = jornadaDoLote(status, resultado);
  const iconeSize = compact ? 'h-3 w-3' : 'h-4 w-4';
  return (
    <div className="relative min-w-0 w-full">
      <ol
        className={cn(
          compact
            ? 'flex w-full shrink-0 items-center gap-2 overflow-x-auto no-scrollbar py-1'
            : 'grid w-full grid-cols-2 gap-x-3 gap-y-2 py-1 sm:flex sm:items-center sm:gap-2 sm:overflow-x-auto sm:no-scrollbar',
          className,
        )}
        aria-label="Progresso do lote"
      >
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
                  'flex shrink-0 items-center justify-center rounded-full border font-medium transition-colors duration-(--motion-duration-state) ease-reversible',
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
                    'whitespace-nowrap text-sm transition-colors duration-(--motion-duration-state) ease-reversible',
                    comErro
                      ? 'font-medium text-destructive'
                      : atual
                        ? 'font-medium text-foreground'
                        : concluida
                          ? 'text-foreground'
                          : 'text-muted-foreground',
                  )}
                >
                  {comErro ? (etapa.labelErro ?? etapa.label) : etapa.label}
                </span>
              )}
            </div>
            {i < ETAPAS_JORNADA.length - 1 && (
              <span
                aria-hidden="true"
                className={cn(
                  'h-px shrink-0 transition-colors duration-(--motion-duration-state) ease-reversible',
                  compact ? 'w-4' : 'hidden sm:block sm:mx-3 sm:w-8',
                  concluida ? 'bg-success' : 'bg-border',
                )}
              />
            )}
          </li>
        );
      })}
      </ol>
    </div>
  );
}
