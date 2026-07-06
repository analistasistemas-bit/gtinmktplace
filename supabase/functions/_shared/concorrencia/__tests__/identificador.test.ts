import { describe, it, expect } from 'vitest';
import { escolherIdentificador, gtinsValidos } from '../identificador';

describe('gtinsValidos', () => {
  it('lista todos os GTINs válidos e distintos, descartando internos (3000*) e vazios', () => {
    const fam = {
      nome_pai: 'Barbante X',
      variacoes: [{ gtin: '7891113465397' }, { gtin: '30001111' }, { gtin: null }, { gtin: '7891113482943' }, { gtin: '7891113465397' }],
    };
    expect(gtinsValidos(fam)).toEqual(['7891113465397', '7891113482943']);
  });
  it('lista vazia quando nenhum GTIN é válido', () => {
    expect(gtinsValidos({ nome_pai: 'X', variacoes: [{ gtin: null }, { gtin: '30009999' }] })).toEqual([]);
  });
});

describe('escolherIdentificador', () => {
  it('usa o GTIN da 1ª variação com GTIN válido', () => {
    const fam = {
      nome_pai: 'Linha de Costura X',
      variacoes: [{ gtin: null }, { gtin: '30001111' }, { gtin: '7891234567890' }],
    };
    expect(escolherIdentificador(fam)).toEqual({ tipo: 'gtin', valor: '7891234567890' });
  });

  it('cai para o título do PAI quando nenhuma variação tem GTIN válido', () => {
    const fam = {
      nome_pai: 'Linha de Costura X',
      variacoes: [{ gtin: null }, { gtin: '30009999' }, { gtin: '' }],
    };
    expect(escolherIdentificador(fam)).toEqual({ tipo: 'titulo', valor: 'Linha de Costura X' });
  });

  it('cai para o título quando não há variações', () => {
    const fam = { nome_pai: 'Fita Cetim', variacoes: [] };
    expect(escolherIdentificador(fam)).toEqual({ tipo: 'titulo', valor: 'Fita Cetim' });
  });
});
