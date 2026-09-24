import { describe, expect, it } from 'vitest';
import { calcularSemaforo } from '../../src/lib/semaforo';
import { semaforo } from '../../supabase/functions/_shared/promocoes/projecao';

describe('paridade semáforo front × promoções', () => {
  const casos: [number | null, number, number | null][] = [
    [null, 10, 5], [10, 10, 5], [9, 10, 5], [4.99, 10, 5], [4.99, 10, 0], [4.99, 10, null], [-3, 10, 5],
  ];
  it.each(casos)('liquido=%s piso=%s custo=%s', (l, p, c) => {
    expect(semaforo(l, p, c)).toBe(calcularSemaforo(l, p, c));
  });
});
