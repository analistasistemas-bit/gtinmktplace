import { describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));
import {
  buscarPainelAds, comparacaoAds, janelaAnteriorAds, janelaBRT, periodoAds, resolverPeriodoAds,
} from '@/lib/ads-painel-dados';
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

describe('resolverPeriodoAds: mês atual termina ontem BRT, sem recuo por coleta', () => {
  const mensal = { tipo: 'mes_atual' } as const;

  it.each([
    ['2026-10-05T08:00:00-03:00', '2026-10-04T14:17:00Z'],
    ['2026-10-05T12:00:00-03:00', '2026-10-05T14:17:00Z'],
    ['2026-10-05T08:00:00-03:00', null],
    ['2026-10-05T08:00:00-03:00', '2026-10-01T14:17:00Z'],
  ])('%s com coleta %s → até 2026-10-04', (agora, sync) => {
    expect(resolverPeriodoAds(mensal, new Date(agora), sync)).toEqual({
      tipo: 'pronto',
      janela: { desde: '2026-10-01', ate: '2026-10-04' },
    });
  });

  it.each([
    ['2026-10-01T08:00:00-03:00', null, '2026-10-01', '2026-09-30'],
    ['2026-10-01T12:00:00-03:00', '2026-10-01T14:17:00Z', '2026-10-01', '2026-09-30'],
    ['2027-01-01T12:00:00-03:00', null, '2027-01-01', '2026-12-31'],
  ])('aguarda o 1º dia fechado em %s', (agora, sync, inicioMes, fimDisponivel) => {
    expect(resolverPeriodoAds(mensal, new Date(agora), sync)).toEqual({
      tipo: 'aguardando_mes', janela: null, inicioMes, fimDisponivel,
    });
  });

  it('dia 2 libera o dia 1, com ou sem coleta', () => {
    expect(resolverPeriodoAds(mensal, new Date('2026-10-02T08:00:00-03:00'), null))
      .toEqual({ tipo: 'pronto', janela: { desde: '2026-10-01', ate: '2026-10-01' } });
  });

  it('usa setembro quando UTC já está em outubro', () => {
    expect(resolverPeriodoAds(mensal, new Date('2026-10-01T02:30:00Z'), null))
      .toEqual({ tipo: 'pronto', janela: { desde: '2026-09-01', ate: '2026-09-29' } });
  });

  it('respeita fevereiro bissexto', () => {
    expect(resolverPeriodoAds(mensal, new Date('2028-02-29T15:00:00-03:00'), null))
      .toEqual({ tipo: 'pronto', janela: { desde: '2028-02-01', ate: '2028-02-28' } });
  });

  it.each([7, 30, 90] as const)('preset de %i dias termina ontem mesmo com coleta em anteontem', dias => {
    const agora = new Date('2026-10-05T08:00:00-03:00');
    const r = resolverPeriodoAds({ tipo: 'preset', dias }, agora, '2026-10-04T14:17:00Z');
    expect(r).toEqual({ tipo: 'pronto', janela: { desde: expect.any(String), ate: '2026-10-04' } });
    expect(r).toEqual(resolverPeriodoAds({ tipo: 'preset', dias }, agora, null));
  });
});

