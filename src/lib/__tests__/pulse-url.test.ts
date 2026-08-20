import { describe, expect, it } from 'vitest';
import { buildPulseSearchUrl } from '../pulse-url';

describe('buildPulseSearchUrl', () => {
  it('prioriza o GTIN textual, preserva zeros iniciais e remove espaços externos', () => {
    expect(buildPulseSearchUrl({
      gtin: '  0007891234567  ',
      titulo: 'Fórmula infantil que não deve ser usada na busca',
    })).toBe('https://lista.mercadolivre.com.br/0007891234567');
  });

  it('usa o título como fallback e codifica espaços, acentos e símbolos', () => {
    const titulo = 'Fórmula infantil & premium / 800g';
    const url = buildPulseSearchUrl({ gtin: '   ', titulo });

    expect(url).toBe(`https://lista.mercadolivre.com.br/${encodeURIComponent(titulo)}`);
    expect(url).toMatch(/^https:\/\/lista\.mercadolivre\.com\.br\//);
    expect(url).not.toContain('/p/');
  });

  it('retorna null quando não há GTIN nem título utilizável', () => {
    expect(buildPulseSearchUrl({ gtin: null, titulo: null })).toBeNull();
    expect(buildPulseSearchUrl({ gtin: '  ', titulo: '  ' })).toBeNull();
  });
});
