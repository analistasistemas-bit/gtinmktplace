// Galeria IA: rodapé fixo de cada passo: uma linha dizendo o que falta (ou o que vai acontecer) e um botão principal.
import type { ReactNode } from 'react';
import { AlertTriangle, ArrowRight, Check, Info, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function Rodape({ texto, ok, rotulo, aoClicar, ocupado = false, concluido = false, seta = true, extra, variante = 'default' }: {
  texto: string;
  /** false = o texto é o que falta e o botão fica desabilitado. */
  ok: boolean;
  rotulo: string;
  aoClicar: () => void;
  ocupado?: boolean;
  concluido?: boolean;
  seta?: boolean;
  extra?: ReactNode;
  /** `outline` quando a ação principal do passo está no conteúdo (passo 4). */
  variante?: 'default' | 'outline';
}) {
  const Icone = concluido ? Check : ok ? Info : AlertTriangle;
  return (
    <div className="sticky bottom-0 z-20 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto flex w-full max-w-[1240px] items-center justify-between gap-3 px-4 py-2 sm:px-6 sm:py-3">
        <p role="status" className={cn('flex min-w-0 items-center gap-2 text-xs sm:text-sm', ok || concluido ? 'text-muted-foreground' : 'text-foreground')}>
          <Icone aria-hidden className={cn('size-4 shrink-0 max-sm:hidden', !ok && !concluido && 'text-warning')} />
          <span className="line-clamp-2">{texto}</span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {extra}
          <Button variant={variante} className="h-11 px-3 text-sm sm:min-w-36 sm:px-4" disabled={!ok || ocupado} onClick={aoClicar}>
            {ocupado && <Loader2 aria-hidden className="motion-safe:animate-spin" />}
            {rotulo}
            {seta && !ocupado && <ArrowRight aria-hidden />}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Miolo de cada passo: largura do cabeçalho, título e a frase do que o passo faz. */
export function MioloPasso({ titulo, frase, children }: { titulo: string; frase: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1240px] flex-1 px-4 pb-8 pt-6 sm:px-6">
      <div className="mb-5 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">{titulo}</h1>
        <p className="text-sm text-muted-foreground">{frase}</p>
      </div>
      {children}
    </div>
  );
}