describe('resolverPeriodoAds: preset, virada UTC e range', () => {
  const agora = new Date('2026-10-05T08:00:00-03:00');
  it('preset e mês atual terminam em ontem', () => {
    expect(resolverPeriodoAds({ tipo: 'preset', dias: 7 }, agora, null))
      .toEqual({ tipo: 'pronto', janela: { desde: '2026-09-28', ate: '2026-10-04' } });
    expect(resolverPeriodoAds({ tipo: 'mes_atual' }, agora, null))
      .toEqual({ tipo: 'pronto', janela: { desde: '2026-10-01', ate: '2026-10-04' } });
  });
  it('ontem BRT na virada de dia em UTC: 22:30 BRT de 04/10 já é 05/10 em UTC', () => {
    const quase = new Date('2026-10-04T22:30:00-03:00'); // 2026-10-05T01:30Z
    expect(resolverPeriodoAds({ tipo: 'preset', dias: 7 }, quase, null))
      .toEqual({ tipo: 'pronto', janela: { desde: '2026-09-27', ate: '2026-10-03' } });
    const depois = new Date('2026-10-05T00:10:00-03:00');
    expect(resolverPeriodoAds({ tipo: 'preset', dias: 7 }, depois, null))
      .toEqual({ tipo: 'pronto', janela: { desde: '2026-09-28', ate: '2026-10-04' } });
  });
  it('dia 1º: mês atual aguarda o primeiro dia fechado', () => {
    expect(resolverPeriodoAds({ tipo: 'mes_atual' }, new Date('2026-10-01T09:00:00-03:00'), null))
      .toEqual({ tipo: 'aguardando_mes', janela: null, inicioMes: '2026-10-01', fimDisponivel: '2026-09-30' });
  });
  it('range válido, inclusive fevereiro de ano bissexto', () => {
    expect(resolverPeriodoAds({ tipo: 'range', desde: '2028-02-28', ate: '2028-02-29' }, new Date('2028-03-10T09:00:00-03:00'), null))
      .toEqual({ tipo: 'pronto', janela: { desde: '2028-02-28', ate: '2028-02-29' } });
  });
  it.each([
    ['2026-02-29', '2026-03-02', 'data_invalida'],
    ['2026-13-01', '2026-13-02', 'data_invalida'],
    ['04/10/2026', '2026-10-04', 'data_invalida'],
    ['2026-10-04', '2026-10-01', 'ordem'],
    ['2026-10-01', '2026-10-05', 'futuro'], // hoje ainda não fechou
    ['2026-07-05', '2026-10-01', 'fora_da_retencao'], // hoje − 92
  ])('range %s → %s recusa com motivo %s', (desde, ate, motivo) => {
    expect(resolverPeriodoAds({ tipo: 'range', desde, ate }, agora, null)).toEqual({ tipo: 'invalido', janela: null, motivo });
  });
  it('retenção: hoje − 91 passa, hoje − 92 recusa', () => {
    expect(resolverPeriodoAds({ tipo: 'range', desde: '2026-07-06', ate: '2026-10-04' }, agora, null).tipo).toBe('pronto');
    expect(resolverPeriodoAds({ tipo: 'range', desde: '2026-07-05', ate: '2026-10-04' }, agora, null).tipo).toBe('invalido');
  });
  it('a coleta não desloca a janela (preset e range)', () => {
    expect(resolverPeriodoAds({ tipo: 'preset', dias: 7 }, agora, '2026-10-04T14:17:00Z'))
      .toEqual({ tipo: 'pronto', janela: { desde: '2026-09-28', ate: '2026-10-04' } });
    expect(resolverPeriodoAds({ tipo: 'range', desde: '2026-10-01', ate: '2026-10-04' }, agora, '2026-10-01T14:17:00Z'))
      .toEqual({ tipo: 'pronto', janela: { desde: '2026-10-01', ate: '2026-10-04' } });
  });
});

describe('janelaAnteriorAds / comparacaoAds', () => {
  const agora = new Date('2026-10-05T08:00:00-03:00');
  it('sete dias atuais → sete dias anteriores, sem dia compartilhado', () => {
    expect(janelaAnteriorAds({ desde: '2026-09-28', ate: '2026-10-04' })).toEqual({ desde: '2026-09-21', ate: '2026-09-27' });
  });
  it('um dia → o dia anterior', () => {
    expect(janelaAnteriorAds({ desde: '2026-10-04', ate: '2026-10-04' })).toEqual({ desde: '2026-10-03', ate: '2026-10-03' });
  });
  it('mês de 31 dias atravessando fevereiro bissexto mantém a duração', () => {
    expect(janelaAnteriorAds({ desde: '2028-03-01', ate: '2028-03-31' })).toEqual({ desde: '2028-01-30', ate: '2028-02-29' });
    expect(janelaAnteriorAds({ desde: '2027-03-01', ate: '2027-03-31' })).toEqual({ desde: '2027-01-29', ate: '2027-02-28' });
  });
  it('comparação disponível dentro da retenção', () => {
    expect(comparacaoAds({ desde: '2026-09-28', ate: '2026-10-04' }, agora))
      .toEqual({ tipo: 'pronta', janela: { desde: '2026-09-21', ate: '2026-09-27' } });
  });
  it('anterior que começa antes de hoje − 91 fica indisponível, não truncada', () => {
    expect(comparacaoAds({ desde: '2026-07-06', ate: '2026-10-04' }, agora))
      .toEqual({ tipo: 'indisponivel', motivo: 'fora_da_retencao' });
    expect(comparacaoAds({ desde: '2026-09-28', ate: '2026-10-04' }, new Date('2027-01-05T08:00:00-03:00')).tipo).toBe('indisponivel');
  });
});
