import { describe, it, expect } from 'vitest';
import {
  validarColunas,
  normalizarCodigo,
  matchImagem,
  matchCapa,
} from '../../supabase/functions/_shared/parser';

describe('validarColunas', () => {
  it('aceita quando todas as colunas obrigatórias estão presentes', () => {
    const cols = ['CODIGO','PAI','NOME','UNIDADE','GTIN','PRECO','ESTOQUE','DESCRICAO_DETALHADO','PESO_GRAMAS','ALTURA_CM','LARGURA_CM','COMPRIMENTO_CM'];
    expect(() => validarColunas(cols)).not.toThrow();
  });
  it('lança quando falta coluna', () => {
    const cols = ['CODIGO','PAI','NOME'];
    expect(() => validarColunas(cols)).toThrow(/UNIDADE|GTIN|PRECO/);
  });
});

describe('normalizarCodigo', () => {
  it('zero-pad para 8 dígitos', () => {
    expect(normalizarCodigo(123)).toBe('00000123');
    expect(normalizarCodigo('123')).toBe('00000123');
    expect(normalizarCodigo('00000123')).toBe('00000123');
  });
});

// Cobertura de agruparPorPai (incluindo as anomalias do ADR-0013) vive em
// supabase/functions/_shared/__tests__/parser.test.ts.

describe('matchImagem', () => {
  it('encontra imagem por nome 00CODIGO.jpeg', () => {
    const paths = ['u1/l1/00000100.jpeg', 'u1/l1/00000101.jpeg', 'u1/l1/00000102.jpeg'];
    expect(matchImagem('100', paths)).toBe('u1/l1/00000100.jpeg');
    expect(matchImagem('101', paths)).toBe('u1/l1/00000101.jpeg');
  });
  it('aceita PNG, JPG, JPEG', () => {
    const paths = ['u1/l1/00000200.png'];
    expect(matchImagem('200', paths)).toBe('u1/l1/00000200.png');
  });
  it('retorna undefined se não houver match', () => {
    expect(matchImagem('999', ['u1/l1/00000100.jpeg'])).toBeUndefined();
  });
  it('NÃO casa arquivo de capa como imagem de variação', () => {
    expect(matchImagem('449253', ['u1/l1/CAPA_00449253.jpg'])).toBeUndefined();
  });
});

describe('matchCapa', () => {
  it('encontra a capa por CAPA_00CODIGO.ext (case-insensitive, jpg/jpeg/png)', () => {
    const paths = ['u1/l1/00220566.jpeg', 'u1/l1/CAPA_00449253.jpg'];
    expect(matchCapa('449253', paths)).toBe('u1/l1/CAPA_00449253.jpg');
    expect(matchCapa('00449253', ['u1/l1/capa_00449253.png'])).toBe('u1/l1/capa_00449253.png');
  });
  it('não confunde imagem de variação com capa', () => {
    expect(matchCapa('220566', ['u1/l1/00220566.jpeg'])).toBeUndefined();
  });
  it('retorna undefined quando não há capa para o código', () => {
    expect(matchCapa('449253', ['u1/l1/CAPA_00111111.jpg'])).toBeUndefined();
  });
});
