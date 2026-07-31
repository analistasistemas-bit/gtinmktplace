import { describe, expect, it } from 'vitest';
import { CODIGO_MAX, derivarCodigos } from '../produto/codigos.ts';

describe('derivarCodigos', () => {
  it('usa o menor número da faixa como PAI e os seguintes como SKU', () => {
    expect(derivarCodigos(3, 3)).toEqual({
      codigoPai: '00000001',
      codigos: ['00000002', '00000003'],
    });
  });

  it('formata sempre com oito dígitos e zeros à esquerda', () => {
    const r = derivarCodigos(10, 4);
    expect([r.codigoPai, ...r.codigos]).toEqual(
      ['00000007', '00000008', '00000009', '00000010'],
    );
    expect(r.codigoPai).toMatch(/^\d{8}$/);
  });

  it('não repete número entre PAI e SKUs', () => {
    const r = derivarCodigos(100, 5);
    const todos = [r.codigoPai, ...r.codigos];
    expect(new Set(todos).size).toBe(todos.length);
  });

  it('aceita exatamente o limite de oito dígitos', () => {
    const r = derivarCodigos(CODIGO_MAX, 2);
    expect(r.codigos.at(-1)).toBe('99999999');
  });

  it('lança ao ultrapassar o limite em vez de truncar', () => {
    expect(() => derivarCodigos(CODIGO_MAX + 1, 2)).toThrow(/esgotada/i);
  });

  it('rejeita faixa menor que PAI + uma variação', () => {
    expect(() => derivarCodigos(5, 1)).toThrow(/inválida/i);
  });

  it('rejeita faixa que começaria abaixo de 1', () => {
    expect(() => derivarCodigos(1, 3)).toThrow(/inválida/i);
  });
});
