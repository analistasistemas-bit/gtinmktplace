import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import './border-trail.css';

type BorderTrailStyle = CSSProperties & {
  '--border-trail-radius': string;
};

export interface BorderTrailProps {
  active: boolean;
  radius?: number;
  className?: string;
  children: ReactNode;
}

/** Luz que percorre o contorno do elemento filho sem adicionar dependência de animação. */
export function BorderTrail({
  active,
  radius = 8,
  className,
  children,
}: BorderTrailProps) {
  const style: BorderTrailStyle = { '--border-trail-radius': `${radius}px` };

  // Wrapper sempre presente: alternar `active` não pode desmontar `children` (perderia foco/estado)
  // nem descartar `className` (o layout do chamador salta sem ele). Só os decorativos são condicionais.
  return (
    <div className={cn('border-trail', className)} style={style}>
      {active && (
        <>
          <span className="border-trail__track" aria-hidden="true">
            <span className="border-trail__glow" />
          </span>
          <span className="border-trail__fallback" aria-hidden="true" />
        </>
      )}
      {children}
    </div>
  );
}
