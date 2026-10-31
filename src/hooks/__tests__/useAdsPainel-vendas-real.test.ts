// /ads com o useVendasSku REAL: só as fontes abaixo dele (vendas, custos, alíquotas, devoluções, catálogo) e as do
// Ads (RPC, códigos, métricas ao vivo, org) são mockadas. O catálogo entra no lucro da conta (historicoDesde vem
// da primeira venda do catálogo), mas erro dele não é erro geral: vai para os blocos.
import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { montarMapasCusto } from '@/lib/custos';
import type { FontePainelAds } from '@/lib/ads-painel';
import type { PedidoAdsMetricas, RespostaAdsMetricas } from '../../../supabase/functions/_shared/ads/metricas';

const q = (data: unknown, extra: object = {}) => ({ data, isLoading: false, isFetching: false, isError: false,
  refetch: vi.fn().mockResolvedValue(undefined), ...extra });
const m = vi.hoisted(() => ({
  buscarPainelAds: vi.fn(), buscarCodigosMlbs: vi.fn(), buscarUltimoOkAds: vi.fn(), buscarMetricasAds: vi.fn(),
  catQ: {} as Record<string, unknown>,
  vendas: [] as unknown[], custos: [] as Record<string, unknown>[],
}));
vi.mock('@/hooks/useOrgEfetivaId', () => ({ useOrgEfetivaId: () => 'org-a' }));
vi.mock('@/lib/ads-painel-dados', async (orig) => ({ ...(await orig<object>()), buscarPainelAds: m.buscarPainelAds }));
vi.mock('@/lib/sku-dossie-dados', () => ({ buscarCodigosMlbs: m.buscarCodigosMlbs, buscarUltimoOkAds: m.buscarUltimoOkAds }));
vi.mock('@/lib/ads-metricas-dados', () => ({ buscarMetricasAds: m.buscarMetricasAds }));
vi.mock('@/hooks/useVendas', () => ({ useVendas: () => q(m.vendas) }));
vi.mock('@/hooks/useCustos', () => ({ useCustos: () => q(montarMapasCusto(m.custos as never)) }));
vi.mock('@/hooks/useConfiguracoes', () => ({
  useAliquotas: () => q({ nacional: 8, importado: 16, confirmada: true, ufEmpresa: null, internaPct: null }) }));
vi.mock('@/hooks/useDevolucoes', () => ({ useDevolucoes: () => q([]) }));
vi.mock('@/hooks/useCatalogoVendasSku', () => ({ useCatalogoVendasSku: () => m.catQ }));
vi.mock('@/hooks/useFotosProduto', () => ({ useFotosProduto: () => q(undefined) }));
vi.mock('@/hooks/useCoresProduto', () => ({ useCoresProduto: () => q(undefined) }));
vi.mock('@/hooks/useAnuncioCanonico', () => ({ useAnuncioCanonico: () => q(undefined) }));

const { useAdsPainel } = await import('../useAdsPainel');

const CATALOGO = [{ codigo: 'A1', codigoPai: 'A', nomeFamilia: 'Fam A', nome: 'A1', cor: null, tamanho: null, estoque: 0,
  fornecedor: null, origem: 'nacional', ehKit: false, primeiraVenda: '2026-01-01T03:00:00.000Z', ultimaVenda: null,
  kitMultiplicador: null, kitBaseCodigo: null, estoqueKit: null }];
const FONTE: FontePainelAds = { sync: null, conta: [], grupos: [{ ad_group_id: 1, tipo: 'FAMILY', status: 'ACTIVE', cost: 10,
  clicks: 0, prints: 0, direct_amount: 0, indirect_amount: 0, total_amount: 0, membros: ['MLB1'] }] };
