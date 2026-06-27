import { useId, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';

/**
 * Símbolo da marca PubliAI (Conceito 3 — linhas de movimento + chevron).
 * Gradiente de marca indigo→violeta. id único por instância (useId) para
 * permitir múltiplas renderizações na mesma página sem colidir.
 */
export function LogoSymbol({ className, style }: { className?: string; style?: CSSProperties }) {
  const id = useId();
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} style={style} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5C5CEB" />
          <stop offset="1" stopColor="#9152E3" />
        </linearGradient>
      </defs>
      <g fill="none" stroke={`url(#${id})`} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21H31" />
        <path d="M11 32H34" />
        <path d="M17 43H31" />
        <path d="M37 16 L53 32 L37 48" />
      </g>
      <g fill={`url(#${id})`}>
        <circle cx="7" cy="21" r="3" />
        <circle cx="4" cy="32" r="3" />
        <circle cx="7" cy="43" r="3" />
      </g>
    </svg>
  );
}

interface LogoProps {
  className?: string;
  symbolClassName?: string;
  /** Exibe o wordmark "PubliAI" ao lado do símbolo (default true). */
  showWordmark?: boolean;
}

export function Logo({ className, symbolClassName, showWordmark = true }: LogoProps) {
  return (
    <div className={cn('flex items-center gap-2', className)} aria-label="PubliAI">
      <LogoSymbol className={cn('h-7 w-7', symbolClassName)} />
      {showWordmark && (
        <span className="text-base font-semibold leading-none tracking-tight">
          Publi
          <span className="bg-[image:var(--brand-gradient)] bg-clip-text text-transparent">AI</span>
        </span>
      )}
    </div>
  );
}
