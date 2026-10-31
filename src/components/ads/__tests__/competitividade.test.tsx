import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  BlocoAdsMetricas, MetricaBrutaAds, RespostaAdsMetricas, ValorAds,
} from '../../../../supabase/functions/_shared/ads/metricas';

vi.mock('@/hooks/useAdsMetricas', () => ({ useAdsMetricas: vi.fn() }));

import { useAdsMetricas } from '@/hooks/useAdsMetricas';
import { Competitividade } from '../campanhas/competitividade';

const ok = (valor: number): ValorAds => ({ valor, motivo: null });
type Res = Partial<Record<MetricaBrutaAds, ValorAds>>;
const resposta = (resumo: Res, over: Partial<RespostaAdsMetricas> = {}): RespostaAdsMetricas => ({
  ok: true, estado: 'ok', escopo: 'competitividade',
  atual: { janela: { desde: '2026-10-01', ate: '2026-10-07' }, resumo, serie: [], completo: true, lidoEm: '2026-10-08T10:00:00Z' } as BlocoAdsMetricas,
  anterior: null, campanhas: [],
  comparacao: { estado: 'desligada', motivo: null },
  disponibilidade: { desde: '2026-01-01', ate: '2026-10-07', fuso: 'America/Sao_Paulo' },
  avisos: [], ...over,
});
const COMPLETO: Res = {
  impression_share: ok(0.13), lost_impression_share_by_budget: ok(0.17), lost_impression_share_by_ad_rank: ok(0.7),
  top_impression_share: { valor: null, motivo: 'resposta_invalida' },
};
const PEDIDO = { desde: '2026-10-01', ate: '2026-10-07', comparar: 'anterior' as const };
const mock = vi.mocked(useAdsMetricas);
const ret = (data?: RespostaAdsMetricas, extra: object = {}) =>
  ({ data, isLoading: false, isFetching: false, isError: false, refetch: vi.fn(), ...extra }) as never;
const expandir = () => userEvent.click(screen.getByRole('button', { name: /ver competitividade/i }));

beforeEach(() => mock.mockReset());

describe('Competitividade', () => {
  it('só consulta depois de expandir, com escopo competitividade e a comparação da tela (prova pelas duas janelas)', async () => {
    mock.mockReturnValue(ret());
    render(<Competitividade campanhaId={7} pedido={PEDIDO} />);
    expect(mock.mock.calls.every(([, hab]) => hab === false)).toBe(true);
    await expandir();
    const [pedido, hab] = mock.mock.calls.at(-1)!;
    expect(hab).toBe(true);
    expect(pedido).toMatchObject({ escopo: 'competitividade', campanhaId: 7, comparar: 'anterior', desde: '2026-10-01', ate: '2026-10-07' });
  });

  it('mostra rótulos, percentuais e explicações visíveis', async () => {
    mock.mockReturnValue(ret(resposta(COMPLETO)));
    render(<Competitividade campanhaId={7} pedido={PEDIDO} />);
    await expandir();
    expect(screen.getByText('Ganhas')).toBeInTheDocument();
    expect(screen.getByText('Perdidas por orçamento')).toBeInTheDocument();
    expect(screen.getByText('Perdidas por classificação')).toBeInTheDocument();
    expect(screen.getByText('13,0%')).toBeInTheDocument();
    expect(screen.getByText('17,0%')).toBeInTheDocument();
    expect(screen.getByText('70,0%')).toBeInTheDocument();
    expect(screen.getByText(/orçamento diário acabou/i)).toBeInTheDocument();
    expect(screen.getByText(/lance ou a qualidade/i)).toBeInTheDocument();
  });

  it('campo ausente não vira zero: mostra o motivo', async () => {
    const { lost_impression_share_by_budget: _, ...sem } = COMPLETO;
    mock.mockReturnValue(ret(resposta(sem)));
    render(<Competitividade campanhaId={7} pedido={PEDIDO} />);
    await expandir();
    expect(screen.getByText('13,0%')).toBeInTheDocument();
    expect(screen.queryByText('0,0%')).not.toBeInTheDocument();
    expect(screen.getByText(/o ml não retornou esta métrica/i)).toBeInTheDocument();
  });

  it('top_impression_share não substitui impression_share', async () => {
    const { impression_share: _, ...sem } = COMPLETO;
    mock.mockReturnValue(ret(resposta({ ...sem, top_impression_share: ok(0.9) })));
    render(<Competitividade campanhaId={7} pedido={PEDIDO} />);
    await expandir();
    expect(screen.queryByText('90,0%')).not.toBeInTheDocument();
    expect(screen.getByText(/o ml não retornou esta métrica/i)).toBeInTheDocument();
  });

  it('valor fora de 0–1 vira indisponível com resposta inválida', async () => {
    mock.mockReturnValue(ret(resposta({ ...COMPLETO, lost_impression_share_by_budget: ok(-0.1), lost_impression_share_by_ad_rank: ok(1.2) })));
    render(<Competitividade campanhaId={7} pedido={PEDIDO} />);
    await expandir();
    expect(screen.queryByText(/-10,0%|−10,0%|120,0%/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/resposta inválida do ml/i)).toHaveLength(2);
    expect(screen.getByText('13,0%')).toBeInTheDocument();
  });

  it('zero e um explícitos são válidos', async () => {
    mock.mockReturnValue(ret(resposta({ ...COMPLETO, impression_share: ok(1), lost_impression_share_by_budget: ok(0), lost_impression_share_by_ad_rank: ok(0) })));
    render(<Competitividade campanhaId={7} pedido={PEDIDO} />);
    await expandir();
    expect(screen.getByText('100,0%')).toBeInTheDocument();
    expect(screen.getAllByText('0,0%')).toHaveLength(2);
    expect(screen.queryByText(/resposta inválida/i)).not.toBeInTheDocument();
  });

  it('erro mostra o motivo sem lançar', async () => {
    mock.mockReturnValue(ret(undefined, { isError: true }));
    render(<Competitividade campanhaId={7} pedido={PEDIDO} />);
    await expandir();
    expect(screen.getByText(/não foi possível ler a competitividade/i)).toBeInTheDocument();
  });

  // I1a: forma real da recusa do handler — o motivo vem em `avisos` (comparacaoDoPedido reescreve `comparacao`).
  it('estado recusado mostra o motivo da resposta', async () => {
    mock.mockReturnValue(ret(resposta({}, { estado: 'sem_acesso', atual: null, comparacao: { estado: 'desligada', motivo: null },
      avisos: ['Campanha não pertence ao anunciante.'] })));
    render(<Competitividade campanhaId={7} pedido={PEDIDO} />);
    await expandir();
    expect(screen.getByText(/campanha não pertence ao anunciante/i)).toBeInTheDocument();
  });

  // I1b: E3 que falhou volta 'parcial' com resumo {} — não são três barras "o ML não retornou".
  it('leitura parcial (E3 falhou): indisponível com motivo, sem barras', async () => {
    const parcial = resposta({}, { estado: 'parcial', avisos: ['Limite de leitura atingido; dados incompletos.'] });
    parcial.atual = { ...parcial.atual!, completo: false };
    mock.mockReturnValue(ret(parcial));
    render(<Competitividade campanhaId={7} pedido={PEDIDO} />);
    await expandir();
    expect(screen.getByText(/Competitividade indisponível: Limite de leitura atingido/)).toBeInTheDocument();
    expect(screen.queryByText('Ganhas')).toBeNull();
  });
});
