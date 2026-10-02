import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Ícone que copia `texto` para a área de transferência; troca para Check por ~1,5 s ("Copiado"). */
export function BotaoCopiar({ texto, rotulo, className }: { texto: string; rotulo: string; className?: string }) {
  const [copiado, setCopiado] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      return; // sem permissão/contexto inseguro: não finge que copiou
    }
    setCopiado(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopiado(false), 1500);
  };
  return (
    <button
      type="button"
      onClick={copiar}
      aria-label={copiado ? 'Copiado' : rotulo}
      title={copiado ? 'Copiado' : rotulo}
      className={cn(
        'inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        copiado && 'text-success',
        className,
      )}
    >
      {copiado ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}
