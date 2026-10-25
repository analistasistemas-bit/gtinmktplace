import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  lerKpis: vi.fn(),
  carregarContexto: vi.fn(),
  lerVendasJanela: vi.fn(),
  montarDadosResumo: vi.fn(),
}));

vi.mock('../kpis.ts', () => ({ lerKpis: m.lerKpis }));
vi.mock('../resumo-io.ts', () => ({ montarDadosResumo: m.montarDadosResumo }));
vi.mock('../../../platform-admin/metrics-repository.ts', async (orig) => ({
  ...(await orig<object>()), carregarContexto: m.carregarContexto, lerVendasJanela: m.lerVendasJanela,
}));

import { consultarHoje, consultarMes, consultarOntem, consultarTop } from '../consultas.ts';
import { janelaDia, janelasMesCorrente } from '../janelas.ts';
import { VolumeAcimaDoLimite } from '../../../platform-admin/metrics-repository.ts';

const ORG = 'org-a';
const AGORA = new Date('2026-10-24T15:00:00Z'); // 12:00 BRT
const kpis = { faturamento: 100, pedidos: 2, ticket: 50 };
const base = { fuso: 'America/Sao_Paulo', apuradoEm: AGORA.toISOString() };

beforeEach(() => {
  vi.resetAllMocks();
  m.lerKpis.mockResolvedValue(kpis);
  m.carregarContexto.mockResolvedValue({ maps: undefined, rates: null, custosOk: true, configOk: false });
  m.lerVendasJanela.mockResolvedValue([]);
  m.montarDadosResumo.mockResolvedValue({ dia: '2026-10-23' });
});

describe('consultas estruturadas (D-9)', () => {
  it('consultarHoje: janela do dia BRT, KPIs e lucro do período', async () => {
    const r = await consultarHoje({} as any, ORG, AGORA);
    expect(r).toMatchObject({ ...base, periodo: janelaDia('2026-10-24') });
    expect(r.k.hoje).toEqual(kpis);
    expect(r.l.motivo).toBe('aliquota_nao_confirmada');
    expect(m.lerVendasJanela).toHaveBeenCalledWith(expect.anything(), ORG, janelaDia('2026-10-24'));
  });

  it('consultarMes: janela do mês corrente', async () => {
    const r = await consultarMes({} as any, ORG, AGORA);
    const jm = janelasMesCorrente(AGORA);
    expect(r).toMatchObject({ ...base, periodo: jm.mes });
    expect(r.k).toMatchObject({ mes: kpis, anterior: kpis, rotuloMes: 'Outubro' });
  });

  it('consultarTop: top, cobertura e rótulo do mês', async () => {
    const r = await consultarTop({} as any, ORG, AGORA);
    expect(r).toMatchObject({ ...base, periodo: janelasMesCorrente(AGORA).mes, top: [], rotuloMes: 'Outubro' });
    expect(r.cobertura.motivo).toBe('aliquota_nao_confirmada');
  });

  it('consultarTop propaga VolumeAcimaDoLimite', async () => {
    m.lerVendasJanela.mockRejectedValue(new VolumeAcimaDoLimite('6000 vendas'));
    await expect(consultarTop({} as any, ORG, AGORA)).rejects.toBeInstanceOf(VolumeAcimaDoLimite);
  });

  it('consultarOntem: dia anterior em BRT via montarDadosResumo', async () => {
    const r = await consultarOntem({} as any, ORG, AGORA);
    expect(r).toMatchObject({ ...base, periodo: janelaDia('2026-10-23'), dados: { dia: '2026-10-23' } });
    expect(m.montarDadosResumo).toHaveBeenCalledWith(expect.anything(), ORG, '2026-10-23', AGORA);
  });
});