const somarDia = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const val = (valor: number) => ({ valor, motivo: null });
function respostaConta(p: PedidoAdsMetricas): RespostaAdsMetricas {
  const serie = [];
  for (let dia = p.desde; dia <= p.ate; dia = somarDia(dia)) {
    serie.push({ dia, metricas: { cost: val(1), clicks: val(0), prints: val(0), direct_amount: val(0), total_amount: val(0) } });
  }
  return { ok: true, estado: 'ok', escopo: 'conta', atual: { janela: { desde: p.desde, ate: p.ate }, resumo: {}, serie,
    completo: true, lidoEm: '2026-10-05T15:00:00Z' }, anterior: null, campanhas: [],
    comparacao: { estado: 'desligada', motivo: null }, disponibilidade: { desde: p.desde, ate: p.ate, fuso: 'America/Sao_Paulo' },
    avisos: [] };
}
const render = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useAdsPainel({ tipo: 'preset', dias: 30 }), {
    wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children) });
};

beforeEach(() => {
  m.buscarPainelAds.mockReset().mockResolvedValue(FONTE);
  m.buscarCodigosMlbs.mockReset().mockResolvedValue(new Map([['MLB1', ['A1']]]));
  m.buscarUltimoOkAds.mockReset().mockResolvedValue(null);
  m.buscarMetricasAds.mockReset().mockImplementation(async (p: PedidoAdsMetricas) => respostaConta(p));
  m.catQ = q(CATALOGO);
  m.vendas = [];
  m.custos = [];
});

