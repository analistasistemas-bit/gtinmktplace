import { AlertTriangle, Boxes, Clock, Layers, Loader2, Package } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { EstadoKit, MarcaKit, TipoKit } from '@/lib/publicados';

// Classes escolhidas para contraste >= 4,5:1 nos dois temas (não trocar por chart-* no texto).
const CLASSES: Record<TipoKit, { tem: string; e?: string }> = {
  vinculado: {
    tem: 'border-teal-600/30 bg-teal-500/10 text-teal-800 dark:text-teal-300',
    e: 'border-transparent bg-teal-700 text-white',
  },
  variacao: {
    tem: 'border-violet-600/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
    e: 'border-transparent bg-violet-600 text-white',
  },
  // Papel "e" não existe: a LinhaKitVirtual já tem a pill.
  virtual: { tem: 'border-info/20 bg-info/10 text-info' },
};

const ICONE_NORMAL = { vinculado: Package, variacao: Layers, virtual: Boxes } as const;

function Icone({ tipo, estado }: { tipo: TipoKit; estado: EstadoKit }) {
  const cls = 'h-3 w-3';
  if (estado === 'falha') return <AlertTriangle aria-hidden className={cls} />;
  if (estado === 'montando') return <Loader2 aria-hidden className={cn(cls, 'motion-safe:animate-spin')} />;
  if (estado === 'aguardando') return <Clock aria-hidden className={cls} />;
  const Normal = ICONE_NORMAL[tipo];
  return <Normal aria-hidden className={cls} />;
}

export function BadgesKit({ marcas, className }: { marcas: MarcaKit[]; className?: string }) {
  const visiveis = marcas.filter((m) => CLASSES[m.tipo][m.papel]);
  if (visiveis.length === 0) return null;

  return (
    <TooltipProvider>
      <div className={cn('flex flex-wrap items-center gap-1', className)}>
        {visiveis.map((m, i) => (
          <Tooltip key={`${m.tipo}-${m.papel}-${i}`}>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-tipo={m.tipo}
                data-papel={m.papel}
                data-estado={m.estado}
                aria-label={`${m.rotulo}. ${m.detalhe}`}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  CLASSES[m.tipo][m.papel],
                )}
              >
                <Icone tipo={m.tipo} estado={m.estado} />
                {m.rotulo}
              </button>
            </TooltipTrigger>
            <TooltipContent>{m.detalhe}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
