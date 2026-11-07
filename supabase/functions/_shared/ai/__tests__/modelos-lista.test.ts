import { describe, expect, it } from 'vitest';
import { MODELOS_TEXTO } from '../../../../../src/lib/ai-modelos';
import { MODELO_COPY } from '../modelos';
import { custoCentavos } from '../tokens';

describe('lista de modelos de texto da tela', () => {
  it('a 1ª opção é o padrão do backend: a tela mostra ela quando a org não tem modelo gravado', () => {
    expect(MODELOS_TEXTO[0].slug).toBe(MODELO_COPY);
    expect(MODELO_COPY).toBe('openai/gpt-6-luna');
  });

  it('gpt-4.1-mini continua selecionável como saída de emergência', () => {
    expect(MODELOS_TEXTO.map((m) => m.slug)).toContain('openai/gpt-4.1-mini');
  });

  it('todo modelo da tela tem preço: sem ele o custo da família vira zero (ADR-0074)', () => {
    for (const { slug } of MODELOS_TEXTO) {
      expect(custoCentavos(slug, { prompt_tokens: 1_000_000, completion_tokens: 0 })).toBeGreaterThan(0);
    }
  });
});
