import { describe, expect, it } from 'vitest';
import { avaliarAltaFrete } from '../monitor-frete.ts';
import { montarMensagemAltaFrete } from '../../notificacoes/telegram.ts';

describe('avaliarAltaFrete', () => {
  it('alta real (+62%, +R$9,50): dispara', () => {
    expect(avaliarAltaFrete(24.9, 15.4)).toEqual({ diferenca: 9.5, pct: 62 });
  });
  it('exatamente +10% não dispara (precisa ser maior)', () => {
    expect(avaliarAltaFrete(22, 20)).toBeNull();
  });
  it('+10,05% e +R$2,01: dispara', () => {
    expect(avaliarAltaFrete(22.01, 20)).toEqual({ diferenca: 2.01, pct: 10 });
  });
  it('acima de 10% mas menos de R$2: não dispara', () => {
    expect(avaliarAltaFrete(11.99, 10)).toBeNull();
  });
  it('R$2 mas menos de 10%: não dispara', () => {
    expect(avaliarAltaFrete(32, 30)).toBeNull();
  });
  it('queda não dispara', () => {
    expect(avaliarAltaFrete(10, 20)).toBeNull();
  });
  it.each([
    [null, 10], [10, null], [0, 10], [10, 0], [-1, 10],
  ])('frete %s vs %s (nulo/zero/negativo): não compara', (atual, anterior) => {
    expect(avaliarAltaFrete(atual as number | null, anterior as number | null)).toBeNull();
  });
});

describe('montarMensagemAltaFrete', () => {
  it('traz título, MLB, os dois valores e o %', () => {
    const msg = montarMensagemAltaFrete({ titulo: 'Shampoo X', mlItemId: 'MLB123', atual: 24.9, anterior: 15.4, pct: 62 });
    expect(msg).toContain('Frete subiu');
    expect(msg).toContain('Shampoo X');
    expect(msg).toContain('MLB123');
    expect(msg).toContain('24,90');
    expect(msg).toContain('15,40');
    expect(msg).toContain('+62%');
  });
  it('sem título usa o MLB', () => {
    expect(montarMensagemAltaFrete({ titulo: null, mlItemId: 'MLB9', atual: 30, anterior: 20, pct: 50 })).toContain('MLB9');
  });
});
