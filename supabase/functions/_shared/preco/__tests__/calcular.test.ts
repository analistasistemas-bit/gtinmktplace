import { describe, it, expect } from 'vitest';
import { calcularEstrategiaPreco } from '../calcular';

describe('calcularEstrategiaPreco (ADR-0008)', () => {
  it('sem concorrência (0 vendedores) → PRÓPRIO, mantém preço da planilha', () => {
    expect(calcularEstrategiaPreco(5.85, { vendedores: 0, preco_min: null })).toEqual({
      estrategia: 'proprio',
      preco_sugerido: 5.85,
      motivo: 'sem concorrência detectada',
    });
  });

  it('concorrência mais barata que nós → COMPETITIVO (menor preço - R$ 0,01)', () => {
    expect(calcularEstrategiaPreco(5.85, { vendedores: 3, preco_min: 5.7 })).toEqual({
      estrategia: 'competitivo',
      preco_sugerido: 5.69,
      motivo: 'concorrência presente — bater menor preço',
    });
  });

  it('nosso preço já é menor que o da concorrência → PRÓPRIO (já competitivo)', () => {
    expect(calcularEstrategiaPreco(5.85, { vendedores: 4, preco_min: 5.9 })).toEqual({
      estrategia: 'proprio',
      preco_sugerido: 5.85,
      motivo: 'nosso preço já é mais competitivo que o mercado',
    });
  });

  it('concorrência com preço igual ao nosso → COMPETITIVO (bate por R$ 0,01)', () => {
    // preco_min <= preco_planilha (igual) cai no ramo competitivo
    expect(calcularEstrategiaPreco(5.85, { vendedores: 2, preco_min: 5.85 })).toEqual({
      estrategia: 'competitivo',
      preco_sugerido: 5.84,
      motivo: 'concorrência presente — bater menor preço',
    });
  });

  it('vendedores > 0 mas sem preço_min (dado incompleto) → PRÓPRIO seguro', () => {
    expect(calcularEstrategiaPreco(5.85, { vendedores: 6, preco_min: null })).toEqual({
      estrategia: 'proprio',
      preco_sugerido: 5.85,
      motivo: 'sem concorrência detectada',
    });
  });

  it('arredonda o preço sugerido para 2 casas (evita float sujo)', () => {
    const r = calcularEstrategiaPreco(10, { vendedores: 1, preco_min: 9.1 });
    expect(r.preco_sugerido).toBe(9.09);
  });
});
