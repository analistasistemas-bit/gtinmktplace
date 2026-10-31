// Painel de Ads: fontes mockadas (vendas, catálogo, RPC do Ads, códigos dos MLBs, métricas ao vivo, org); a regra
// (montarPainelAds) e a agregação de vendas (vendas-sku) rodam de verdade, com espião para ver o que recebem.
import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { somarAcumuladores, metricas, type AcumuladorSku, type LinhaSku } from '@/lib/vendas-sku';
import { janelaBRT } from '@/lib/ads-painel-dados';
import type { FontePainelAds } from '@/lib/ads-painel';
import type { PedidoAdsMetricas, RespostaAdsMetricas } from '../../../supabase/functions/_shared/ads/metricas';

const m = vi.hoisted(() => ({
  buscarPainelAds: vi.fn(), buscarCodigosMlbs: vi.fn(), buscarUltimoOkAds: vi.fn(), useVendasSku: vi.fn(), montarPainelAds: vi.fn(),
  buscarMetricasAds: vi.fn(), org: 'org-a' as string | null,
  catQ: { data: undefined as unknown, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() },
}));
vi.mock('@/lib/ads-painel-dados', async (orig) => ({ ...(await orig<object>()), buscarPainelAds: m.buscarPainelAds }));
vi.mock('@/lib/sku-dossie-dados', () => ({ buscarCodigosMlbs: m.buscarCodigosMlbs, buscarUltimoOkAds: m.buscarUltimoOkAds }));
vi.mock('@/hooks/useVendasSku', () => ({ useVendasSku: m.useVendasSku }));
vi.mock('@/hooks/useCatalogoVendasSku', () => ({ useCatalogoVendasSku: () => m.catQ }));
vi.mock('@/lib/ads-metricas-dados', () => ({ buscarMetricasAds: m.buscarMetricasAds }));
vi.mock('@/hooks/useOrgEfetivaId', () => ({ useOrgEfetivaId: () => m.org }));
vi.mock('@/lib/ads-painel', async (orig) => {
  const real = await orig<typeof import('@/lib/ads-painel')>();
  m.montarPainelAds.mockImplementation(real.montarPainelAds);
  return { ...real, montarPainelAds: m.montarPainelAds };
});

const { useAdsPainel } = await import('../useAdsPainel');

const grupo = (id: number, membros: string[]) => ({ ad_group_id: id, tipo: 'FAMILY' as const, status: 'ACTIVE', cost: 10,
  clicks: 0, prints: 0, direct_amount: 0, indirect_amount: 0, total_amount: 0, membros });
const FONTE: FontePainelAds = { sync: null, conta: [], grupos: [grupo(1, ['MLB3', 'MLB1']), grupo(2, ['MLB1', 'MLB2'])] };

function linha(codigo: string, codigoPai: string | null, over: Partial<AcumuladorSku>): LinhaSku {
  const acc = { ...somarAcumuladores([]), ...over };
  return { codigo, codigoPai, nomeFamilia: codigoPai, acc, m: metricas(acc) } as unknown as LinhaSku;
}
// isError do mock = erro das próprias vendas (o de catálogo é coberto em useAdsPainel-vendas-real.test.ts).
const vendasQ = (linhas: LinhaSku[] | null, extra: { isError?: boolean; [k: string]: unknown } = {}) => ({
  dados: linhas && { linhas, historicoDesde: '2026-01-01T03:00:00.000Z' },
  baseFiscal: linhas && { ok: true },
  faturamentoConta: linhas && { atual: 1000, anterior: 800 },
  isLoading: false, isFetching: false, isError: false, refetch: vi.fn().mockResolvedValue([]), ...extra,
  erros: { vendas: extra.isError ?? false, catalogo: false, devolucoes: false },
});

const somarDia = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const diasDe = (desde: string, ate: string) => {
  const r: string[] = [];
  for (let d = desde; d <= ate; d = somarDia(d)) r.push(d);
  return r;
};
const val = (valor: number) => ({ valor, motivo: null });
/** Leitura ao vivo da conta: R$ 1 por dia do pedido, todos os campos presentes. */
function respostaConta(p: PedidoAdsMetricas, over: { completo?: boolean } = {}): RespostaAdsMetricas {
  const serie = diasDe(p.desde, p.ate).map((dia) => ({ dia, metricas: {
    cost: val(1), clicks: val(0), prints: val(0), direct_amount: val(0), total_amount: val(0) } }));
  const bloco = { janela: { desde: p.desde, ate: p.ate }, resumo: {}, serie, completo: over.completo ?? true,
    lidoEm: '2026-10-05T15:00:00Z' };
  return { ok: true, estado: 'ok', escopo: 'conta', atual: bloco, anterior: null, campanhas: [],
    comparacao: { estado: 'desligada', motivo: null }, disponibilidade: { desde: p.desde, ate: p.ate, fuso: 'America/Sao_Paulo' },
    avisos: [] };
}

