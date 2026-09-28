// Dossiê do SKU: hooks de base mockados (padrão de useVendasSku.test.ts) e os módulos de dados
// mockados — o hook só busca e chama montarDossie.
import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { montarMapasCusto, montarCustoResolver } from '@/lib/custos';
import { agruparPorPedido } from '@/lib/pedidos-faturamento';
import { montarVendasSku } from '@/lib/vendas-sku';
import { resolverJanela, janelaAnterior } from '@/lib/metricas';
import type { Venda, VendaItem } from '@/lib/faturamento';
import type { CatalogoSku } from '@/lib/vendas-sku-catalogo';

const { custosQ, catQ, devQ, dados } = vi.hoisted(() => ({
  custosQ: { data: undefined as unknown, isLoading: false, isFetching: false, isError: false },
  catQ: { data: [] as unknown, isLoading: false, isFetching: false, isError: false, refetch: () => Promise.resolve() },
  devQ: { data: [] as unknown, isLoading: false, isFetching: false, isError: false, refetch: () => Promise.resolve() },
  dados: {
    buscarIdsDossie: vi.fn(), buscarMlbsDossie: vi.fn(), buscarMovimentos: vi.fn(),
    buscarModeracoes: vi.fn(), buscarPerguntas: vi.fn(), buscarCampanhas: vi.fn(), buscarVendasPorIds: vi.fn(),
    buscarVisitasDia: vi.fn(), buscarPrecoDia: vi.fn(), buscarTrafegoSync: vi.fn(), buscarFonteAds: vi.fn(),
  },
}));
const q = (data: unknown) => ({ data, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() });

vi.mock('@/hooks/useCustos', () => ({ useCustos: () => custosQ }));
vi.mock('@/hooks/useFotosProduto', () => ({ useFotosProduto: () => q(undefined) }));
vi.mock('@/hooks/useCoresProduto', () => ({ useCoresProduto: () => q(undefined) }));
vi.mock('@/hooks/useAnuncioCanonico', () => ({ useAnuncioCanonico: () => q(undefined) }));
vi.mock('@/hooks/useConfiguracoes', () => ({ useAliquotas: () => q({ nacional: 8, importado: 16 }) }));
vi.mock('@/hooks/useDevolucoes', () => ({ useDevolucoes: () => devQ }));
vi.mock('@/hooks/useCatalogoVendasSku', () => ({ useCatalogoVendasSku: () => catQ }));
vi.mock('@/lib/sku-dossie-dados', () => ({
  buscarIdsDossie: dados.buscarIdsDossie, buscarMlbsDossie: dados.buscarMlbsDossie,
  buscarMovimentos: dados.buscarMovimentos, buscarModeracoes: dados.buscarModeracoes,
  buscarPerguntas: dados.buscarPerguntas, buscarCampanhas: dados.buscarCampanhas,
  buscarVisitasDia: dados.buscarVisitasDia, buscarPrecoDia: dados.buscarPrecoDia, buscarTrafegoSync: dados.buscarTrafegoSync,
  buscarFonteAds: dados.buscarFonteAds,
}));
vi.mock('@/lib/faturamento', async (orig) => ({ ...(await orig<object>()), buscarVendasPorIds: dados.buscarVendasPorIds }));

const { useSkuDossie } = await import('../useSkuDossie');

