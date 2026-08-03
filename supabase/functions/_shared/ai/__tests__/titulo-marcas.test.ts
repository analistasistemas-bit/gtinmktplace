import { describe, it, expect } from 'vitest';
import { marcaDoFornecedor } from '../titulo-marcas';

describe('marcaDoFornecedor', () => {
  it('corrige a grafia e o acento da marca', () => {
    expect(marcaDoFornecedor('BUFALO')).toBe('Búfalo');
    expect(marcaDoFornecedor('CIRCULO S.A.')).toBe('Círculo');
  });

  it('resolve razão social truncada para a marca comercial', () => {
    expect(marcaDoFornecedor('FABRICA DE BARBANTE BANDEIRANT')).toBe('Bandeirante');
    expect(marcaDoFornecedor('BR17-COATS CORRENTE LTDA')).toBe('Corrente');
    expect(marcaDoFornecedor('LINHAS SETTA LTDA')).toBe('Setta');
  });

  it('devolve null quando a razão social não tem marca comercial identificável', () => {
    expect(marcaDoFornecedor('V.R.MACHADO SILK SREEN EM GERA')).toBeNull();
    expect(marcaDoFornecedor('S.PROCHOWNIK COMERCIAL LTDA')).toBeNull();
  });

  it('NUNCA devolve o nome da loja como marca', () => {
    expect(marcaDoFornecedor('AVIL')).toBeNull();
    expect(marcaDoFornecedor('DS')).toBeNull();
  });

  it('fornecedor fora do mapa não bloqueia nada — devolve null e o fluxo segue pela fonte', () => {
    expect(marcaDoFornecedor('FORNECEDOR NOVO QUALQUER')).toBeNull();
    expect(marcaDoFornecedor(null)).toBeNull();
    expect(marcaDoFornecedor('')).toBeNull();
  });
});
