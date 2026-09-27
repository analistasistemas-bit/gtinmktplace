import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Seção do dossiê: h2 no nível de "Resultado no período" e, logo abaixo, a linha que diz qual
 *  relógio o bloco segue (período escolhido, posição de hoje ou todo o histórico). */
export function BlocoDossie({ id, titulo, relogio, children, className }: {
  id: string; titulo: string; relogio: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div>
        <h2 id={id} className="text-h3">{titulo}</h2>
        <p className="text-xs text-muted-foreground">{relogio}</p>
      </div>
      {children}
    </section>
  );
}