function item(over: Partial<VendaItem> = {}): VendaItem {
  return { id: 'it1', ml_item_id: 'MLB1', variation_id: null, titulo: 'FITA', codigo: 'A', cor: null,
    ean: '789', quantity: 1, unit_price: 10, sale_fee: 0, is_publiai: true, custo_congelado: 4, ...over } as VendaItem;
}
function venda(over: Partial<Venda> = {}): Venda {
  return { id: 'v1', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
    date_closed: '2026-09-10T12:00:00Z', date_created: null, comprador_nick: 'c', comprador_nome: null, comprador_id: 100, uf: null, cidade: null, sacado_em: null, sacado_por: null, atualizado_em: '2026-09-10T12:00:00Z',
    total_amount: 10, paid_amount: 10, sale_fee_total: 1, frete_vendedor: null, liquido: 9, estorno: null,
    money_release_date: null, currency: 'BRL', shipping_id: null, shipping_status: null,
    shipping_substatus: null, shipping_logistic: null, tracking_number: null, is_publiai: true,
    tem_devolucao: false, itens: [item()], ...over };
}
function cat(over: Partial<CatalogoSku> = {}): CatalogoSku {
  return { codigo: 'A', codigoPai: 'P', nomeFamilia: 'Fita cetim', nome: 'Fita A', cor: null, tamanho: null,
    estoque: 5, fornecedor: null, origem: 'nacional', ehKit: false, primeiraVenda: '2026-06-01T00:00:00Z',
    ultimaVenda: '2026-09-10T12:00:00Z', kitMultiplicador: null, kitBaseCodigo: null, estoqueKit: null, ...over };
}

const SET = { tipo: 'range', desde: '2026-09-01', ate: '2026-09-30' } as const;
const sku = (codigo: string) => ({ tipo: 'sku', codigo }) as const;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

function servir(vendas: Venda[], mlbs: Record<string, string[]> = {}) {
  dados.buscarIdsDossie.mockResolvedValue(vendas.map((v) => v.id));
  dados.buscarVendasPorIds.mockResolvedValue(vendas);
  dados.buscarMlbsDossie.mockResolvedValue(new Map(Object.entries(mlbs)));
  dados.buscarMovimentos.mockResolvedValue([]);
  dados.buscarModeracoes.mockResolvedValue([]);
  dados.buscarPerguntas.mockResolvedValue([]);
  dados.buscarCampanhas.mockResolvedValue([]);
  dados.buscarVisitasDia.mockResolvedValue([]);
  dados.buscarPrecoDia.mockResolvedValue([]);
  dados.buscarTrafegoSync.mockResolvedValue(null);
  dados.buscarFonteAds.mockResolvedValue({ sync: null, grupos: [], membros: [], dias: [], codigosDosMembros: new Map() });
}

async function assentar(alvo: Parameters<typeof useSkuDossie>[0]) {
  const r = renderHook(() => useSkuDossie(alvo, SET, 'semana'), { wrapper });
  await waitFor(() => expect(r.result.current.estado).not.toBe('carregando'));
  return r.result.current;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-28T15:00:00Z') });
  Object.assign(custosQ, { data: montarMapasCusto([]), isLoading: false, isError: false });
  Object.assign(catQ, { data: [cat()], isError: false });
  Object.assign(devQ, { data: [], isLoading: false, isError: false });
  servir([]);
});
afterEach(() => vi.useRealTimers());

describe('useSkuDossie — estados', () => {
  it('carregando: custos ainda não assentaram', () => {
    Object.assign(custosQ, { data: undefined, isLoading: true });
    const r = renderHook(() => useSkuDossie(sku('A'), SET, 'semana'), { wrapper }).result.current;
    expect(r.estado).toBe('carregando');
    expect(r.dados).toBeNull();
  });

  it('erro: a busca das vendas falhou', async () => {
    dados.buscarIdsDossie.mockRejectedValue(new Error('rpc'));
    const r = await assentar(sku('A'));
    expect(r.estado).toBe('erro');
    expect(r.dados).toBeNull();
  });

  it('erro: devoluções com erro (a taxa não sai de lista vazia em silêncio)', async () => {
    Object.assign(devQ, { data: undefined, isError: true });
    const r = await assentar(sku('A'));
    expect(r.estado).toBe('erro');
  });

  it('nao_encontrado: fora do catálogo e sem venda (SKU e família)', async () => {
    expect((await assentar(sku('X'))).estado).toBe('nao_encontrado');
    expect((await assentar({ tipo: 'familia', codigoPai: 'NADA' })).estado).toBe('nao_encontrado');
  });

  it('sem_vendas: no catálogo, sem venda — sem tendência, estoque do catálogo', async () => {
    const r = await assentar(sku('A'));
    expect(r.estado).toBe('sem_vendas');
    expect(r.dados).toMatchObject({ codigos: ['A'], titulo: 'Fita A', linhaPeriodo: null, tendencia: null, estoque: 5 });
  });

  it('sem_cadastro: tem venda, não está no catálogo — estoque desconhecido (null), vendas aparecem', async () => {
    Object.assign(catQ, { data: [] });
    servir([venda({ id: 'a', itens: [item({ codigo: 'Z', titulo: 'Fita antiga' })] })]);
    const r = await assentar(sku('Z'));
    expect(r.estado).toBe('sem_cadastro');
    expect(r.dados).toMatchObject({ titulo: 'Fita antiga', estoque: null, cobertura: null, catalogo: [] });
    expect(r.dados!.linhaPeriodo!.acc.unidades).toBe(1);
    expect(r.dados!.historicoDesde).toBe('2026-09-10T12:00:00Z');
  });

  it('ok: fontes parciais fixas; Kit Virtual só quando alguma venda do SKU veio de kit', async () => {
    servir([venda({ id: 'a' })]);
    let r = await assentar(sku('A'));
    expect(r.estado).toBe('ok');
    expect(r.dados!.qualidade.fontesParciais).toEqual(['Promoções: só a situação atual', 'Publicação: só vínculos registrados']);
    servir([venda({ id: 'a', kit_item_id: 'MLB9' } as Partial<Venda>)]);
    r = await assentar(sku('A'));
    expect(r.dados!.qualidade.fontesParciais).toContain('Kit Virtual: sem histórico antes de set/2026');
  });
});

