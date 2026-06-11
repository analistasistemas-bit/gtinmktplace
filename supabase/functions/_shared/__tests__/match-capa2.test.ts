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

  it('casa pelo código de variação quando a foto foi nomeada com o filho (lote #26)', () => {
    // Família PAI 02841029, foto comum nomeada com o código vendável (filho) 02841037.
    const ps = ['u/lote/02841037.JPG', 'u/lote/CAPA2_02841037.jpeg'];
    expect(matchCapa2(['02841029', '02841037'], ps)).toBe('u/lote/CAPA2_02841037.jpeg');
  });

  it('ainda casa pelo PAI quando a foto usa o código do PAI', () => {
    expect(matchCapa2(['00445975', '00175269'], paths)).toBe('u/lote/CAPA2_00445975.jpeg');
  });
});
