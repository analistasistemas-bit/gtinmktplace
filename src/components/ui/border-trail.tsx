import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import './border-trail.css';

type BorderTrailStyle = CSSProperties & {
  '--border-trail-radius': string;
  '--border-trail-inset'?: string;
};

/** Espelha `rounded-xl` (--radius-xl); `@theme inline` não emite a var em runtime, então repete a conta. */
export const RAIO_XL = 'calc(var(--radius) * 1.4)';

/** Número = px; string = qualquer <length> CSS (ex.: `calc(var(--radius) * 1.4)`). */
const px = (v: number | string) => (typeof v === 'number' ? `${v}px` : v);

export interface BorderTrailProps {
  active: boolean;
  radius?: number | string;
  className?: string;
  children: ReactNode;
}

/**
 * Só os decorativos (trilha + fallback), para quem já é posicionado e não pode virar filho de
 * `.border-trail` (ex.: Dialog `fixed`). `inset` negativo desenha por fora da borda; use 0 em
 * contêineres com overflow, que cortariam o -1px.
 */
export function BorderTrailDecor({
  radius = 8,
  inset = -1,
}: {
  radius?: number | string;
  inset?: number;
}) {
  const style: BorderTrailStyle = {
    '--border-trail-radius': px(radius),
    '--border-trail-inset': `${inset}px`,
  };
  return (
    <>
      <span className="border-trail__track" aria-hidden="true" style={style}>
        <span className="border-trail__glow" />
      </span>
      <span className="border-trail__fallback" aria-hidden="true" style={style} />
    </>
  );
}

/** Luz que percorre o contorno do elemento filho sem adicionar dependência de animação. */
export function BorderTrail({
  active,
  radius = 8,
  className,
  children,
}: BorderTrailProps) {
  const style: BorderTrailStyle = { '--border-trail-radius': px(radius) };

  // Wrapper sempre presente: alternar `active` não pode desmontar `children` (perderia foco/estado)
  // nem descartar `className` (o layout do chamador salta sem ele). Só os decorativos são condicionais.
  return (
    <div className={cn('border-trail', className)} style={style}>
      {active && <BorderTrailDecor radius={radius} />}
      {children}
    </div>
  );
}