describe('useSkuDossie — KPIs do período = linha do ranking', () => {
  it('pack atravessando o início do período: lucro/bruto = montarVendasSku para o mesmo código', async () => {
    // Pack 77: order 1 em 31/08 (fora), order 2 em 01/09 (dentro); as duas têm A e B.
    const vendas = [
      venda({ id: 'a', order_id: 1, pack_id: 77, shipping_id: 5, frete_vendedor: 8, date_closed: '2026-08-31T15:00:00Z',
        total_amount: 50, sale_fee_total: 5, itens: [item({ id: 'i1', codigo: 'A', quantity: 2, unit_price: 15 }), item({ id: 'i2', codigo: 'B', unit_price: 20 })] }),
      venda({ id: 'b', order_id: 2, pack_id: 77, shipping_id: 5, frete_vendedor: 8, date_closed: '2026-09-01T15:00:00Z',
        total_amount: 40, sale_fee_total: 4, itens: [item({ id: 'i3', codigo: 'A', quantity: 1, unit_price: 25 }), item({ id: 'i4', codigo: 'B', quantity: 1, unit_price: 15 })] }),
    ];
    servir(vendas);
    const r = await assentar(sku('A'));
    expect(r.estado).toBe('ok');

    const janela = resolverJanela(SET);
    const custoR = montarCustoResolver(montarMapasCusto([]));
    const ranking = montarVendasSku({ vendas, agrupar: (vs) => agruparPorPedido(vs, custoR), janela,
      anterior: janelaAnterior(janela, SET), catalogo: new Map([['A', cat()]]), devolucoes: [] });
    const linha = ranking.linhas.find((l) => l.codigo === 'A')!;
    expect(linha.m.lucro).not.toBeNull();
    expect(r.dados!.linhaPeriodo!.m.lucro).toBe(linha.m.lucro);
    expect(r.dados!.linhaPeriodo!.acc.bruto).toBe(linha.acc.bruto);
    expect(r.dados!.linhaPeriodo!.acc.unidades).toBe(1);
    expect(r.dados!.linhaAnterior!.acc.unidades).toBe(2);
    // Agrupar o pack inteiro e filtrar depois daria outro rateio de frete: prova de que não é isso.
    const [pack] = agruparPorPedido(vendas, custoR);
    const lucroPackInteiro = pack.itens.filter((i) => i.codigo === 'A').reduce((s, i) => s + i.liquido - (i.custo ?? 0), 0);
    expect(r.dados!.linhaPeriodo!.m.lucro).not.toBe(Math.round(lucroPackInteiro * 100) / 100);
  });
});

