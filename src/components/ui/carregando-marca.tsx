import { useEffect, useState } from 'react';
import { Logo } from '@/components/ui/logo';
import { cn } from '@/lib/utils';
import './carregando-marca.css';

const ESPERA_LONGA_MS = 6000;

const VARIANTES = {
  /** Área de conteúdo de uma tela (padrão). */
  pagina: { caixa: 'min-h-72 gap-5 rounded-lg border border-dashed border-border p-10', simbolo: 'h-14 w-14', marca: 'text-2xl' },
  /** Aba, lista ou bloco dentro de uma tela que já mostra cabeçalho/filtros. */
  compacta: { caixa: 'gap-3 px-4 py-10', simbolo: 'h-8 w-8', marca: 'text-lg' },
  /** Tela inteira: troca de rota e checagem de sessão/permissão. */
  tela: { caixa: 'min-h-screen gap-5 p-10', simbolo: 'h-14 w-14', marca: 'text-2xl' },
} as const;

/**
 * Carregamento com a marca: logo PubliAI pulsando (mesmo pulso do login, sem overlay) e o que está sendo lido.
 * Só aparece se a espera passar de `atrasoMs` (carga de cache não pisca). Leituras que passam de 6 s ganham uma
 * segunda linha para a tela não parecer travada.
 */
export function CarregandoMarca({ rotulo, mensagem, className, variante = 'pagina', atrasoMs = 300 }: {
  rotulo: string;
  mensagem: string;
  className?: string;
  variante?: keyof typeof VARIANTES;
  atrasoMs?: number;
}) {
  const [visivel, setVisivel] = useState(atrasoMs <= 0);
  const [demorando, setDemorando] = useState(false);
  useEffect(() => {
    const a = atrasoMs > 0 ? setTimeout(() => setVisivel(true), atrasoMs) : undefined;
    const t = setTimeout(() => setDemorando(true), ESPERA_LONGA_MS);
    return () => { clearTimeout(a); clearTimeout(t); };
  }, [atrasoMs]);
  if (!visivel) return null;
  const v = VARIANTES[variante];
  return (
    <div role="status" aria-live="polite" aria-label={rotulo}
      className={cn('flex flex-col items-center justify-center text-center', v.caixa, className)}>
      <Logo className="carregando-marca__logo gap-3" symbolClassName={v.simbolo} wordmarkClassName={v.marca} />
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">{mensagem}</p>
        {demorando && <p className="text-xs text-muted-foreground/80">A primeira leitura pode levar alguns segundos.</p>}
      </div>
    </div>
  );
}
