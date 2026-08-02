import { describe, it, expect } from 'vitest';
import {
  extrairMedidas,
  medidasNaoAncoradas,
  comparacoesNaoAncoradas,
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

describe('comparacoesNaoAncoradas', () => {
  it('sinaliza percentual que a saída inventou', () => {
    expect(comparacoesNaoAncoradas('30% mais resistente', 'COMPOSIÇÃO: POLIÉSTER.')).not.toHaveLength(0);
  });

  it('sinaliza comparação sem base', () => {
    expect(comparacoesNaoAncoradas('rende mais que os concorrentes', 'CONE COM 10.000 METROS.'))
      .not.toHaveLength(0);
  });

  it('não sinaliza texto ancorado sem comparação', () => {
    expect(comparacoesNaoAncoradas('A metragem de 10.000 metros permite maior tempo de uso.', 'CONTÉM 10.000 METROS.'))
      .toEqual([]);
  });

  // Regressão: "100% poliéster" é composição vinda da fonte, não comparação inventada. A
  // primeira versão da métrica acusava isso — e acusava MAIS o prompt novo, porque R5 manda
  // repetir "linha 100% poliéster" entre os termos de busca.
  it('não acusa percentual de composição que já está na fonte', () => {
    expect(comparacoesNaoAncoradas(
      'Linha 100% poliéster. A composição em 100% poliéster mantém o acabamento uniforme.',
      'LINHA PARA COSTURA. COMPOSIÇÃO: 100% POLIÉSTER.',
    )).toEqual([]);
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
