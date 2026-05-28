import { describe, it, expect } from 'vitest';
import { custoCentavos } from '../tokens';

describe('custoCentavos', () => {
  it('calcula custo para gpt-4o-mini', () => {
    // 1000 input + 500 output:
    // input: 1.0 * $0.015 = $0.015
    // output: 0.5 * $0.060 = $0.030
    // total: $0.045 = 4.5 centavos -> ceil -> 5
    expect(custoCentavos('openai/gpt-4o-mini', { prompt_tokens: 1000, completion_tokens: 500 })).toBe(5);
  });

  it('calcula custo para gpt-4o', () => {
    // 1000 input + 500 output:
    // input: 1.0 * $2.50 = $2.50
    // output: 0.5 * $10.00 = $5.00
    // total: $7.50 = 750 centavos
    expect(custoCentavos('openai/gpt-4o', { prompt_tokens: 1000, completion_tokens: 500 })).toBe(750);
  });

  it('retorna 0 para modelo desconhecido', () => {
    expect(custoCentavos('foo/bar', { prompt_tokens: 1000, completion_tokens: 500 })).toBe(0);
  });

  it('arredonda pra cima (ceil)', () => {
    // Custo de 0.0001 centavos vira 1 centavo
    expect(custoCentavos('openai/gpt-4o-mini', { prompt_tokens: 1, completion_tokens: 0 })).toBe(1);
  });

  it('tolera zero tokens', () => {
    expect(custoCentavos('openai/gpt-4o-mini', { prompt_tokens: 0, completion_tokens: 0 })).toBe(0);
  });
});
