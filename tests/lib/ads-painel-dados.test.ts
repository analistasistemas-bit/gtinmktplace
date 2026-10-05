import { describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));
import { buscarPainelAds, janelaBRT, periodoAds } from '@/lib/ads-painel-dados';
import { fimDiasAds } from '@/lib/sku-ads';
import { dentroDaJanela } from '@/lib/vendas-sku';

describe('periodoAds', () => {
  it('30 dias inteiros terminando ontem (BRT), mesmo às 00:30', () => {
    expect(periodoAds(30, new Date('2026-10-04T00:30:00-03:00'), null)).toEqual({ desde: '2026-09-04', ate: '2026-10-03' });
    expect(periodoAds(7, new Date('2026-10-04T23:50:00-03:00'), null)).toEqual({ desde: '2026-09-27', ate: '2026-10-03' });
  });
  // A coleta roda às 11:17 BRT e lê até D-1: antes dela "ontem" ainda não existe (achado D2 da validação).
  const MANHA = new Date('2026-10-05T08:00:00-03:00');
  const TARDE = new Date('2026-10-05T12:00:00-03:00');
  it('fim = último dia coletado quando ele é anteontem (recuo de no máximo 1 dia)', () => {
    expect(fimDiasAds(MANHA, '2026-10-04T14:17:00Z')).toBe('2026-10-03');
    expect(fimDiasAds(TARDE, '2026-10-05T14:17:00Z')).toBe('2026-10-04');
  });
  it('sem coleta, ou worker parado há mais de 1 dia → ontem (a cobertura falha e o aviso cobre)', () => {
    expect(fimDiasAds(MANHA, null)).toBe('2026-10-04');
    expect(fimDiasAds(MANHA, '2026-10-02T14:17:00Z')).toBe('2026-10-04');
  });
  it('N dias inteiros terminando no fim coletado', () => {
    const u = '2026-10-04T14:17:00Z';
    expect(periodoAds(7, MANHA, u)).toEqual({ desde: '2026-09-27', ate: '2026-10-03' });
    expect(periodoAds(30, MANHA, u)).toEqual({ desde: '2026-09-04', ate: '2026-10-03' });
    expect(periodoAds(90, MANHA, u)).toEqual({ desde: '2026-07-06', ate: '2026-10-03' });
  });
});
describe('janelaBRT', () => {
  it('limites BRT exatos, iguais em qualquer fuso do navegador', () => {
    expect(janelaBRT('2026-09-04', '2026-10-03')).toEqual({ desde: '2026-09-04T03:00:00.000Z', ate: '2026-10-04T02:59:59.999Z' });
  });
  it('vira o mês e o ano', () => {
    expect(janelaBRT('2026-12-31', '2026-12-31')).toEqual({ desde: '2026-12-31T03:00:00.000Z', ate: '2027-01-01T02:59:59.999Z' });
  });
  it('venda às 23:30 BRT de ontem entra; 00:10 BRT de hoje fica fora', () => {
    const j = janelaBRT('2026-09-04', '2026-10-03');
    expect(dentroDaJanela('2026-10-03T23:30:00-03:00', j)).toBe(true);
    expect(dentroDaJanela('2026-10-04T00:10:00-03:00', j)).toBe(false);
  });
});
describe('buscarPainelAds', () => {
  it('converte numeric (string) para number', async () => {
    rpc.mockResolvedValue({ data: { sync: null, conta: [{ dia: '2026-09-01', cost: '1.5', clicks: 1, prints: 2,
      direct_amount: '0', indirect_amount: '0', total_amount: '3', coletado_em: 'x' }], grupos: [] }, error: null });
    const f = await buscarPainelAds('2026-09-01', '2026-09-01');
    expect(rpc).toHaveBeenCalledWith('ads_painel', { p_desde: '2026-09-01', p_ate: '2026-09-01' });
    expect(f.conta[0].cost).toBe(1.5);
    expect(f.conta[0].total_amount).toBe(3);
  });
  it('erro da RPC propaga', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(buscarPainelAds('2026-09-01', '2026-09-01')).rejects.toThrow('boom');
  });
});
