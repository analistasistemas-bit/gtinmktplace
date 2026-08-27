import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import './glow-effect.css';

type GlowEffectStyle = CSSProperties & {
  '--glow-effect-radius': string;
};

export interface GlowEffectProps {
  /** `false` = wrapper sem aura (o filho fica igual a antes). */
  ativo?: boolean;
  /** `true` = aura mais forte e mais rápida (algo pedindo atenção, não só destaque). */
  forte?: boolean;
  radius?: number;
  className?: string;
  children: ReactNode;
}

/** Aura de cores por trás do filho. O wrapper é sempre renderizado, mesmo inativo: alternar o
 *  efeito não pode desmontar o conteúdo (foco e estado se perdem — lição da border-trail). */
export function GlowEffect({
  ativo = true, forte = false, radius = 8, className, children,
}: GlowEffectProps) {
  const style: GlowEffectStyle = { '--glow-effect-radius': `${radius}px` };
  return (
    <div className={cn('glow-effect', forte && 'glow-effect--forte', className)} style={style}>
      {ativo && <span className="glow-effect__aura" aria-hidden="true" />}
      {children}
    </div>
  );
}
