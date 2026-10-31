import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ComparacaoAds } from '@/lib/ads-metricas';

/** Seta = direção do número; cor = significado (já resolvido em compararIndicadorAds). */
export function DeltaAds({ texto, direcao, tom, className }: ComparacaoAds & { className?: string }) {
  const Seta = direcao === 'up' ? ArrowUp : direcao === 'down' ? ArrowDown : null;
  return (
    <span data-delta data-direcao={direcao} data-tom={tom}
      className={cn('items-center gap-0.5 text-xs font-medium', className ?? 'inline-flex',
        tom === 'success' ? 'text-success' : tom === 'danger' ? 'text-destructive' : 'text-muted-foreground')}>
      {Seta && <Seta className="h-3 w-3" aria-hidden />}
      {texto}
    </span>
  );
}
