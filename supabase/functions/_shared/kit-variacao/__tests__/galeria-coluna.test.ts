import { describe, it, expect } from 'vitest';
import { fotosDaColuna, parseGaleria } from '../galeria-coluna.ts';

describe('fotosDaColuna (jsonb → fotos)', () => {
  it('lista válida volta como está; vazia vale (galeria desligada)', () => {
    expect(fotosDaColuna([{ id: 'P2', item: 'MLB1' }])).toEqual([{ id: 'P2', item: 'MLB1' }]);
    expect(fotosDaColuna([])).toEqual([]);
  });
  it('ausente ou fora do formato vira undefined (nada a reusar)', () => {
    expect(fotosDaColuna(undefined)).toBeUndefined();
    expect(fotosDaColuna(null)).toBeUndefined();
    expect(fotosDaColuna('x')).toBeUndefined();
  });
  it('item mal formado é descartado em vez de quebrar', () => {
    expect(fotosDaColuna([{ id: 'P2', item: 'MLB1' }, { id: '', item: 'MLB1' }, { id: 'P3' }, null, 5]))
      .toEqual([{ id: 'P2', item: 'MLB1' }]);
  });
});

describe('parseGaleria (corpo da requisição)', () => {
  it('mantém só rótulos com lista de ids em texto', () => {
    expect(parseGaleria({ 'Preto e Branco': ['P2', 'B3'], X: 'nao', Y: [1, 'ok', ''] })).toEqual({
      'Preto e Branco': ['P2', 'B3'], Y: ['ok'],
    });
  });
  it('ausente, array ou outro tipo vira undefined', () => {
    expect(parseGaleria(undefined)).toBeUndefined();
    expect(parseGaleria(null)).toBeUndefined();
    expect(parseGaleria(['a'])).toBeUndefined();
    expect(parseGaleria('x')).toBeUndefined();
  });
});
