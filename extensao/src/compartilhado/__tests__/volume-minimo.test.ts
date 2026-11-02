import { describe, expect, it } from 'vitest';
import { volumeMinimoAoPrecoAtual } from '../volume-minimo';

describe('volumeMinimoAoPrecoAtual', () => {
  it('piso da faixa vezes o preço atual, em centavos', () => {
    expect(volumeMinimoAoPrecoAtual('+100 vendidos', 19.9)).toBe(199000);
    expect(volumeMinimoAoPrecoAtual('+2,5 mil vendidos', 10.1)).toBe(2525000);
  });
  it('sem vendidos ou sem preço legível: null (nunca zero)', () => {
    expect(volumeMinimoAoPrecoAtual(null, 19.9)).toBeNull();
    expect(volumeMinimoAoPrecoAtual('+100 vendidos', null)).toBeNull();
    expect(volumeMinimoAoPrecoAtual('sem texto', 19.9)).toBeNull();
  });
});
