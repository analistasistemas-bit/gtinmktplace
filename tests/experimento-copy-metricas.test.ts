import { describe, it, expect } from 'vitest';
import {
  extrairMedidas,
  medidasNaoAncoradas,
  padroesDeComparacao,
  taxaBulletsRepetidos,
} from '../scripts/experimento-copy/metricas';

describe('extrairMedidas', () => {
  it('extrai número + unidade', () => {
    expect(extrairMedidas('Cone com 10.000 metros e Tex 29.')).toContain('10000metros');
  });

  it('normaliza separador de milhar — 10.000 e 10000 são a mesma medida', () => {
    expect(extrairMedidas('10.000 metros')).toEqual(extrairMedidas('10000 metros'));
  });

  it('normaliza espaço entre número e unidade', () => {
    expect(extrairMedidas('16 mm')).toEqual(extrairMedidas('16mm'));
  });

  it('não duplica a mesma medida repetida', () => {
    expect(extrairMedidas('16mm de largura, fita de 16mm')).toEqual(['16mm']);
  });

  it('texto sem medida devolve vazio', () => {
    expect(extrairMedidas('Produto resistente e bonito.')).toEqual([]);
  });
});

describe('medidasNaoAncoradas', () => {
  it('não acusa quando a saída só repete medidas da fonte, em formato diferente', () => {
    expect(medidasNaoAncoradas('Rolo de 10000 metros.', 'CONTÉM 10.000 METROS.')).toEqual([]);
  });

  it('acusa medida que a saída inventou', () => {
    expect(medidasNaoAncoradas('Resiste a 200 graus.', 'CONTÉM 10.000 METROS.'))
      .toContain('200graus');
  });
});

describe('padroesDeComparacao', () => {
  it('sinaliza percentual', () => {
    expect(padroesDeComparacao('30% mais resistente')).not.toHaveLength(0);
  });

  it('sinaliza comparação sem base', () => {
    expect(padroesDeComparacao('rende mais que os concorrentes')).not.toHaveLength(0);
  });

  it('não sinaliza texto ancorado sem comparação', () => {
    expect(padroesDeComparacao('A metragem de 10.000 metros permite maior tempo de uso.')).toEqual([]);
  });
});

describe('taxaBulletsRepetidos', () => {
  it('0 quando todos os bullets são distintos', () => {
    expect(taxaBulletsRepetidos(['✔ Rende 100 folhas', '✔ Bateria 20V'])).toBe(0);
  });

  it('alta quando o mesmo bullet se repete entre anúncios', () => {
    const r = taxaBulletsRepetidos([
      '✔ Alta resistência\n✔ Único A',
      '✔ Alta resistência\n✔ Único B',
      '✔ Alta resistência\n✔ Único C',
    ]);
    expect(r).toBeGreaterThan(0.4);
  });

  it('lista vazia devolve 0 em vez de dividir por zero', () => {
    expect(taxaBulletsRepetidos([])).toBe(0);
  });
});
