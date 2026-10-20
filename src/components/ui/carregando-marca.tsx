import { useEffect, useState } from 'react';
import { Logo } from '@/components/ui/logo';
import { cn } from '@/lib/utils';
import './carregando-marca.css';

const ESPERA_LONGA_MS = 6000;

/**
 * Carregamento de área de conteúdo com a marca: logo PubliAI pulsando (mesmo pulso do login, sem overlay) e o que está
 * sendo lido. Leituras que passam de 6 s ganham uma segunda linha para a tela não parecer travada.
 */
export function CarregandoMarca({ rotulo, mensagem, className }: { rotulo: string; mensagem: string; className?: string }) {
  const [demorando, setDemorando] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDemorando(true), ESPERA_LONGA_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <div role="status" aria-live="polite" aria-busy="true" aria-label={rotulo}
      className={cn('flex min-h-72 flex-col items-center justify-center gap-5 rounded-lg border border-dashed border-border p-10 text-center', className)}>
      <Logo className="carregando-marca__logo gap-3" symbolClassName="h-14 w-14" wordmarkClassName="text-2xl" />
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">{mensagem}</p>
        {demorando && <p className="text-xs text-muted-foreground/80">A primeira leitura pode levar alguns segundos.</p>}
      </div>
    </div>
  );
}
