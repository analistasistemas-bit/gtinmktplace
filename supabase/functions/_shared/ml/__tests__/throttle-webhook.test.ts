import { describe, expect, it } from 'vitest';
import { deveThrottlar, LIMITE_EVENTOS_JANELA } from '../throttle-webhook.ts';

describe('deveThrottlar', () => {
  it('tráfego normal (poucos eventos) não throttla', () => {
    expect(deveThrottlar(0)).toBe(false);
    expect(deveThrottlar(5)).toBe(false);
  });

  it('abaixo do limite não throttla', () => {
    expect(deveThrottlar(LIMITE_EVENTOS_JANELA - 1)).toBe(false);
  });

  it('no limite ou acima throttla', () => {
    expect(deveThrottlar(LIMITE_EVENTOS_JANELA)).toBe(true);
    expect(deveThrottlar(LIMITE_EVENTOS_JANELA + 1000)).toBe(true);
  });

  it('aceita limite customizado', () => {
    expect(deveThrottlar(3, 3)).toBe(true);
    expect(deveThrottlar(2, 3)).toBe(false);
  });
});