let qcAtual: QueryClient;
function criarWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  qcAtual = qc;

  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

const render = () => renderHook(
  () => useAdsPainel({ tipo: 'preset', dias: 30 }),
  { wrapper: criarWrapper() },
);

function pendente<T>() {
  let resolver!: (valor: T) => void;
  const promise = new Promise<T>(resolve => {
    resolver = resolve;
  });
  return { promise, resolver };
}
// Duas montagens independentes: a dos grupos (fonte da RPC) e a da conta (fonte vazia, só série ao vivo + vendas).
const chamadasGrupos = () => m.montarPainelAds.mock.calls.filter((c) => c[0].fonte.grupos.length > 0);
const chamadasConta = () => m.montarPainelAds.mock.calls.filter((c) => c[0].fonte.grupos.length === 0);
const ultimaChamada = () => chamadasGrupos().at(-1)![0];

beforeEach(() => {
  m.buscarPainelAds.mockReset().mockResolvedValue(FONTE);
  m.buscarCodigosMlbs.mockReset().mockResolvedValue(new Map([['MLB1', ['A1']]]));
  m.buscarUltimoOkAds.mockReset().mockResolvedValue(null);
  m.useVendasSku.mockReset().mockReturnValue(vendasQ([]));
  m.montarPainelAds.mockClear();
  m.buscarMetricasAds.mockReset().mockImplementation(async (p: PedidoAdsMetricas) => respostaConta(p));
  m.org = 'org-a';
  Object.assign(m.catQ, { data: [{ codigo: 'A1', codigoPai: 'A', nomeFamilia: 'Fam A' }], isLoading: false, isFetching: false,
    isError: false, refetch: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => vi.useRealTimers());

describe('useAdsPainel', () => {
  it('(a) vendas no mesmo recorte do Ads: range com os dias da janela e janela BRT explícita', async () => {
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    const { janela } = r.result.current;
    if (!janela) throw new Error('O período deveria estar pronto');
    expect(m.useVendasSku).toHaveBeenLastCalledWith({ tipo: 'range', ...janela }, janelaBRT(janela.desde, janela.ate), true,
      expect.anything());
    expect(m.buscarPainelAds).toHaveBeenCalledWith(janela.desde, janela.ate);
    expect(ultimaChamada().janela).toEqual(janela);
  });

  it('(a2) historicoDesde vem das vendas', async () => {
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    expect(ultimaChamada().historicoDesde).toBe('2026-01-01T03:00:00.000Z');
    expect(r.result.current.historicoDesde).toBe('2026-01-01T03:00:00.000Z');
  });

  it('(a4) sem venda faturável → lucro 0 real; só vendas sem custo → lucro null sem_custo', async () => {
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    expect(ultimaChamada().lucroConta).toEqual({ lucro: 0, fonteCusto: 'real' });

    m.useVendasSku.mockReturnValue(vendasQ([linha('A1', 'A', { pedidos: 1, unidades: 1, bruto: 10, itensSemCusto: 1 })]));
    const r2 = render();
    await waitFor(() => expect(r2.result.current.painel).not.toBeNull());
    expect(ultimaChamada().lucroConta).toEqual({ lucro: null, fonteCusto: 'sem_custo' });
    expect(ultimaChamada().lucroPorFamilia.get('A')).toEqual({ nome: 'A', lucro: null, brutoComCusto: 0, fonteCusto: 'sem_custo', markup: null });
  });

  it('(a5) fiscal: a base fiscal das vendas chega ao painel; inválida bloqueia, ok (alíquota zero confirmada) libera', async () => {
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    expect(ultimaChamada().baseFiscal).toEqual({ ok: true });

    const bloqueio = { ok: false, motivo: 'aliquotas_nao_confirmadas' };
    m.useVendasSku.mockReturnValue(vendasQ([], { baseFiscal: bloqueio }));
    const r2 = render();
    await waitFor(() => expect(r2.result.current.painel).not.toBeNull());
    expect(ultimaChamada().baseFiscal).toEqual(bloqueio);
    expect(r2.result.current.painel!.familias.every((f) => f.lucroAntes == null && f.resultado == null)).toBe(true);
  });

  it('(b) códigos buscados para os MLBs únicos e ordenados de todos os grupos', async () => {
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    expect(m.buscarCodigosMlbs).toHaveBeenCalledWith(['MLB1', 'MLB2', 'MLB3']);
    expect(ultimaChamada().familiaDoCodigo).toEqual(new Map([['A1', 'A']]));
  });

  it('(c) painel null até vendas, catálogo e códigos chegarem', async () => {
    m.useVendasSku.mockReturnValue(vendasQ(null, { isLoading: true }));
    const r = render();
    await waitFor(() => expect(m.buscarCodigosMlbs).toHaveBeenCalled());
    expect(r.result.current.painel).toBeNull();
    expect(r.result.current.isLoading).toBe(true);

    m.useVendasSku.mockReturnValue(vendasQ([]));
    m.catQ.data = undefined;
    const r2 = render();
    await waitFor(() => expect(m.buscarCodigosMlbs).toHaveBeenCalledTimes(2));
    expect(r2.result.current.painel).toBeNull();

    m.catQ.data = [];
    m.buscarCodigosMlbs.mockReturnValue(new Promise(() => {}));
    const r3 = render();
    await waitFor(() => expect(m.buscarCodigosMlbs).toHaveBeenCalledTimes(3));
    expect(r3.result.current.painel).toBeNull();
    expect(chamadasGrupos()).toHaveLength(0);
  });

  it('(d) erro de fonte dos grupos fica no bloco dos grupos; erro de vendas é geral', async () => {
    m.buscarPainelAds.mockRejectedValue(new Error('rpc'));
    const r = render();
    await waitFor(() => expect(r.result.current.blocos.grupos.isError).toBe(true));
    expect(r.result.current.isError).toBe(false);

    m.buscarPainelAds.mockResolvedValue(FONTE);
    m.buscarCodigosMlbs.mockRejectedValue(new Error('cod'));
    const r2 = render();
    await waitFor(() => expect(r2.result.current.blocos.grupos.isError).toBe(true));
    expect(r2.result.current.isError).toBe(false);

    m.buscarCodigosMlbs.mockResolvedValue(new Map());
    m.useVendasSku.mockReturnValue(vendasQ(null, { isError: true }));
    const r3 = render();
    await waitFor(() => expect(r3.result.current.isError).toBe(true));

    m.useVendasSku.mockReturnValue(vendasQ([]));
    m.catQ.isError = true;
    const r4 = render();
    await waitFor(() => expect(r4.result.current.blocos.grupos.isError).toBe(true));
    expect(r4.result.current.isError).toBe(false);
  });

  it('RPC/códigos pendentes ou com erro: resultado da conta sai com vendas + fiscal + série ao vivo completas', async () => {
    m.buscarPainelAds.mockReturnValue(new Promise(() => {}));
    const r = render();
    await waitFor(() => expect(r.result.current.resultadoConta?.conta).toBeTruthy());
    const { janela } = r.result.current;
    expect(r.result.current.resultadoConta!.conta!.custo).toBe(diasDe(janela!.desde, janela!.ate).length);
    expect(r.result.current.resultadoConta!.motivo).toBeNull();
    // Composição depende dos grupos: não sai no resultado da conta (nunca zero presumido).
    expect(r.result.current.resultadoConta!.conta).not.toHaveProperty('emFamilias');
    expect(r.result.current.painel).toBeNull();
    expect(r.result.current.blocos.grupos.isLoading).toBe(true);
    expect(r.result.current.isLoading).toBe(false);

    m.buscarPainelAds.mockResolvedValue(FONTE);
    m.buscarCodigosMlbs.mockRejectedValue(new Error('cod'));
    const r2 = render();
    await waitFor(() => expect(r2.result.current.blocos.grupos.isError).toBe(true));
    await waitFor(() => expect(r2.result.current.resultadoConta?.conta).toBeTruthy());
    expect(r2.result.current.painel).toBeNull();
    expect(r2.result.current.isError).toBe(false);
  });

  it('(e) período termina ontem BRT, mesmo com a coleta do dia ainda não feita', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-05T08:00:00-03:00') });
    m.buscarUltimoOkAds.mockResolvedValue('2026-10-04T14:17:00Z');
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    expect(r.result.current.janela).toEqual({ desde: '2026-09-05', ate: '2026-10-04' });
    expect(m.buscarPainelAds).toHaveBeenCalledWith('2026-09-05', '2026-10-04');
    expect(m.buscarPainelAds).toHaveBeenCalledTimes(1);
  });

  it('(f) finanças da conta iniciam sem sync pronto; erro no sync fica no bloco do sync', async () => {
    m.buscarUltimoOkAds.mockReturnValue(new Promise(() => {}));
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    const { janela } = r.result.current;
    expect(m.buscarPainelAds).toHaveBeenCalledWith(janela!.desde, janela!.ate);
    expect(m.buscarMetricasAds).toHaveBeenCalledWith(expect.objectContaining({ escopo: 'conta', ...janela }));
    expect(m.useVendasSku.mock.calls.at(-1)![2]).toBe(true);
    // FONTE.sync null: grupos sem cobertura, mas a conta sai da série ao vivo (plano §5.6.3).
    expect(r.result.current.painel!.gruposCobertos).toBe(false);
    expect(r.result.current.painel!.conta).not.toBeNull();
    expect(r.result.current.painel!.conta!.custo).toBe(diasDe(janela!.desde, janela!.ate).length);
    expect(r.result.current.ultimoOkEm).toBeNull();

    m.buscarUltimoOkAds.mockRejectedValue(new Error('rls'));
    const r2 = render();
    await waitFor(() => expect(r2.result.current.blocos.sync.isError).toBe(true));
    await waitFor(() => expect(r2.result.current.painel).not.toBeNull());
    expect(r2.result.current.isError).toBe(false);
  });

  it('vendas do canal ML com a janela anterior exata; métricas da conta no mesmo recorte', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-05T12:00:00-03:00') });
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    expect(r.result.current.comparacao).toEqual({ tipo: 'pronta', janela: { desde: '2026-08-06', ate: '2026-09-04' } });
    expect(m.useVendasSku.mock.calls.at(-1)![3]).toEqual({ canal: 'mercado_livre', anteriorFixa: janelaBRT('2026-08-06', '2026-09-04') });
    expect(m.buscarMetricasAds).toHaveBeenCalledWith(expect.objectContaining({
      desde: '2026-09-05', ate: '2026-10-04', comparar: 'anterior', escopo: 'conta' }));
    expect(r.result.current.faturamentoConta).toEqual({ atual: 1000, anterior: 800 });
    expect(r.result.current.metricasConta?.escopo).toBe('conta');
  });

  it('"Sem comparação": não pede a janela anterior nas vendas nem nas métricas', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-05T12:00:00-03:00') });
    const r = renderHook(() => useAdsPainel({ tipo: 'preset', dias: 30 }, 'nenhum'), { wrapper: criarWrapper() });
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    expect(r.result.current.comparacao).toBeNull();
    expect(m.useVendasSku.mock.calls.at(-1)![3]).toEqual({ canal: 'mercado_livre', anteriorFixa: undefined });
    expect(m.buscarMetricasAds).toHaveBeenCalledWith(expect.objectContaining({ comparar: 'nenhum', escopo: 'conta' }));
    expect(m.buscarMetricasAds).not.toHaveBeenCalledWith(expect.objectContaining({ comparar: 'anterior' }));
  });

  it('comparação fora da retenção: sem janela anterior nas vendas e métricas sem comparar', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-05T12:00:00-03:00') });
    const r = renderHook(() => useAdsPainel({ tipo: 'preset', dias: 90 }), { wrapper: criarWrapper() });
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    expect(r.result.current.comparacao).toEqual({ tipo: 'indisponivel', motivo: 'fora_da_retencao' });
    expect(m.useVendasSku.mock.calls.at(-1)![3]).toEqual({ canal: 'mercado_livre', anteriorFixa: undefined });
    expect(m.buscarMetricasAds).toHaveBeenCalledWith(expect.objectContaining({ comparar: 'nenhum', escopo: 'conta' }));
  });

  it('org em todas as chaves de consulta do hook', async () => {
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    const chaves = qcAtual.getQueryCache().getAll().map((q) => q.queryKey);
    expect(chaves.length).toBeGreaterThanOrEqual(4);
    for (const k of chaves) expect(k).toContain('org-a');
  });

  it('sem org: nenhuma consulta financeira dispara', async () => {
    m.org = null;
    const r = render();
    await waitFor(() => expect(r.result.current.situacaoPeriodo).toBe('pronto'));
    expect(m.buscarPainelAds).not.toHaveBeenCalled();
    expect(m.buscarMetricasAds).not.toHaveBeenCalled();
    expect(m.useVendasSku.mock.calls.every((c) => c[2] === false)).toBe(true);
    expect(r.result.current.painel).toBeNull();
  });

  it('troca de org com respostas pendentes: nada da org anterior entra na nova tela', async () => {
    const FONTE_A: FontePainelAds = { sync: null, conta: [], grupos: [grupo(7, ['MLB7'])] };
    const fonteA = pendente<FontePainelAds>();
    const metricasA = pendente<RespostaAdsMetricas>();
    m.buscarPainelAds.mockImplementation(() => (m.org === 'org-a' ? fonteA.promise : Promise.resolve(FONTE)));
    m.buscarMetricasAds.mockImplementation((p: PedidoAdsMetricas) =>
      (m.org === 'org-a' ? metricasA.promise : Promise.resolve(respostaConta(p))));
    const r = render();
    await waitFor(() => expect(m.buscarPainelAds).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(m.buscarMetricasAds).toHaveBeenCalledTimes(1));
    const pedidoA = m.buscarMetricasAds.mock.calls[0][0] as PedidoAdsMetricas;

    m.org = 'org-b';
    r.rerender();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());

    await act(async () => {
      fonteA.resolver(FONTE_A);
      metricasA.resolver(respostaConta(pedidoA, { completo: false }));
      await fonteA.promise;
      await metricasA.promise;
    });

    expect(chamadasGrupos().every((c) => c[0].fonte === FONTE)).toBe(true);
    expect(m.montarPainelAds.mock.calls.every((c) => c[0].contaAoVivo.completo)).toBe(true);
    expect(r.result.current.painel!.conta).not.toBeNull();
    expect(r.result.current.resultadoConta!.conta).not.toBeNull();
  });

  it('série ao vivo incompleta → conta indisponível com motivo, sem recair na coleta', async () => {
    m.buscarMetricasAds.mockImplementation(async (p: PedidoAdsMetricas) => respostaConta(p, { completo: false }));
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    expect(ultimaChamada().contaAoVivo).toEqual(expect.objectContaining({ completo: false }));
    expect(r.result.current.painel!.conta).toBeNull();
    expect(r.result.current.painel!.contaMotivo).toBe('serie_incompleta');
    expect(r.result.current.resultadoConta).toEqual({ conta: null, motivo: 'serie_incompleta' });
  });

  it('métricas da conta sem leitura (atual null) ou com erro → conta indisponível, nunca a série coletada', async () => {
    m.buscarMetricasAds.mockImplementation(async (p: PedidoAdsMetricas) => ({ ...respostaConta(p), estado: 'sem_acesso', atual: null }));
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    expect(ultimaChamada().contaAoVivo).toEqual(expect.objectContaining({ completo: false }));
    expect(r.result.current.painel!.contaMotivo).toBe('serie_incompleta');

    m.buscarMetricasAds.mockRejectedValue(new Error('edge'));
    const r2 = render();
    await waitFor(() => expect(r2.result.current.blocos.conta.isError).toBe(true));
    await waitFor(() => expect(r2.result.current.painel).not.toBeNull());
    expect(r2.result.current.painel!.contaMotivo).toBe('serie_incompleta');
  });

  it('série ao vivo pendente: grupos saem já carregados, sem a série coletada e sem resultado da conta', async () => {
    m.buscarMetricasAds.mockReturnValue(new Promise(() => {}));
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    expect(r.result.current.painel!.familias.length).toBeGreaterThan(0);
    // Nunca `undefined`: montarPainelAds recairia na série coletada.
    expect(chamadasGrupos().every((c) => c[0].contaAoVivo && c[0].contaAoVivo.completo === false)).toBe(true);
    expect(chamadasConta()).toHaveLength(0);
    expect(r.result.current.resultadoConta).toBeNull();
    expect(r.result.current.blocos.conta.isLoading).toBe(true);
    expect(r.result.current.blocos.grupos.isLoading).toBe(false);
  });

  it('(g) nome da família do catálogo vai como fallback', async () => {
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    expect(ultimaChamada().nomeDaFamilia).toEqual(new Map([['A', 'Fam A']]));
  });

  it('mês atual usa a mesma janela em Ads, vendas e montagem', async () => {
    vi.useFakeTimers({
      toFake: ['Date'],
      now: new Date('2026-10-05T08:00:00-03:00'),
    });
    m.buscarUltimoOkAds.mockResolvedValue('2026-10-04T14:17:00Z');

    const { result } = renderHook(
      () => useAdsPainel({ tipo: 'mes_atual' }),
      { wrapper: criarWrapper() },
    );

    await waitFor(() => expect(result.current.painel).not.toBeNull());

    const janela = { desde: '2026-10-01', ate: '2026-10-04' };

    expect(result.current.janela).toEqual(janela);
    expect(m.buscarPainelAds).toHaveBeenCalledWith(janela.desde, janela.ate);
    expect(m.useVendasSku).toHaveBeenLastCalledWith(
      { tipo: 'range', ...janela },
      janelaBRT(janela.desde, janela.ate),
      true,
      expect.anything(),
    );
    expect(ultimaChamada().janela).toEqual(janela);
  });

  it('mês aguardando não consulta finanças nem herda erro de vendas', async () => {
    vi.useFakeTimers({
      toFake: ['Date'],
      now: new Date('2026-10-01T12:00:00-03:00'),
    });
    m.buscarUltimoOkAds.mockResolvedValue('2026-10-01T14:17:00Z');
    m.useVendasSku.mockReturnValue(vendasQ(null, { isError: true }));

    const { result } = renderHook(
      () => useAdsPainel({ tipo: 'mes_atual' }),
      { wrapper: criarWrapper() },
    );

    await waitFor(() =>
      expect(result.current.situacaoPeriodo).toBe('aguardando_mes'),
    );

    expect(result.current.janela).toBeNull();
    expect(result.current.painel).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(m.buscarPainelAds).not.toHaveBeenCalled();
    expect(m.buscarCodigosMlbs).not.toHaveBeenCalled();
    expect(m.montarPainelAds).not.toHaveBeenCalled();
    expect(m.useVendasSku.mock.calls.every(call => call[2] === false)).toBe(true);
  });

  it('recalcula o mês no próximo render, sem timer próprio', async () => {
    vi.useFakeTimers({
      toFake: ['Date'],
      now: new Date('2026-09-30T15:00:00-03:00'),
    });
    m.buscarUltimoOkAds.mockResolvedValue(null);

    const { result, rerender } = renderHook(
      () => useAdsPainel({ tipo: 'mes_atual' }),
      { wrapper: criarWrapper() },
    );

    await waitFor(() => expect(result.current.painel).not.toBeNull());
    expect(result.current.janela).toEqual({
      desde: '2026-09-01',
      ate: '2026-09-29',
    });

    m.buscarPainelAds.mockClear();
    m.montarPainelAds.mockClear();

    vi.setSystemTime(new Date('2026-10-01T12:00:00-03:00'));
    rerender();

    expect(result.current.situacaoPeriodo).toBe('aguardando_mes');
    expect(result.current.janela).toBeNull();
    expect(result.current.painel).toBeNull();
    expect(m.buscarPainelAds).not.toHaveBeenCalled();
    expect(m.montarPainelAds).not.toHaveBeenCalled();
  });

  it('ignora a resposta tardia do preset anterior', async () => {
    vi.useFakeTimers({
      toFake: ['Date'],
      now: new Date('2026-10-05T12:00:00-03:00'),
    });

    const antiga = pendente<FontePainelAds>();
    m.buscarUltimoOkAds.mockResolvedValue(null);
    m.buscarPainelAds.mockImplementation((desde: string) =>
      desde === '2026-09-05' ? antiga.promise : Promise.resolve(FONTE),
    );

    const { result, rerender } = renderHook(
      ({ dias }: { dias: 7 | 30 }) => useAdsPainel({ tipo: 'preset', dias }),
      { initialProps: { dias: 30 }, wrapper: criarWrapper() },
    );

    await waitFor(() =>
      expect(m.buscarPainelAds).toHaveBeenCalledWith('2026-09-05', '2026-10-04'),
    );

    rerender({ dias: 7 });

    await waitFor(() => expect(result.current.painel).not.toBeNull());
    expect(result.current.janela).toEqual({
      desde: '2026-09-28',
      ate: '2026-10-04',
    });

    await act(async () => {
      antiga.resolver(FONTE);
      await antiga.promise;
    });

    expect(ultimaChamada().janela).toEqual({
      desde: '2026-09-28',
      ate: '2026-10-04',
    });
  });

  it('catálogo carregando: painel null e grupos carregando; a conta não espera', async () => {
    Object.assign(m.catQ, { data: undefined, isLoading: true });
    const r = render();
    await waitFor(() => expect(r.result.current.situacaoPeriodo).toBe('pronto'));
    await waitFor(() => expect(m.buscarCodigosMlbs).toHaveBeenCalled());
    expect(r.result.current.painel).toBeNull();
    expect(r.result.current.blocos.grupos.isLoading).toBe(true);
    await waitFor(() => expect(r.result.current.resultadoConta?.conta).toBeTruthy());
  });

  it('erro de catálogo: erro no bloco dos grupos, sem skeleton permanente nem erro geral', async () => {
    Object.assign(m.catQ, { data: undefined, isError: true });
    const r = render();
    await waitFor(() => expect(r.result.current.situacaoPeriodo).toBe('pronto'));
    expect(r.result.current.blocos.grupos.isError).toBe(true);
    expect(r.result.current.blocos.grupos.isLoading).toBe(false);
    expect(r.result.current.isError).toBe(false);
  });

  it('refetch da mesma janela repete RPC, códigos, vendas e catálogo', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-05T12:00:00-03:00') });
    m.buscarUltimoOkAds.mockResolvedValue('2026-10-05T14:17:00Z');
    const v = vendasQ([]);
    m.useVendasSku.mockReturnValue(v);
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    m.buscarPainelAds.mockClear();
    m.buscarCodigosMlbs.mockClear();

    await act(async () => {
      await r.result.current.refetch();
    });

    expect(m.buscarPainelAds).toHaveBeenCalledTimes(1);
    expect(m.buscarPainelAds).toHaveBeenCalledWith('2026-09-05', '2026-10-04');
    expect(m.buscarCodigosMlbs).toHaveBeenCalledTimes(1);
    expect(v.refetch).toHaveBeenCalledTimes(1);
    expect(m.catQ.refetch).toHaveBeenCalledTimes(1);
    expect(m.buscarMetricasAds).toHaveBeenLastCalledWith(expect.objectContaining({ escopo: 'conta', fresco: true }));
  });

  it('range válido chega ao hook: janela, RPC e vendas usam as datas escolhidas', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-05T12:00:00-03:00') });
    const { result } = renderHook(
      () => useAdsPainel({ tipo: 'range', desde: '2026-09-10', ate: '2026-09-20' }),
      { wrapper: criarWrapper() },
    );
    await waitFor(() => expect(result.current.painel).not.toBeNull());
    expect(result.current.janela).toEqual({ desde: '2026-09-10', ate: '2026-09-20' });
    expect(m.buscarPainelAds).toHaveBeenCalledWith('2026-09-10', '2026-09-20');
  });

  it('range inválido não vira janela: situacao invalido e nenhuma consulta', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-05T12:00:00-03:00') });
    m.useVendasSku.mockReturnValue(vendasQ(null, { isError: true }));
    const { result } = renderHook(
      () => useAdsPainel({ tipo: 'range', desde: '2026-02-30', ate: '2026-03-02' }),
      { wrapper: criarWrapper() },
    );
    await waitFor(() => expect(result.current.situacaoPeriodo).toBe('invalido'));
    expect(result.current.janela).toBeNull();
    expect(result.current.painel).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(m.buscarPainelAds).not.toHaveBeenCalled();
    expect(m.useVendasSku.mock.calls.every((c) => c[2] === false)).toBe(true);
  });

  it('trocar só as datas do range muda a chave e consulta a nova janela', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-05T12:00:00-03:00') });
    const { result, rerender } = renderHook(
      ({ ate }: { ate: string }) => useAdsPainel({ tipo: 'range', desde: '2026-09-10', ate }),
      { initialProps: { ate: '2026-09-20' }, wrapper: criarWrapper() },
    );
    await waitFor(() => expect(result.current.painel).not.toBeNull());
    rerender({ ate: '2026-09-25' });
    await waitFor(() => expect(m.buscarPainelAds).toHaveBeenCalledWith('2026-09-10', '2026-09-25'));
    await waitFor(() => expect(result.current.janela).toEqual({ desde: '2026-09-10', ate: '2026-09-25' }));
  });
});
