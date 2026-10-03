import { useId, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// ⓘ ao lado de um título; o título do popover nomeia o diálogo (aria-labelledby).
export function InfoDica({ titulo, children, className }: { titulo: string; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Como ler: ${titulo}`}
          // alvo ≥ 44px no mobile (46) e 34px no desktop; margem negativa só em cima/embaixo/direita para o anel não cobrir o rótulo
          className="-my-4 -mr-4 inline-flex shrink-0 items-center justify-center rounded-full p-4 sm:-my-2.5 sm:-mr-2.5 sm:p-2.5 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        aria-labelledby={id} collisionPadding={16} avoidCollisions
        className={cn('max-w-[calc(100vw-2rem)] overflow-visible p-0 text-sm', className)}
      >
        {/* a rolagem fica aqui dentro para não cortar a seta do popover */}
        <div className="max-h-[min(var(--radix-popover-content-available-height),70vh)] overflow-y-auto p-3">
          <div id={id} className="mb-2 text-sm font-semibold text-foreground">{titulo}</div>
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function DicaTexto({ oQueE, comoLer }: { oQueE: string; comoLer: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p><span className="font-medium text-foreground">O que é: </span><span className="text-muted-foreground">{oQueE}</span></p>
      <div>
        <p className="font-medium text-foreground">Como ler</p>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 text-muted-foreground">
          {comoLer.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>
    </div>
  );
}
