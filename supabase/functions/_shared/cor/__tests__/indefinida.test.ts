import { describe, it, expect } from 'vitest';
import { ehCorIndefinida, COR_VISION_INDEFINIDA, COR_NAO_IDENTIFICADA } from '../indefinida';

describe('ehCorIndefinida', () => {
  it.each([null, undefined, '', '   ', 'Outra', ' Outra ', '(sem cor identificada)'])(
    'retorna true para %j',
    (valor) => {
      expect(ehCorIndefinida(valor)).toBe(true);
    },
  );

  it.each(['Azul', ' Azul ', 'Vermelho'])('retorna false para %j', (valor) => {
    expect(ehCorIndefinida(valor)).toBe(false);
  });

  it('ancora o sentinela do Vision (COR_VISION_INDEFINIDA)', () => {
    expect(ehCorIndefinida(COR_VISION_INDEFINIDA)).toBe(true);
  });

  it('ancora o sentinela do copywriter (COR_NAO_IDENTIFICADA)', () => {
    expect(ehCorIndefinida(COR_NAO_IDENTIFICADA)).toBe(true);
  });
});
