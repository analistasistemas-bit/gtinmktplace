// Galeria IA: rodapé fixo de cada passo — uma linha dizendo o que falta (ou o que vai acontecer) e um botão principal.
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
      <div className="mx-auto flex w-full max-w-[1240px] flex-col items-stretch gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p role="status" className={cn('flex min-w-0 items-center gap-2 text-sm', ok || concluido ? 'text-muted-foreground' : 'text-foreground')}>
          <Icone aria-hidden className={cn('size-4 shrink-0', !ok && !concluido && 'text-warning')} />
          <span>{texto}</span>
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {extra}
          <Button variant={variante} className="h-11 px-4 text-sm sm:min-w-36" disabled={!ok || ocupado} onClick={aoClicar}>
            {ocupado && <Loader2 aria-hidden className="animate-spin" />}
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
