import { describe, it, expect, vi } from 'vitest';
import { custoCentavos } from '../tokens';

describe('custoCentavos', () => {
  // Preços reais OpenRouter (alinhados ao que roda em produção):
  //   gpt-4o-mini: $0.15/1M input, $0.60/1M output
  //   gpt-4o:      $2.50/1M input, $10.00/1M output
  it('calcula o custo real do gpt-4o-mini (referência por 1M tokens)', () => {
    // 1M input = $0.15 = 15 centavos
    expect(custoCentavos('openai/gpt-4o-mini', { prompt_tokens: 1_000_000, completion_tokens: 0 })).toBe(15);
    // 1M output = $0.60 = 60 centavos
    expect(custoCentavos('openai/gpt-4o-mini', { prompt_tokens: 0, completion_tokens: 1_000_000 })).toBe(60);
  });

  it('calcula o custo real do gpt-4o (referência por 1M tokens)', () => {
    // 1M input = $2.50 = 250 centavos
    expect(custoCentavos('openai/gpt-4o', { prompt_tokens: 1_000_000, completion_tokens: 0 })).toBe(250);
    // 1M output = $10.00 = 1000 centavos
    expect(custoCentavos('openai/gpt-4o', { prompt_tokens: 0, completion_tokens: 1_000_000 })).toBe(1000);
  });

  it('retorna 0 para modelo desconhecido', () => {
    expect(custoCentavos('foo/bar', { prompt_tokens: 1000, completion_tokens: 500 })).toBe(0);
  });

  it('arredonda pra cima (ceil) — uma copy típica custa fração de centavo', () => {
    // gpt-4o-mini, 1000 in + 500 out ≈ $0.00045 → 0.045 centavos → ceil → 1
    expect(custoCentavos('openai/gpt-4o-mini', { prompt_tokens: 1000, completion_tokens: 500 })).toBe(1);
  });

  it('tolera zero tokens', () => {
    expect(custoCentavos('openai/gpt-4o-mini', { prompt_tokens: 0, completion_tokens: 0 })).toBe(0);
  });

  it('calcula o custo real do deepseek/deepseek-v4-flash (referência por 1M tokens)', () => {
    // 1M input = $0.09 = 9 centavos
    expect(custoCentavos('deepseek/deepseek-v4-flash', { prompt_tokens: 1_000_000, completion_tokens: 0 })).toBe(9);
    // 1M output = $0.18 = 18 centavos
    expect(custoCentavos('deepseek/deepseek-v4-flash', { prompt_tokens: 0, completion_tokens: 1_000_000 })).toBe(18);
  });

  it('avisa (console.warn) quando o modelo está fora de PRECOS; não avisa para modelo conhecido', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      custoCentavos('modelo/inexistente', { prompt_tokens: 1000, completion_tokens: 500 });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toContain('modelo/inexistente');
      spy.mockClear();
      custoCentavos('openai/gpt-4o-mini', { prompt_tokens: 1000, completion_tokens: 500 });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
