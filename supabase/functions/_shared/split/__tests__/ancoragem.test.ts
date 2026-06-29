import { describe, it, expect } from 'vitest';
import { montarAncoragem } from '../ancoragem';
import { particionar } from '../particionar';

describe('montarAncoragem', () => {
  it('mapeia cada sku para a partição do anúncio onde está', () => {
    const linhas = [
      { particao: 0, variacoes_externas: { a: { variation_id: '1' }, b: { variation_id: '2' } } },
      { particao: 1, variacoes_externas: { c: { variation_id: '3' } } },
    ];
    const m = montarAncoragem(linhas);
    expect(m.get('a')).toBe(0);
    expect(m.get('b')).toBe(0);
    expect(m.get('c')).toBe(1);
    expect(m.size).toBe(3);
  });

  it('tolera variacoes_externas nula/vazia', () => {
    const m = montarAncoragem([{ particao: 0, variacoes_externas: null }]);
    expect(m.size).toBe(0);
  });
});

describe('ancoragem + particionar (estabilidade do update)', () => {
  it('cor ancorada não migra quando entra cor nova', () => {
    // anúncio 0 já tem 'a'; anúncio 1 já tem 'z' (alfabeticamente depois)
    const linhas = [
      { particao: 0, variacoes_externas: { a: {} } },
      { particao: 1, variacoes_externas: { z: {} } },
    ];
    const anc = montarAncoragem(linhas);
    // entra 'm' (nova): deve preencher a partição 0 (menor índice com espaço), sem mover a/z
    const cores = [{ sku: 'a', cor: 'Azul' }, { sku: 'z', cor: 'Zinco' }, { sku: 'm', cor: 'Marrom' }];
    const r = particionar(cores, anc, 100);
    expect(r.get('a')).toBe(0); // ancorada, intacta
    expect(r.get('z')).toBe(1); // ancorada, intacta
    expect(r.get('m')).toBe(0); // nova entra na partição com espaço
  });
});
