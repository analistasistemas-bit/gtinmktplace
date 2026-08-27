import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/motion/reduced-motion';
import { durationMs } from '@/motion/tokens';

/** Anima um número de 0 até o valor alvo e reinicia a partir do valor atual quando ele muda. */
export function useCountUp(targetValue: number): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(reduced ? targetValue : 0);
  const valueRef = useRef(value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduced) {
      valueRef.current = targetValue;
      setValue(targetValue);
      return;
    }

    const from = valueRef.current;
    const to = targetValue;
    if (from === to) return;

    let startedAt: number | undefined;
    const tick = (timestamp: number) => {
      startedAt ??= timestamp;
      const progress = Math.min((timestamp - startedAt) / durationMs.state, 1);
      const eased = 1 - (1 - progress) ** 2;
      const next = Math.round(from + (to - from) * eased);
      valueRef.current = next;
      setValue(next);

      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
      else frameRef.current = null;
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [reduced, targetValue]);

  return reduced ? targetValue : value;
}