describe('useSkuDossie — família', () => {
  it('composição atual (irmã sem venda entra); pedidos contados por order; mix com a irmã sem venda', async () => {
    Object.assign(catQ, { data: [cat(), cat({ codigo: 'C', nome: 'Fita C', estoque: 3 }), cat({ codigo: 'Q', codigoPai: 'OUTRA' })] });
    servir([
      venda({ id: 'a', order_id: 1, date_closed: '2026-09-10T12:00:00Z', total_amount: 30, liquido: 27,
        itens: [item({ id: 'i1', codigo: 'A', unit_price: 10 }), item({ id: 'i2', codigo: 'C', unit_price: 20 })] }),
    ], { MLB1: ['A', 'C'] });
    const r = await assentar({ tipo: 'familia', codigoPai: 'P' });
    expect(r.estado).toBe('ok');
    expect(r.dados!.codigos).toEqual(['A', 'C']);
    expect(r.dados!.titulo).toBe('Fita cetim');
    expect(r.dados!.linhaPeriodo!.acc.pedidos).toBe(1);
    expect(r.dados!.linhaPeriodo!.acc.unidades).toBe(2);
    expect(r.dados!.estoque).toBe(8);
    expect(r.dados!.mix!.map((m) => m.codigo).sort()).toEqual(['A', 'C']);
    expect(dados.buscarModeracoes).toHaveBeenCalledWith(['MLB1']);
  });

  it('kit: cobertura compartilhada, estoque = estoqueKit, movimentos buscados pela base', async () => {
    Object.assign(catQ, { data: [cat({ codigo: 'K', ehKit: true, kitMultiplicador: 3, kitBaseCodigo: 'A', estoqueKit: 2 })] });
    servir([venda({ id: 'a', itens: [item({ codigo: 'K' })] })]);
    const r = await assentar(sku('K'));
    expect(r.dados).toMatchObject({ cobertura: 'compartilhado', estoque: 2 });
    expect(dados.buscarMovimentos).toHaveBeenCalledWith(['A']);
  });
});

