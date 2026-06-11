import { describe, it, expect } from 'vitest';
import { matchCapa3 } from '../parser';
import { classificarArquivo } from '../upload/match';

describe('matchCapa3', () => {
  const paths = [
    'u/lote/CAPA_00445975.jpeg',
    'u/lote/CAPA2_00445975.jpeg',
    'u/lote/CAPA3_00445975.jpeg',
    'u/lote/00175269.jpeg',
  ];
  it('acha a 3a foto (CAPA3_<pai>) entre os paths', () => {
    expect(matchCapa3('00445975', paths)).toBe('u/lote/CAPA3_00445975.jpeg');
  });
  it('retorna undefined quando não há CAPA3_ do pai', () => {
    expect(matchCapa3('00999999', paths)).toBeUndefined();
  });
  it('não confunde CAPA3_ com CAPA_/CAPA2_ do mesmo pai', () => {
    expect(matchCapa3('00445975', ['u/lote/CAPA_00445975.jpeg', 'u/lote/CAPA2_00445975.jpeg'])).toBeUndefined();
  });
  it('casa pelo código de variação quando a foto foi nomeada com o filho (lote #26)', () => {
    const ps = ['u/lote/02841037.JPG', 'u/lote/CAPA3_02841037.jpeg'];
    expect(matchCapa3(['02841029', '02841037'], ps)).toBe('u/lote/CAPA3_02841037.jpeg');
  });
});

describe('classificarArquivo (CAPA3)', () => {
  it('classifica CAPA3_<codigo> como capa3', () => {
    expect(classificarArquivo('CAPA3_00445975.jpeg')).toEqual({ tipo: 'capa3', codigo: '00445975' });
  });
  it('CAPA2_ continua sendo capa2 (não capturado pelo CAPA3)', () => {
    expect(classificarArquivo('CAPA2_00445975.png')).toEqual({ tipo: 'capa2', codigo: '00445975' });
  });
  it('CAPA_ continua sendo capa', () => {
    expect(classificarArquivo('CAPA_00445975.jpg')).toEqual({ tipo: 'capa', codigo: '00445975' });
  });
  it('foto de variação (sem prefixo) não é capa3', () => {
    expect(classificarArquivo('00445975.jpeg')).toEqual({ tipo: 'variacao', codigo: '00445975' });
  });
});
