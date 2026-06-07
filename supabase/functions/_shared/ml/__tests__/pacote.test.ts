import { describe, it, expect } from 'vitest';
import { dimensoesValidas, montarAtributosPacote } from '../pacote';

describe('dimensoesValidas', () => {
  it('válido quando todas as medidas ≥ 1cm e peso ≥ 1g', () => {
    expect(dimensoesValidas({ altura_cm: 18, largura_cm: 7, comprimento_cm: 7, peso_gramas: 150 })).toBe(true);
  });

  it('inválido com o placeholder 0,1cm da planilha antiga', () => {
    expect(dimensoesValidas({ altura_cm: 0.1, largura_cm: 0.1, comprimento_cm: 0.1, peso_gramas: 100 })).toBe(false);
  });

  it('inválido com peso < 1g', () => {
    expect(dimensoesValidas({ altura_cm: 18, largura_cm: 7, comprimento_cm: 7, peso_gramas: 0 })).toBe(false);
  });

  it('inválido com alguma medida nula', () => {
    expect(dimensoesValidas({ altura_cm: null, largura_cm: 7, comprimento_cm: 7, peso_gramas: 150 })).toBe(false);
  });
});

describe('montarAtributosPacote', () => {
  it('monta os 4 SELLER_PACKAGE_* (cm/g) quando válido', () => {
    expect(montarAtributosPacote({ altura_cm: 18, largura_cm: 7, comprimento_cm: 7, peso_gramas: 150 })).toEqual([
      { id: 'SELLER_PACKAGE_HEIGHT', value_name: '18 cm' },
      { id: 'SELLER_PACKAGE_WIDTH', value_name: '7 cm' },
      { id: 'SELLER_PACKAGE_LENGTH', value_name: '7 cm' },
      { id: 'SELLER_PACKAGE_WEIGHT', value_name: '150 g' },
    ]);
  });

  it('formata sem zeros decimais supérfluos (18.00 → "18", mantém 7.5)', () => {
    expect(montarAtributosPacote({ altura_cm: 18.0, largura_cm: 7.5, comprimento_cm: 7, peso_gramas: 150.0 })).toEqual([
      { id: 'SELLER_PACKAGE_HEIGHT', value_name: '18 cm' },
      { id: 'SELLER_PACKAGE_WIDTH', value_name: '7.5 cm' },
      { id: 'SELLER_PACKAGE_LENGTH', value_name: '7 cm' },
      { id: 'SELLER_PACKAGE_WEIGHT', value_name: '150 g' },
    ]);
  });

  it('retorna [] quando inválido (não bloqueia — ML estima o frete)', () => {
    expect(montarAtributosPacote({ altura_cm: 0.1, largura_cm: 0.1, comprimento_cm: 0.1, peso_gramas: 100 })).toEqual([]);
  });
});