describe('useAdsPainel com useVendasSku real', () => {
  it.each([['anterior', { valor: 0, motivo: null }], ['nenhum', null]] as const)(
    'comparar %s: faturamento anterior só existe com comparação (useVendasSku real)', async (comparar, anterior) => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const r = renderHook(() => useAdsPainel({ tipo: 'preset', dias: 30 }, comparar), {
        wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children) });
      await waitFor(() => expect(r.result.current.faturamentoConta).not.toBeNull());
      expect(r.result.current.faturamentoConta!.anterior).toEqual(anterior);
      expect(m.buscarMetricasAds).toHaveBeenCalledWith(expect.objectContaining({ comparar, escopo: 'conta' }));
    });

  // C1: denominador do TACOS só com o histórico de vendas cobrindo a janela (atual e anterior, cada uma por si).
  it('histórico de vendas começa depois do início da janela: faturamento indisponível com motivo, nunca truncado', async () => {
    const recente = new Date(Date.now() - 5 * 86_400_000).toISOString();
    m.catQ = q([{ ...CATALOGO[0], primeiraVenda: recente }]);
    const r = render();
    await waitFor(() => expect(r.result.current.faturamentoConta).not.toBeNull());
    expect(r.result.current.faturamentoConta).toEqual({
      atual: { valor: null, motivo: 'sem_historico' }, anterior: { valor: null, motivo: 'sem_historico' } });
  });

  it('histórico cobre a atual mas não a anterior: só o anterior fica indisponível', async () => {
    const meio = new Date(Date.now() - 45 * 86_400_000).toISOString();
    m.catQ = q([{ ...CATALOGO[0], primeiraVenda: meio }]);
    const r = render();
    await waitFor(() => expect(r.result.current.faturamentoConta).not.toBeNull());
    expect(r.result.current.faturamentoConta).toEqual({
      atual: { valor: 0, motivo: null }, anterior: { valor: null, motivo: 'sem_historico' } });
  });

  it('catálogo pendente ou com erro: faturamento indisponível (histórico desconhecido), nunca o das vendas soltas', async () => {
    for (const extra of [{ isLoading: true }, { isError: true }]) {
      m.catQ = q(undefined, extra);
      const r = render();
      await waitFor(() => expect(r.result.current.faturamentoConta).not.toBeNull());
      expect(r.result.current.faturamentoConta!.atual).toEqual({ valor: null, motivo: 'sem_historico' });
    }
  });

  it('catálogo pendente: a conta espera (historicoDesde vem dele), sem erro geral', async () => {
    m.catQ = q(undefined, { isLoading: true });
    const r = render();
    await waitFor(() => expect(m.buscarMetricasAds).toHaveBeenCalled());
    await waitFor(() => expect(r.result.current.metricasConta).not.toBeNull());
    expect(r.result.current.resultadoConta).toBeNull();
    expect(r.result.current.painel).toBeNull();
    expect(r.result.current.blocos.conta.isLoading).toBe(true);
    expect(r.result.current.isError).toBe(false);
  });

  it('catálogo com erro: erro nos blocos com motivo, nunca erro geral nem skeleton eterno', async () => {
    m.catQ = q(undefined, { isError: true });
    const r = render();
    await waitFor(() => expect(r.result.current.metricasConta).not.toBeNull());
    expect(r.result.current.isError).toBe(false);
    expect(r.result.current.isLoading).toBe(false);
    expect(r.result.current.blocos.conta).toEqual({ isLoading: false, isError: true, motivo: 'catalogo' });
    expect(r.result.current.blocos.grupos.isError).toBe(true);
    expect(r.result.current.resultadoConta).toBeNull();
  });

  it('RPC/códigos pendentes ou com erro: conta completa com lucro conhecido', async () => {
    m.buscarPainelAds.mockReturnValue(new Promise(() => {}));
    const r = render();
    await waitFor(() => expect(r.result.current.resultadoConta?.conta).toBeTruthy());
    const conta = r.result.current.resultadoConta!.conta!;
    // Sem venda faturável: lucro 0 real (histórico coberto pelo catálogo, alíquotas confirmadas), investimento ao vivo.
    expect(conta.lucroAntes).toBe(0);
    expect(conta.resultado).toBe(-conta.custo);
    expect(conta.custo).toBeGreaterThan(0);
    expect(r.result.current.painel).toBeNull();
    expect(r.result.current.blocos.grupos.isLoading).toBe(true);
    expect(r.result.current.isError).toBe(false);

    m.buscarPainelAds.mockRejectedValue(new Error('rpc'));
    const r2 = render();
    await waitFor(() => expect(r2.result.current.blocos.grupos.isError).toBe(true));
    await waitFor(() => expect(r2.result.current.resultadoConta?.conta?.lucroAntes).toBe(0));
    expect(r2.result.current.isError).toBe(false);

    m.buscarPainelAds.mockResolvedValue(FONTE);
    m.buscarCodigosMlbs.mockRejectedValue(new Error('cod'));
    const r3 = render();
    await waitFor(() => expect(r3.result.current.blocos.grupos.isError).toBe(true));
    await waitFor(() => expect(r3.result.current.resultadoConta?.conta?.lucroAntes).toBe(0));
    expect(r3.result.current.isError).toBe(false);
  });

  // I3 pré-merge: venda sem origem fiscal só na janela anterior não bloqueia o resultado atual.
  it.each(['nenhum', 'anterior'] as const)('comparar %s: origem não resolvida só na anterior → resultado atual liberado', async (comparar) => {
    m.custos = [{ custo: 40, peso_gramas: 100, ml_variation_id: null, gtin: null, codigo: 'B1', atualizado_em: '2026-01-01',
      familias: { ml_item_id: 'MLB-B1', origem: null } }];
    m.vendas = [{ id: '1', order_id: 1, pack_id: null, status: 'paid', date_closed: new Date(Date.now() - 45 * 86_400_000).toISOString(),
      total_amount: 100, cupom_vendedor: 0, liquido: 100, sale_fee_total: 0, estorno: 0, uf: 'SP', is_publiai: false,
      canal: 'mercado_livre', itens: [{ id: 'x', ml_item_id: 'MLB-B1', variation_id: null, titulo: 'B1', codigo: 'B1', cor: null,
        ean: null, quantity: 1, unit_price: 100, sale_fee: 0, is_publiai: false, cupom_vendedor: 0 }] }];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const r = renderHook(() => useAdsPainel({ tipo: 'preset', dias: 30 }, comparar), {
      wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children) });
    await waitFor(() => expect(r.result.current.resultadoConta?.conta).toBeTruthy());
    expect(r.result.current.resultadoConta!.conta!.motivoFiscal).toBeNull();
    expect(r.result.current.resultadoConta!.conta!.lucroAntes).toBe(0);
  });
});