describe('useSkuDossie — tráfego', () => {
  async function comTrafego(alvo: Parameters<typeof useSkuDossie>[0]) {
    const r = renderHook(() => useSkuDossie(alvo, SET, 'semana'), { wrapper });
    await waitFor(() => expect(r.result.current.dados?.trafego.estadoColeta ?? 'carregando').not.toBe('carregando'));
    return r.result.current;
  }
  // Semanas BRT do período: 31/08, 07/09, … — agora = 28/09 12:00 BRT.
  const diasOk = (mlb: string) => Array.from({ length: 29 }, (_, i) => ({
    ml_item_id: mlb, dia: new Date(Date.UTC(2026, 7, 31 + i)).toISOString().slice(0, 10), visitas: 10, estado: 'ok' }));

  it('falha na leitura do tráfego não derruba o dossiê', async () => {
    servir([venda({ id: 'a' })], { MLB1: ['A'] });
    dados.buscarVisitasDia.mockRejectedValue(new Error('rls'));
    const r = await comTrafego(sku('A'));
    expect(r.estado).toBe('ok');
    expect(r.dados!.linhaPeriodo!.acc.unidades).toBe(1);
    expect(r.dados!.trafego).toMatchObject({ estadoColeta: 'erro', alcance: 'sku', serie: [] });
    // "Tentar de novo" do painel refaz só o tráfego
    dados.buscarVisitasDia.mockClear(); dados.buscarIdsDossie.mockClear();
    await r.refetchTrafego();
    expect(dados.buscarVisitasDia).toHaveBeenCalledTimes(1);
    expect(dados.buscarIdsDossie).not.toHaveBeenCalled();
  });

  it('MLB compartilhado: busca as vendas dos outros códigos do anúncio e mede o anúncio inteiro', async () => {
    const a = venda({ id: 'a', order_id: 1, date_closed: '2026-09-10T12:00:00Z', itens: [item({ ml_item_id: 'MLB2', codigo: 'A', quantity: 2 })] });
    const b = venda({ id: 'b', order_id: 2, date_closed: '2026-09-11T12:00:00Z', itens: [item({ id: 'i2', ml_item_id: 'MLB2', codigo: 'B', quantity: 3 })] });
    servir([a], { MLB2: ['A', 'B'] });
    dados.buscarIdsDossie.mockImplementation(async (cs: string[]) => (cs.includes('B') ? ['a', 'b'] : ['a']));
    dados.buscarVendasPorIds.mockImplementation(async (ids: string[]) => [a, b].filter((v) => ids.includes(v.id)));
    dados.buscarVisitasDia.mockResolvedValue(diasOk('MLB2'));
    dados.buscarTrafegoSync.mockResolvedValue({ estado: 'ok', carga_inicial_concluida_em: '2026-09-01T00:00:00Z', ultimo_ok_em: null });
    const r = await comTrafego(sku('A'));
    expect(dados.buscarIdsDossie).toHaveBeenCalledWith(['B']); // só os códigos de fora; as de A já vieram
    expect(dados.buscarVisitasDia).toHaveBeenCalledWith(['MLB2'], '2026-08-31', '2026-10-04');
    const t = r.dados!.trafego;
    expect(t).toMatchObject({ alcance: 'anuncio', estadoColeta: 'ok' });
    expect(t.serie[1]).toMatchObject({ unidades: 5, visitas: 70, unidadesPorVisita: 5 / 70 });
    // o dossiê do SKU segue só com a venda de A
    expect(r.dados!.linhaPeriodo!.acc.unidades).toBe(2);
  });

  it('sem MLB (não resolvido): indisponível na hora, sem ler tráfego', async () => {
    dados.buscarVisitasDia.mockClear();
    servir([venda({ id: 'a' })]);
    const r = await comTrafego(sku('A'));
    expect(r.dados!.trafego).toMatchObject({ alcance: 'indisponivel', estadoColeta: 'sem_coleta' });
    expect(dados.buscarVisitasDia).not.toHaveBeenCalled();
    // refetch com a query de tráfego desligada não roda a queryFn (conj/faixa seriam null)
    await expect(r.refetch()).resolves.toBeDefined();
    await expect(r.refetchTrafego()).resolves.toBeUndefined();
    expect(dados.buscarVisitasDia).not.toHaveBeenCalled();
  });

  it('Ads: buscarFonteAds com os MLBs ordenados e a faixa do tráfego (1º dia do 1º intervalo); refetchAds só refaz os Ads', async () => {
    dados.buscarFonteAds.mockClear();
    servir([venda({ id: 'a' })], { MLB9: ['A'], MLB2: ['A'] });
    const h = renderHook(() => useSkuDossie(sku('A'), SET, 'semana'), { wrapper });
    await waitFor(() => expect(h.result.current.ads?.estado ?? 'carregando').not.toBe('carregando'));
    // Período 01/09–30/09; a 1ª semana BRT começa na segunda 31/08.
    expect(dados.buscarFonteAds).toHaveBeenCalledWith(['MLB2', 'MLB9'], '2026-08-31', '2026-10-04');
    expect(h.result.current.ads).toMatchObject({ estado: 'sem_coleta' });
    dados.buscarFonteAds.mockClear(); dados.buscarIdsDossie.mockClear(); dados.buscarVisitasDia.mockClear();
    await h.result.current.refetchAds();
    expect(dados.buscarFonteAds).toHaveBeenCalledTimes(1);
    expect(dados.buscarIdsDossie).not.toHaveBeenCalled();
    expect(dados.buscarVisitasDia).not.toHaveBeenCalled();
  });

  it('Ads: falha na leitura não derruba o dossiê', async () => {
    servir([venda({ id: 'a' })], { MLB1: ['A'] });
    dados.buscarFonteAds.mockRejectedValue(new Error('rls'));
    const h = renderHook(() => useSkuDossie(sku('A'), SET, 'semana'), { wrapper });
    await waitFor(() => expect(h.result.current.ads?.estado ?? 'carregando').not.toBe('carregando'));
    expect(h.result.current.ads!.estado).toBe('erro');
    expect(h.result.current.estado).toBe('ok');
  });
});
