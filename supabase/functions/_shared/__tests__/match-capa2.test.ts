import { describe, it, expect } from 'vitest';
import { matchCapa2 } from '../parser';

describe('matchCapa2', () => {
  const paths = [
    'u/lote/CAPA_00445975.jpeg',
    'u/lote/CAPA2_00445975.jpeg',
    'u/lote/00175269.jpeg',
  ];
  it('acha a 2a foto (CAPA2_<pai>) entre os paths', () => {
    expect(matchCapa2('00445975', paths)).toBe('u/lote/CAPA2_00445975.jpeg');
  });
  it('retorna undefined quando não há CAPA2_ do pai', () => {
    expect(matchCapa2('00999999', paths)).toBeUndefined();
  });
});
