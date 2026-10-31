import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { CelulaAds, ComparacaoAds } from '@/lib/ads-metricas';

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

/** Travessão visível; o motivo completo abre num popover (clique, toque ou teclado) e fica no nome acessível. */
function Curto({ motivo, className }: { motivo: string; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" title={motivo}
          className={cn('ml-auto block cursor-help rounded-sm text-muted-foreground underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}>
          <span aria-hidden>—</span><span className="sr-only">{motivo}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 text-sm text-muted-foreground">{motivo}</PopoverContent>
    </Popover>
  );
}

/** Célula de métrica em tabela/cartão (celulaAds): valor + variação, ou "—" curto com o motivo acessível. */
export function CelulaMetricaAds({ celula: c, provisoria }: { celula: CelulaAds; provisoria: boolean }) {
  return (
    <div className="space-y-0.5">
      {c.valor === null ? <Curto motivo={c.motivo!} /> : <span className="block font-medium">{c.valor}</span>}
      {c.delta && (
        <span className="flex flex-wrap items-center justify-end gap-x-1.5">
          <DeltaAds {...c.delta} />
          {provisoria && <span className="rounded-sm bg-muted px-1 text-[11px] font-medium text-muted-foreground">Provisória</span>}
        </span>
      )}
      {c.motivoDelta && <Curto motivo={c.motivoDelta} className="text-xs" />}
    </div>
  );
}

/** Legenda única do travessão, abaixo da tabela/cartões. */
export function LegendaCurtaAds() {
  return <p className="text-xs text-muted-foreground">— indica valor ou variação indisponível (ex.: sem base de comparação ou sem denominador no período).</p>;
}
