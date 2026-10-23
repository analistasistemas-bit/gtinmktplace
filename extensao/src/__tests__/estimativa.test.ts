import { describe, expect, it } from 'vitest';
import { estimarVendas, estimarVendasCalibrada, faixaDoTotal } from '../compartilhado/estimativa';

const AGORA = new Date('2026-10-22T12:00:00Z');
const dias = (n: number) => new Date(AGORA.getTime() - n * 86_400_000).toISOString();

describe('estimarVendas (modelo do Avant, index.js@1232824)', () => {
  it('faixa 1000–4999, 180 dias (+15%), 100 avaliações: 0,6×1725 + 0,4×3450 = 2415', () => {
    expect(estimarVendas({ piso: 1000, avaliacoes: 100, criadoEm: dias(180), premium: false }, AGORA)).toBe(2415);
  });

  it('Premium ×1,15 (recortado na faixa)', () => {
    expect(estimarVendas({ piso: 1000, avaliacoes: 100, criadoEm: dias(180), premium: true }, AGORA)).toBe(2777);
    expect(estimarVendas({ piso: 5, avaliacoes: 0, criadoEm: null, premium: true }, AGORA)).toBe(17); // faixa 5–24: centro 15 ×1,15
  });

  it('sem idade nem avaliações → centro da faixa', () => {
    expect(estimarVendas({ piso: 50, avaliacoes: 0, criadoEm: null, premium: false }, AGORA)).toBe(75);
    expect(estimarVendas({ piso: 250000, avaliacoes: 0, criadoEm: null, premium: false }, AGORA)).toBe(375000);
  });

  it('mais de 12 meses: −25% (limitado ao piso)', () => {
    expect(estimarVendas({ piso: 100, avaliacoes: 0, criadoEm: dias(400), premium: false }, AGORA)).toBe(225); // 100–499: 300 −25%
    expect(estimarVendas({ piso: 1000, avaliacoes: 1, criadoEm: dias(400), premium: false }, AGORA)).toBe(1500);
  });

  it('1–4 é exato; patamar fora da lista → null', () => {
    expect(estimarVendas({ piso: 3, avaliacoes: 10, criadoEm: dias(10), premium: true }, AGORA)).toBe(3);
    expect(estimarVendas({ piso: 30, avaliacoes: 0, criadoEm: null, premium: false }, AGORA)).toBeNull();
    expect(estimarVendas({ piso: 20, avaliacoes: 0, criadoEm: null, premium: false }, AGORA)).toBeNull(); // +20 não existe no ML
    expect(estimarVendas({ piso: null, avaliacoes: 0, criadoEm: null, premium: false }, AGORA)).toBeNull();
  });
});

describe('faixaDoTotal (o que a página mostra para um total exato)', () => {
  // Medido em 22/10/2026 nos anúncios próprios (total exato × texto da página): 5–24 → +5, 25–49 → +25, 50–99 → +50,
  // 100–499 → +100, 670 → +500; buscas mostram +1000, +5mil, +10mil, +50mil, +100mil, +250mil, +500mil, +750mil.
  it.each([[3, 3], [7, 5], [24, 5], [25, 25], [62, 50], [274, 100], [670, 500], [1234, 1000], [5000, 5000], [30000, 10000], [600000, 500000], [800000, 750000]])('%i → %i', (total, piso) => {
    expect(faixaDoTotal(total)).toBe(piso);
  });
  it('zero → null', () => expect(faixaDoTotal(0)).toBeNull());
});

describe('estimarVendasCalibrada (emenda ADR-0189 de 23/10: só faixas validadas)', () => {
  it('+25 → 25 × 1,30 = 33 (Math.round); +50 → 50 × 1,38 = 69', () => {
    expect(estimarVendasCalibrada('+25 vendidos')).toEqual({ piso: 25, fator: 1.3, estimativa: 33, erroMedianoPct: 10 });
    expect(estimarVendasCalibrada('+50 vendidos')?.estimativa).toBe(69);
  });

  it('faixas fora da validação (+5, +100, +1000, +5 mil) → null', () => {
    for (const t of ['+5 vendidos', '+100 vendidos', '+1000 vendidos', '+5 mil vendidos']) expect(estimarVendasCalibrada(t)).toBeNull();
  });

  it('contagem exata (sem "+") e texto ausente → null', () => {
    expect(estimarVendasCalibrada('25 vendidos')).toBeNull();
    expect(estimarVendasCalibrada(null)).toBeNull();
  });
});
