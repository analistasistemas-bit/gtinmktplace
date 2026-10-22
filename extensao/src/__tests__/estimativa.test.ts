import { describe, expect, it } from 'vitest';
import { estimarVendas, faixaDoTotal } from '../compartilhado/estimativa';

const AGORA = new Date('2026-10-22T12:00:00Z');
const dias = (n: number) => new Date(AGORA.getTime() - n * 86_400_000).toISOString();

describe('estimarVendas (modelo do Avant, index.js@1232824)', () => {
  it('faixa 1000–4999, 180 dias (+15%), 100 avaliações: 0,6×1725 + 0,4×3450 = 2415', () => {
    expect(estimarVendas({ piso: 1000, avaliacoes: 100, criadoEm: dias(180), premium: false }, AGORA)).toBe(2415);
  });

  it('Premium ×1,15 (recortado na faixa)', () => {
    expect(estimarVendas({ piso: 1000, avaliacoes: 100, criadoEm: dias(180), premium: true }, AGORA)).toBe(2777);
    expect(estimarVendas({ piso: 5, avaliacoes: 0, criadoEm: null, premium: true }, AGORA)).toBe(8);
  });

  it('sem idade nem avaliações → centro da faixa', () => {
    expect(estimarVendas({ piso: 50, avaliacoes: 0, criadoEm: null, premium: false }, AGORA)).toBe(75);
    expect(estimarVendas({ piso: 250000, avaliacoes: 0, criadoEm: null, premium: false }, AGORA)).toBe(375000);
  });

  it('mais de 12 meses: −25% (limitado ao piso)', () => {
    expect(estimarVendas({ piso: 100, avaliacoes: 0, criadoEm: dias(400), premium: false }, AGORA)).toBe(113);
    expect(estimarVendas({ piso: 1000, avaliacoes: 1, criadoEm: dias(400), premium: false }, AGORA)).toBe(1500);
  });

  it('1–4 é exato; patamar fora da lista → null', () => {
    expect(estimarVendas({ piso: 3, avaliacoes: 10, criadoEm: dias(10), premium: true }, AGORA)).toBe(3);
    expect(estimarVendas({ piso: 30, avaliacoes: 0, criadoEm: null, premium: false }, AGORA)).toBeNull();
    expect(estimarVendas({ piso: null, avaliacoes: 0, criadoEm: null, premium: false }, AGORA)).toBeNull();
  });
});

describe('faixaDoTotal (o que a página mostra para um total exato)', () => {
  it.each([[3, 3], [7, 5], [1234, 1000], [4999, 1000], [5000, 5000], [600000, 250000]])('%i → %i', (total, piso) => {
    expect(faixaDoTotal(total)).toBe(piso);
  });
  it('zero → null', () => expect(faixaDoTotal(0)).toBeNull());
});
