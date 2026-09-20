import { describe, it, expect } from 'vitest';
import { resolverCorValueId } from '../value-id';

// Valores reais de COLOR em MLB108803 (GET /categories/{id}/attributes, 2026-09-20).
const VALORES = [
  { id: '52049', nome: 'Preto' },
  { id: '52055', nome: 'Branco' },
  { id: '283161', nome: 'Azul-marinho' },
  { id: '52029', nome: 'Azul-claro' },
  { id: '52021', nome: 'Azul-celeste' },
  { id: '52005', nome: 'Marrom' },
  { id: '283149', nome: 'Coral' },
  { id: '52028', nome: 'Azul' },
];

describe('resolverCorValueId', () => {
  it('casa o nome do cadastro com o dicionário ignorando hífen e caixa', () => {
    // O ML escreve "Azul-marinho"; o operador cadastra "Azul Marinho".
    expect(resolverCorValueId('Azul Marinho', VALORES)).toBe('283161');
    expect(resolverCorValueId('azul claro', VALORES)).toBe('52029');
    expect(resolverCorValueId('AZUL-CELESTE', VALORES)).toBe('52021');
  });

  it('casa ignorando acento', () => {
    expect(resolverCorValueId('Còral', VALORES)).toBe('283149');
  });

  it('devolve null para cor que não existe no dicionário da categoria', () => {
    // Incidente 2026-09-20: 9 das 15 cores da jaqueta não existem em MLB108803.
    expect(resolverCorValueId('Azul Royal', VALORES)).toBeNull();
    expect(resolverCorValueId('Amarelo Manteiga', VALORES)).toBeNull();
  });

  it('não casa por prefixo — "Azul" nunca vira "Azul-marinho"', () => {
    expect(resolverCorValueId('Azul', VALORES)).toBe('52028');
    expect(resolverCorValueId('Azul Petróleo', VALORES)).toBeNull();
  });

  it('tolera vazio, nulo e lista vazia', () => {
    expect(resolverCorValueId(null, VALORES)).toBeNull();
    expect(resolverCorValueId('  ', VALORES)).toBeNull();
    expect(resolverCorValueId('Preto', [])).toBeNull();
  });
});
