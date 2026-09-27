import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import SkuDossie from '../SkuDossie';
import { idadeComercial } from '@/components/sku-dossie/formato-dossie';
import { useSkuDossie } from '@/hooks/useSkuDossie';
import { RankingSku } from '@/components/faturamento/ranking-sku';
import { SEM_CODIGO, metricas, somarAcumuladores, type LinhaSku } from '@/lib/vendas-sku';
import type { DossieSku, EstadoDossie, PontoSerie } from '@/lib/sku-dossie';
import type { PontoTrafego, TrafegoDossie } from '@/lib/sku-trafego';
import { agruparPorPedido } from '@/lib/pedidos-faturamento';
import type { Venda } from '@/lib/faturamento';
import type { CatalogoSku } from '@/lib/vendas-sku-catalogo';

vi.mock('@/hooks/useSkuDossie', () => ({ useSkuDossie: vi.fn() }));

function linha(codigo: string, titulo: string): LinhaSku {
  const acc = somarAcumuladores([]);
  acc.bruto = 300; acc.unidades = 6; acc.pedidos = 5; acc.liquido = 240;
  acc.itensComCusto = 5; acc.unidadesComCusto = 6; acc.custo = 150; acc.liquidoComCusto = 240; acc.brutoComCusto = 300; acc.brutoCustoReal = 300;
  acc.pedidosBaseDevolucao = 5; acc.pedidosDevolvidos = 1;
  return { codigo, titulo, imagemPath: null, codigoPai: 'P1', nomeFamilia: 'Camiseta Dry', fornecedor: null, origem: 'nacional',
    ehKit: false, estoque: 12, primeiraVenda: '2026-05-10T12:00:00Z', acc, m: metricas(acc), pedidoChaves: ['1'] };
}

const cat: CatalogoSku = {
  codigo: '00123', codigoPai: 'P1', nomeFamilia: 'Camiseta Dry', nome: 'Camiseta Dry Azul M', cor: 'Azul', tamanho: 'M',
  estoque: 12, fornecedor: null, origem: 'nacional', ehKit: false, primeiraVenda: '2026-05-10T12:00:00Z',
  ultimaVenda: '2026-09-20T12:00:00Z', kitMultiplicador: null, kitBaseCodigo: null, estoqueKit: null,
};

const dossie = (over: Partial<DossieSku> = {}): DossieSku => ({
  codigos: ['00123'], titulo: 'Camiseta Dry Azul M', catalogo: [cat],
  historicoDesde: '2026-05-10T12:00:00Z', ultimaVenda: '2026-09-20T12:00:00Z',
  linhaPeriodo: linha('00123', 'Camiseta Dry Azul M'), linhaAnterior: null,
  tendencia: 'em_alta', cobertura: 40, estoque: 12, alertas: [], serie: [], eventos: [], perguntasPorIntervalo: [],
  ufs: { valores: {}, semUf: 0 }, mix: null, campanhas: [], mlbs: new Map(), kitVirtual: null,
  qualidade: { pctBrutoCustoReal: 0.9, fontesParciais: ['Promoções: só a situação atual'] },
  trafego: { calendario: 'brt', alcance: 'indisponivel', porMlb: [], serie: [], coberturaDesde: null, estadoColeta: 'sem_coleta', precoAtual: null, motivo: null },
  ...over,
});

function renderPagina(estado: EstadoDossie, dados: DossieSku | null, rota: string | { pathname: string; state: unknown } = '/faturamento/sku/00123', ads: unknown = null) {
  vi.mocked(useSkuDossie).mockReturnValue({ estado, dados, ads, refetch: vi.fn(), refetchTrafego: vi.fn(), refetchAds: vi.fn() } as never);
  render(
    <MemoryRouter initialEntries={[rota]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Routes>
          <Route path="/faturamento/sku/:codigo" element={<SkuDossie />} />
          <Route path="/faturamento/sku/familia/:codigoPai" element={<SkuDossie />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('SkuDossie', () => {
  it('trilha termina no código curto, não repete o título', () => {
    renderPagina('ok', dossie());
    const trilha = screen.getByRole('navigation', { name: 'Trilha de navegação' });
    expect(within(trilha).getByText('Código 00123')).toBeInTheDocument();
    expect(within(trilha).queryByText('Camiseta Dry Azul M')).not.toBeInTheDocument();
  });

  it('link da família na trilha leva a origem (state.de) adiante', () => {
    const de = '/faturamento?aba=sku&busca=dry';
    renderPagina('ok', dossie(), { pathname: '/faturamento/sku/00123', state: { de } });
    expect(screen.getByRole('link', { name: 'Vendas por SKU' })).toHaveAttribute('href', de);
    fireEvent.click(screen.getByRole('link', { name: 'Camiseta Dry' }));
    expect(vi.mocked(useSkuDossie).mock.calls.at(-1)?.[0]).toEqual({ tipo: 'familia', codigoPai: 'P1' });
    expect(screen.getByRole('link', { name: 'Vendas por SKU' })).toHaveAttribute('href', de);
  });

  it('sem vendas não repete o aviso na faixa de qualidade', () => {
    renderPagina('sem_vendas', dossie({ linhaPeriodo: null, tendencia: null, historicoDesde: null, ultimaVenda: null }));
    expect(screen.queryByText(/Nenhuma venda registrada/)).not.toBeInTheDocument();
  });

  it('mostra título, código, histórico desde e os KPIs do período', () => {
    renderPagina('ok', dossie());
    expect(screen.getByRole('heading', { level: 1, name: 'Camiseta Dry Azul M' })).toBeInTheDocument();
    expect(screen.getByText(/Histórico desde 10\/05\/2026/)).toBeInTheDocument();
    expect(screen.getByText('Em alta')).toBeInTheDocument();
    expect(screen.getByText('Faturamento')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Resultado no período' })).getByText('20,0%')).toBeInTheDocument(); // taxa de devolução 1/5
    expect(screen.getByRole('link', { name: /Vendas por SKU/ })).toHaveAttribute('href', '/faturamento?aba=sku');
    expect(vi.mocked(useSkuDossie).mock.calls.at(-1)?.[0]).toEqual({ tipo: 'sku', codigo: '00123' });
  });

  it('rota da família pede o alvo família', () => {
    renderPagina('ok', dossie({ titulo: 'Camiseta Dry', codigos: ['00123', '00124'] }), '/faturamento/sku/familia/P1');
    expect(vi.mocked(useSkuDossie).mock.calls.at(-1)?.[0]).toEqual({ tipo: 'familia', codigoPai: 'P1' });
    expect(screen.getByRole('heading', { level: 1, name: 'Camiseta Dry' })).toBeInTheDocument();
  });

  it('não encontrado: aviso e caminho de volta', () => {
    renderPagina('nao_encontrado', null);
    expect(screen.getByText('Não encontramos este código')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Vendas por SKU/ }).length).toBeGreaterThan(0);
  });

  it('sem cadastro: aviso e estoque desconhecido, nunca zero', () => {
    renderPagina('sem_cadastro', dossie({ catalogo: [], estoque: null }));
    expect(screen.getByText(/Este código não está mais no catálogo/)).toBeInTheDocument();
    expect(screen.getAllByText('desconhecido').length).toBeGreaterThan(0);
    expect(within(screen.getByRole('region', { name: 'Estoque' })).getByText('desconhecido')).toBeInTheDocument();
  });

  it('sem vendas: cabeçalho, estoque e o aviso, sem KPIs', () => {
    renderPagina('sem_vendas', dossie({ linhaPeriodo: null, tendencia: null, historicoDesde: null, ultimaVenda: null }));
    expect(screen.getByText('Sem vendas registradas desde a entrada no PubliAI')).toBeInTheDocument();
    expect(screen.getAllByText('12 un.').length).toBeGreaterThan(0);
    expect(screen.queryByText('Faturamento')).not.toBeInTheDocument();
    // posição de hoje (estoque, campanhas) aparece; blocos do período não
    expect(screen.getByRole('region', { name: 'Estoque' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Campanhas' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Devoluções' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Vendas por estado' })).not.toBeInTheDocument();
  });
});

const venda = (order: number, codigo: string, titulo: string): Venda => ({
  id: `v${order}`, order_id: order, pack_id: null, status: 'paid', status_detail: null, date_closed: '2026-09-15T12:00:00Z',
  date_created: null, comprador_nick: 'COMPRADOR1', comprador_id: 1, total_amount: 20, paid_amount: 20, sale_fee_total: 2,
  frete_vendedor: null, liquido: 18, estorno: null, money_release_date: null, currency: 'BRL', shipping_id: null,
  shipping_status: null, shipping_substatus: null, shipping_logistic: null, tracking_number: null, is_publiai: true,
  tem_devolucao: false, itens: [{ id: `i${order}`, ml_item_id: 'MLB1', variation_id: null, titulo, codigo, cor: null,
    ean: null, quantity: 2, unit_price: 10, sale_fee: 2, is_publiai: true }],
} as Venda);

const ponto = (inicio: string, fim: string, rotulo: string, incompleto: boolean, over: Partial<PontoSerie> = {}): PontoSerie => ({
  intervalo: { inicio, fim, rotulo, incompleto, inicioParcial: false }, unidades: 0, bruto: 0, lucro: null, fonteCusto: 'sem_custo',
  precoMedio: null, precoMin: null, precoMax: null, unidadesKit: 0, pedidos: [], ...over,
});

const comSerie = (over: Partial<DossieSku> = {}) => dossie({
  serie: [
    ponto('2026-09-14T03:00:00.000Z', '2026-09-21T03:00:00.000Z', '14/09', false, {
      unidades: 2, bruto: 20, lucro: 8, fonteCusto: 'real', precoMedio: 10, precoMin: 10, precoMax: 10,
      pedidos: agruparPorPedido([venda(4401, '00123', 'Camiseta Dry Azul M')]),
    }),
    ponto('2026-09-21T03:00:00.000Z', '2026-09-28T03:00:00.000Z', '21/09', true),
  ],
  perguntasPorIntervalo: [3, 0],
  eventos: [
    { id: 'e1', tipo: 'moderacao_detectada', em: '2026-09-16T12:00:00Z', titulo: 'Moderação detectada', detalhe: 'Foto', motivo: null, vinculo: 'compartilhado', mlb: 'MLB3' },
    { id: 'e2', tipo: 'moderacao_resolvida', em: '2026-09-18T12:00:00Z', titulo: 'Resolução observada', detalhe: null, motivo: null, vinculo: 'nao_resolvido', mlb: 'MLB9' },
  ],
  ...over,
});

describe('SkuDossie: série e eventos', () => {
  it('série: rótulos dos intervalos, "(parcial)" no corrente e resumo textual', () => {
    renderPagina('ok', comSerie());
    const serie = screen.getByRole('region', { name: /Evolução/ });
    expect(within(serie).getByRole('button', { name: /14\/09/ })).toBeInTheDocument();
    expect(within(serie).getByRole('button', { name: /21\/09.*parcial/ })).toBeInTheDocument();
    expect(within(serie).getByText('(parcial)')).toBeInTheDocument();
    const resumo = serie.querySelector('.sr-only');
    expect(resumo?.textContent).toMatch(/2 unidades/);
    expect(resumo?.textContent).toMatch(/14\/09/);
  });

  it('alternador semana/mês pede o passo', async () => {
    renderPagina('ok', comSerie());
    expect(screen.getByRole('button', { name: 'Semana' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Mês' }));
    expect(vi.mocked(useSkuDossie).mock.calls.at(-1)?.[2]).toBe('mes');
  });

  it('família: nota do mix no preço médio', () => {
    renderPagina('ok', comSerie({ titulo: 'Camiseta Dry' }), '/faturamento/sku/familia/P1');
    expect(screen.getByText(/o preço médio também muda pelo mix de variações/)).toBeInTheDocument();
  });

  it('kit virtual: dica no KPI de unidades e nota de cobertura parcial', () => {
    renderPagina('ok', comSerie({ kitVirtual: { unidadesPeriodo: 3, unidadesPorIntervalo: [1, 0] } }));
    expect(screen.getByText(/3 un\. vendidas dentro de kit/)).toBeInTheDocument();
    expect(screen.getByText(/cobertura parcial \(sem histórico antes de set\/2026\)/)).toBeInTheDocument();
  });

  it('teclado: o intervalo abre o Sheet com os pedidos e o SKU destacado', async () => {
    const user = userEvent.setup();
    renderPagina('ok', comSerie());
    const botao = within(screen.getByRole('region', { name: /Evolução/ })).getByRole('button', { name: /14\/09/ });
    botao.focus();
    await user.keyboard('{Enter}');
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText(/Semana de 14\/09/)).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: /COMPRADOR1/ }));
    expect(within(sheet).getByText('4401')).toBeInTheDocument();
    expect(within(sheet).getByText('este SKU')).toBeInTheDocument();
  });

  it('1º intervalo que começa antes do período: "(início parcial)"', () => {
    const d = comSerie();
    d.serie[0] = { ...d.serie[0], intervalo: { ...d.serie[0].intervalo, inicioParcial: true } };
    renderPagina('ok', d);
    const serie = screen.getByRole('region', { name: /Evolução/ });
    expect(within(serie).getByRole('button', { name: /14\/09 \(início parcial\)/ })).toBeInTheDocument();
    expect(within(serie).getByText('(início parcial)')).toBeInTheDocument();
  });

  it('régua: um só tab stop, setas andam entre intervalos e Enter abre o Sheet', async () => {
    const user = userEvent.setup();
    renderPagina('ok', comSerie());
    const serie = screen.getByRole('region', { name: /Evolução/ });
    const b14 = within(serie).getByRole('button', { name: /14\/09/ });
    const b21 = within(serie).getByRole('button', { name: /21\/09/ });
    // o intervalo corrente é o ponto de entrada
    expect(b21).toHaveAttribute('tabindex', '0');
    expect(b14).toHaveAttribute('tabindex', '-1');
    b21.focus();
    await user.keyboard('{ArrowLeft}');
    expect(b14).toHaveFocus();
    expect(b14).toHaveAttribute('tabindex', '0');
    await user.keyboard('{ArrowRight}');
    expect(b21).toHaveFocus();
    await user.keyboard('{ArrowLeft}{Enter}');
    expect(within(await screen.findByRole('dialog')).getByText(/Semana de 14\/09/)).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('total do pedido')).toBeInTheDocument();
  });

  it('eventos: agrupados por mês, selos de compartilhado e não resolvido', () => {
    renderPagina('ok', comSerie());
    const ev = screen.getByRole('region', { name: 'Eventos' });
    expect(within(ev).getByRole('heading', { name: /setembro de 2026/ })).toBeInTheDocument();
    expect(within(ev).getByText('anúncio compartilhado · MLB3')).toBeInTheDocument();
    expect(within(ev).getByText('vínculo não resolvido')).toBeInTheDocument();
  });

  it('eventos: kit marca o estoque como da base; vazio mostra o aviso', () => {
    renderPagina('ok', comSerie({
      catalogo: [{ ...cat, ehKit: true, kitMultiplicador: 2, kitBaseCodigo: '00100', estoqueKit: 3 }],
      eventos: [{ id: 'e3', tipo: 'ruptura', em: '2026-09-16T12:00:00Z', titulo: 'Ruptura do kit', detalhe: null, motivo: null, vinculo: 'exato', mlb: null, estoqueDaBase: true }],
    }));
    expect(within(screen.getByRole('region', { name: 'Eventos' })).getByText('estoque da base')).toBeInTheDocument();
  });

  it('eventos da família mista: só o evento da base do kit leva o selo', () => {
    renderPagina('ok', comSerie({
      catalogo: [cat, { ...cat, codigo: '00125', ehKit: true, kitMultiplicador: 2, kitBaseCodigo: '00999', estoqueKit: 3 }],
      eventos: [
        { id: 'a', tipo: 'ruptura', em: '2026-09-16T12:00:00Z', titulo: 'Ruptura: estoque zerou', detalhe: null, motivo: null, vinculo: 'exato', mlb: null },
        { id: 'b', tipo: 'retorno_estoque', em: '2026-09-17T12:00:00Z', titulo: 'Estoque voltou: 4 un.', detalhe: null, motivo: null, vinculo: 'exato', mlb: null, estoqueDaBase: true },
      ],
    }), '/faturamento/sku/familia/P1');
    expect(within(screen.getByRole('region', { name: 'Eventos' })).getAllByText('estoque da base')).toHaveLength(1);
  });

  it('sem venda no período e sem histórico no anterior: a nota não promete Δ', () => {
    renderPagina('ok', dossie({ linhaPeriodo: null, linhaAnterior: null }));
    const periodo = screen.getByRole('region', { name: 'Resultado no período' });
    expect(within(periodo).getByText(/Sem Δ: sem histórico no período anterior/)).toBeInTheDocument();
    expect(within(periodo).queryByText(/O Δ compara com o período anterior/)).not.toBeInTheDocument();
  });

  it('eventos vazios: aviso próprio', () => {
    renderPagina('ok', comSerie({ eventos: [] }));
    expect(within(screen.getByRole('region', { name: 'Eventos' })).getByText('Nenhum evento registrado')).toBeInTheDocument();
  });
});

const IV14 = { inicio: '2026-09-14T03:00:00.000Z', fim: '2026-09-21T03:00:00.000Z', rotulo: '14/09', incompleto: false, inicioParcial: false };
const IV21 = { inicio: '2026-09-21T03:00:00.000Z', fim: '2026-09-28T03:00:00.000Z', rotulo: '21/09', incompleto: true, inicioParcial: false };
const EST = (over: Partial<PontoTrafego['estados']> = {}): PontoTrafego['estados'] => ({ ok: 7, pendente: 0, falha: 0, ausente: 0, nao_coletado: 0, ...over });
const pt = (intervalo: PontoTrafego['intervalo'], over: Partial<PontoTrafego> = {}): PontoTrafego => ({
  intervalo, visitas: 70, estados: EST(), unidades: 5, unidadesPorVisita: 5 / 70,
  precoObservado: { min: 47.9, max: 49.9 }, ...over,
});
const traf = (over: Partial<TrafegoDossie> = {}): TrafegoDossie => ({
  calendario: 'brt', alcance: 'sku', estadoColeta: 'ok', motivo: null, coberturaDesde: '2026-09-14',
  porMlb: [{ mlb: 'MLB1', vinculo: 'exato', codigos: ['00123'], considerado: true }],
  serie: [pt(IV14), pt(IV21, { visitas: null, unidades: 1, unidadesPorVisita: null, estados: EST({ ok: 4, pendente: 2 }) })],
  precoAtual: { preco: 49.9, observadoEm: '2026-09-22T02:30:00Z', mlb: 'MLB1' },
  ...over,
});
const REG = /^Tráfego/;
// "48 h" com espaço não-quebrável
const H48 = 'aguardando 48 h';

async function abrirTrafego(t: TrafegoDossie, rota?: string, estado: EstadoDossie = 'ok', over: Partial<DossieSku> = {}) {
  const user = userEvent.setup();
  renderPagina(estado, comSerie({ trafego: t, ...over }), rota);
  await user.click(screen.getByRole('tab', { name: 'Tráfego e oferta' }));
  return screen.getByRole('region', { name: REG });
}

describe('SkuDossie: tráfego e oferta', () => {
  it('alterna Vendas | Tráfego e oferta numa tablist; Vendas é o padrão; título espelha a série', async () => {
    renderPagina('ok', comSerie({ trafego: traf() }));
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Vendas' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: /Evolução/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Tráfego e oferta' }));
    expect(screen.getByRole('tab', { name: 'Tráfego e oferta' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Tráfego semanal' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Evolução/ })).not.toBeInTheDocument();
  });

  it('sem vendas: a aba Vendas mantém o aviso e o tráfego continua acessível', async () => {
    const reg = await abrirTrafego(traf(), undefined, 'sem_vendas', { linhaPeriodo: null, tendencia: null, historicoDesde: null, ultimaVenda: null, serie: [] });
    expect(within(reg).getAllByText('0,071 un./visita').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('tab', { name: 'Vendas' }));
    expect(screen.getByText('Sem vendas registradas desde a entrada no PubliAI')).toBeInTheDocument();
    expect(screen.queryByText('Faturamento')).not.toBeInTheDocument();
  });

  it('SKU exclusivo: "deste SKU", unidades por visita como razão (nunca %), preço observado com hora BRT e cobertura', async () => {
    const reg = await abrirTrafego(traf());
    expect(within(reg).getAllByText(/deste SKU/).length).toBeGreaterThan(0);
    expect(within(reg).getAllByText('0,071 un./visita').length).toBeGreaterThan(0);
    expect(reg.textContent).not.toMatch(/%/);
    expect(within(reg).getByText(/R\$\s?49,90 às 23:30 de 21\/09/)).toBeInTheDocument();
    expect(within(reg).getByText(/Visitas no período desde 14\/09/)).toBeInTheDocument();
    expect(reg.textContent).not.toMatch(/coleta desde/i);
  });

  it('intervalo com dia pendente: "em curso · aguardando 48 h"; falha/ausente: "sem dado" com a contagem; legenda só do que existe', async () => {
    const reg = await abrirTrafego(traf({ serie: [
      pt(IV14, { visitas: null, unidadesPorVisita: null, estados: EST({ ok: 5, falha: 1, ausente: 1 }) }),
      pt(IV21, { visitas: null, unidadesPorVisita: null, estados: EST({ ok: 4, pendente: 2 }) }),
    ] }));
    expect(within(reg).getByRole('button', { name: new RegExp(`21/09.*em curso · ${H48}`) })).toBeInTheDocument();
    expect(within(reg).getByRole('button', { name: /14\/09.*sem dado em 2 dias/ })).toBeInTheDocument();
    expect(within(reg).queryByText('Ainda não coletado')).not.toBeInTheDocument();
  });

  it('parcial: dias antes da cobertura são "ainda não coletado", não sem dado', async () => {
    const reg = await abrirTrafego(traf({ estadoColeta: 'parcial', serie: [
      pt(IV14, { visitas: null, unidadesPorVisita: null, estados: EST({ ok: 0, nao_coletado: 7 }) }),
      pt(IV21, { visitas: null, unidadesPorVisita: null, estados: EST({ ok: 4, pendente: 2 }) }),
    ] }));
    expect(within(reg).getByRole('button', { name: /14\/09.*ainda não coletado/ })).toBeInTheDocument();
    expect(within(reg).queryByRole('button', { name: /sem dado/ })).not.toBeInTheDocument();
    expect(within(reg).getByText('Ainda não coletado')).toBeInTheDocument();
    expect(within(reg).queryByText('Sem dado')).not.toBeInTheDocument();
  });

  it('anúncio compartilhado: métrica do anúncio inteiro, um só número de variações e "Unidades do anúncio"', async () => {
    const reg = await abrirTrafego(traf({ alcance: 'anuncio',
      porMlb: [{ mlb: 'MLB2', vinculo: 'compartilhado', codigos: ['00123', '00124', '00125'], considerado: true }] }));
    expect(within(reg).getAllByText(/do anúncio inteiro \(compartilhado com 2 variações\)/).length).toBeGreaterThan(0);
    expect(within(reg).getByText('anúncio compartilhado · MLB2')).toBeInTheDocument();
    expect(reg.textContent).not.toMatch(/3 códigos/);
    expect(within(reg).getByTestId('detalhe-trafego')).toHaveTextContent(/Unidades do anúncio/);
  });

  it('família: "da família"; anúncio misto aparece fora da métrica', async () => {
    const reg = await abrirTrafego(traf({ alcance: 'familia', porMlb: [
      { mlb: 'MLB1', vinculo: 'exato', codigos: ['00123'], considerado: true },
      { mlb: 'MLB7', vinculo: 'compartilhado', codigos: ['00123', '00999'], considerado: false },
    ] }), '/faturamento/sku/familia/P1');
    expect(within(reg).getAllByText(/da família/).length).toBeGreaterThan(0);
    const lista = within(reg).getByRole('list', { name: /Anúncios/ });
    expect(within(lista).getByText('fora da métrica')).toBeInTheDocument();
    expect(within(lista).getByText('entra na métrica')).toBeInTheDocument();
  });

  it('indisponível vem antes de sem_coleta: SKU sem MLB não lê "a coleta ainda não começou"', async () => {
    const reg = await abrirTrafego(traf({ alcance: 'indisponivel', estadoColeta: 'sem_coleta', porMlb: [], serie: [], precoAtual: null, coberturaDesde: null }));
    expect(within(reg).getByText(/Nenhum anúncio do Mercado Livre vinculado/)).toBeInTheDocument();
    expect(within(reg).queryByText(/coleta de tráfego começa/)).not.toBeInTheDocument();
    expect(within(reg).queryByRole('button', { name: 'Mês' })).not.toBeInTheDocument();
  });

  it('sem_coleta: começa após a ativação, sem caminho de runbook e sem Semana/Mês', async () => {
    const reg = await abrirTrafego(traf({ estadoColeta: 'sem_coleta', serie: [], precoAtual: null, coberturaDesde: null }));
    expect(within(reg).getByText(/A coleta de tráfego começa após a ativação\./)).toBeInTheDocument();
    expect(reg.textContent).not.toMatch(/runbook|docs\//);
    expect(within(reg).queryByRole('button', { name: 'Semana' })).not.toBeInTheDocument();
    // sem série, o título não promete "semanal"
    expect(within(reg).getByRole('heading', { level: 3 })).toHaveTextContent(/^Tráfego$/);
  });

  it('coleta interrompida: diz o motivo (sem acesso / falha)', async () => {
    // Forma real de montarTrafego: sem_coleta traz um ponto por intervalo, todos sem dado.
    const vazio = (iv: PontoTrafego['intervalo']) => pt(iv, { visitas: null, unidades: 0, unidadesPorVisita: null, precoObservado: null, estados: EST({ ok: 0, ausente: 7 }) });
    let reg = await abrirTrafego(traf({ motivo: 'sem_acesso', estadoColeta: 'sem_coleta', serie: [vazio(IV14), vazio(IV21)], precoAtual: null, coberturaDesde: null }));
    expect(within(reg).getByText(/Coleta interrompida: sem acesso à conta do Mercado Livre/)).toBeInTheDocument();
    expect(within(reg).queryByText(/começa após a ativação/)).not.toBeInTheDocument();
    expect(reg.textContent).not.toMatch(/Os dados abaixo/);
    cleanup();
    reg = await abrirTrafego(traf({ motivo: 'erro' }));
    expect(within(reg).getByText(/Coleta interrompida: falhou na última execução/)).toBeInTheDocument();
  });

  it('erro na leitura do tráfego: o painel avisa, "Tentar de novo" refaz só o tráfego e o dossiê continua', async () => {
    const reg = await abrirTrafego(traf({ estadoColeta: 'erro', serie: [], precoAtual: null, coberturaDesde: null }));
    expect(within(reg).getByText(/Não foi possível ler o tráfego/)).toBeInTheDocument();
    await userEvent.click(within(reg).getByRole('button', { name: 'Tentar de novo' }));
    const h = vi.mocked(useSkuDossie).mock.results.at(-1)!.value as { refetch: () => void; refetchTrafego: () => void };
    expect(h.refetchTrafego).toHaveBeenCalled();
    expect(h.refetch).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Estoque' })).toBeInTheDocument();
  });

  it('parcial: avisa a carga em andamento; carregando: skeleton ocupado', async () => {
    const reg = await abrirTrafego(traf({ estadoColeta: 'parcial' }));
    expect(within(reg).getByText(/Coleta parcial/)).toBeInTheDocument();
    cleanup();
    const r2 = await abrirTrafego(traf({ estadoColeta: 'carregando', serie: [], precoAtual: null, coberturaDesde: null }));
    expect(r2.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('trocar Semana → Mês reinicia o foco no último intervalo completo da série nova', async () => {
    const user = userEvent.setup();
    const IVSET = { inicio: '2026-09-01T03:00:00.000Z', fim: '2026-10-01T03:00:00.000Z', rotulo: 'set/26', incompleto: false, inicioParcial: false };
    const IVOUT = { inicio: '2026-10-01T03:00:00.000Z', fim: '2026-11-01T03:00:00.000Z', rotulo: 'out/26', incompleto: true, inicioParcial: false };
    const IV07 = { ...IV14, inicio: '2026-09-07T03:00:00.000Z', fim: '2026-09-14T03:00:00.000Z', rotulo: '07/09' };
    const semana = comSerie({ trafego: traf({ serie: [pt(IV07), pt(IV14), pt(IV21, { visitas: null, unidadesPorVisita: null, estados: EST({ ok: 4, pendente: 2 }) })] }) });
    const IVAGO = { ...IVSET, inicio: '2026-08-01T03:00:00.000Z', fim: '2026-09-01T03:00:00.000Z', rotulo: 'ago/26' };
    // 3 intervalos: o foco antigo (índice 0 = ago/26) não coincide com o último completo (set/26)
    const mes = comSerie({ trafego: traf({ serie: [pt(IVAGO, { visitas: 250 }), pt(IVSET, { visitas: 300 }), pt(IVOUT, { visitas: null, unidadesPorVisita: null, estados: EST({ ok: 0, pendente: 2 }) })] }) });
    vi.mocked(useSkuDossie).mockImplementation(((_a: unknown, _p: unknown, passo: string) =>
      ({ estado: 'ok', dados: passo === 'mes' ? mes : semana, refetch: vi.fn(), refetchTrafego: vi.fn() })) as never);
    render(
      <MemoryRouter initialEntries={['/faturamento/sku/00123']}>
        <QueryClientProvider client={new QueryClient()}>
          <Routes><Route path="/faturamento/sku/:codigo" element={<SkuDossie />} /></Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('tab', { name: 'Tráfego e oferta' }));
    const reg = screen.getByRole('region', { name: REG });
    // foco sai do último completo (14/09) e anda até 07/09
    within(reg).getByRole('button', { name: /14\/09/ }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(within(reg).getByTestId('detalhe-trafego')).toHaveTextContent(/Semana de 07\/09/);
    await user.click(within(reg).getByRole('button', { name: 'Mês' }));
    // série nova: o foco volta ao último completo (set/26), não fica no índice 0 antigo nem no parcial
    const r2 = screen.getByRole('region', { name: REG });
    expect(within(r2).getByTestId('detalhe-trafego')).toHaveTextContent(/set\/26.*Visitas300/);
    expect(within(r2).getByRole('button', { name: /set\/26/ })).toHaveAttribute('tabindex', '0');
    vi.mocked(useSkuDossie).mockReset();
  });

  it('régua do tráfego: entra no último intervalo completo; setas andam e o detalhe acompanha', async () => {
    const reg = await abrirTrafego(traf());
    const b14 = within(reg).getByRole('button', { name: /14\/09/ });
    const b21 = within(reg).getByRole('button', { name: /21\/09/ });
    expect(b14).toHaveAttribute('tabindex', '0');
    expect(within(reg).getByTestId('detalhe-trafego')).toHaveTextContent(/Semana de 14\/09.*Visitas70/);
    b14.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(b21).toHaveFocus();
    expect(within(reg).getByTestId('detalhe-trafego')).toHaveTextContent(/Semana de 21\/09.*aguardando 48\sh/); // toHaveTextContent normaliza o nbsp
  });
});

describe('SkuDossie: estoque, devoluções, UFs, mix e campanhas', () => {
  it('estoque do SKU: saldo e cobertura em dias', () => {
    renderPagina('ok', dossie());
    const est = screen.getByRole('region', { name: 'Estoque' });
    expect(within(est).getByText('40 dias')).toBeInTheDocument();
    expect(within(est).getByText('12 un.')).toBeInTheDocument();
    expect(within(est).getByText(/posição em \d{2}\/\d{2}/i)).toBeInTheDocument();
  });

  it('estoque do kit: compartilhado com a base, saldo floor(base/N) e link da base', () => {
    renderPagina('ok', dossie({
      catalogo: [{ ...cat, ehKit: true, kitMultiplicador: 2, kitBaseCodigo: '00100', estoqueKit: 3 }],
      estoque: 3, cobertura: 'compartilhado',
    }));
    const est = screen.getByRole('region', { name: 'Estoque' });
    expect(within(est).getByText(/estoque compartilhado com a base/i)).toBeInTheDocument();
    expect(within(est).getByText('3 kits')).toBeInTheDocument();
    expect(within(est).getByRole('link', { name: /00100/ })).toHaveAttribute('href', '/faturamento/sku/00100');
    expect(within(est).queryByText(/\d dias/)).not.toBeInTheDocument();
  });

  it('família com irmã kit: saldo em unidades e a nota das variações kit', () => {
    renderPagina('ok', dossie({
      titulo: 'Camiseta Dry', codigos: ['00123', '00125'], estoque: 12, cobertura: 40,
      catalogo: [cat, { ...cat, codigo: '00125', ehKit: true, kitMultiplicador: 2, kitBaseCodigo: '00123', estoqueKit: 3 }],
    }), '/faturamento/sku/familia/P1');
    const est = screen.getByRole('region', { name: 'Estoque' });
    expect(within(est).getByText('12 un.')).toBeInTheDocument();
    expect(within(est).getByText('40 dias')).toBeInTheDocument();
    expect(within(est).getByText(/inclui 1 variação kit com estoque da base/i)).toBeInTheDocument();
    expect(within(est).queryByText(/kits$/)).not.toBeInTheDocument();
  });

  it('KPIs sem venda no período anterior: sem Δ e o aviso "sem histórico no período anterior"', () => {
    renderPagina('ok', dossie({ linhaAnterior: null }));
    const periodo = screen.getByRole('region', { name: 'Resultado no período' });
    expect(within(periodo).getByText(/sem histórico no período anterior/i)).toBeInTheDocument();
    expect(within(periodo).queryByText(/vs\./)).not.toBeInTheDocument();
  });

  it('KPIs com venda no período anterior: Δ aparece', () => {
    renderPagina('ok', dossie({ linhaAnterior: linha('00123', 'Camiseta Dry Azul M') }));
    const periodo = screen.getByRole('region', { name: 'Resultado no período' });
    expect(within(periodo).queryByText(/sem histórico no período anterior/i)).not.toBeInTheDocument();
    expect(within(periodo).getAllByText(/vs\./).length).toBeGreaterThan(0);
  });

  it('estoque sem ritmo: sem vendas nos últimos 30 dias, não zero dias', () => {
    renderPagina('ok', dossie({ cobertura: null }));
    expect(within(screen.getByRole('region', { name: 'Estoque' })).getByText(/sem vendas nos últimos 30 dias/i)).toBeInTheDocument();
  });

  it('devoluções: taxa com N de M pedidos e motivos por devolução (sem contar a mesma duas vezes)', () => {
    // O bloco usa o campo `motivo` do evento, nunca o texto do detalhe.
    const dev = (id: string, tipo: 'devolucao_aberta' | 'devolucao_estorno', motivo: string | null) =>
      ({ id, tipo, em: '2026-09-10T12:00:00Z', titulo: 'Devolução', detalhe: 'texto livre', motivo, vinculo: 'exato' as const, mlb: null });
    renderPagina('ok', dossie({ eventos: [
      dev('d1:abertura', 'devolucao_aberta', 'Produto com defeito'),
      dev('d1:estorno', 'devolucao_estorno', 'Produto com defeito'),
      dev('d2:abertura', 'devolucao_aberta', null),
    ] }));
    const reg = screen.getByRole('region', { name: 'Devoluções' });
    expect(within(reg).getByText('20,0%')).toBeInTheDocument();
    expect(within(reg).getByText(/1 de 5 pedidos/)).toBeInTheDocument();
    expect(within(reg).getByText('Motivos · todo o histórico (2 devoluções)')).toBeInTheDocument();
    const motivos = within(reg).getByRole('list', { name: /Motivos/ });
    expect(within(motivos).getAllByRole('listitem')).toHaveLength(2);
    expect(within(motivos).getByText('Produto com defeito')).toBeInTheDocument();
    expect(within(motivos).getByText('não informado')).toBeInTheDocument();
  });

  it('UFs: mapa, top 5 com % e "sem localização"', () => {
    renderPagina('ok', dossie({ ufs: { valores: { SP: 200, RJ: 50, MG: 30, PR: 10, SC: 5, BA: 5 }, semUf: 20 } }));
    const reg = screen.getByRole('region', { name: 'Vendas por estado' });
    expect(within(reg).getByLabelText('Mapa do Brasil por UF')).toBeInTheDocument();
    const top = within(reg).getByRole('list', { name: /Maiores estados/ });
    expect(within(top).getAllByRole('listitem')).toHaveLength(5);
    expect(within(top).getByText('SP')).toBeInTheDocument();
    expect(within(top).queryByText('BA')).not.toBeInTheDocument();
    expect(within(top).getByText('62,5%')).toBeInTheDocument(); // 200 / 320
    expect(within(reg).getByText(/sem localização/i)).toBeInTheDocument();
  });

  it('UFs vazias: aviso próprio', () => {
    renderPagina('ok', dossie());
    expect(within(screen.getByRole('region', { name: 'Vendas por estado' })).getByText('Nenhuma venda no período')).toBeInTheDocument();
  });

  it('mix da família: irmã sem venda como "sem vendas" e cada linha abre o dossiê da variação', () => {
    const de = '/faturamento?aba=sku&busca=dry';
    renderPagina('ok', dossie({ titulo: 'Camiseta Dry', codigos: ['00123', '00124'], mix: [
      { codigo: '00123', titulo: 'Camiseta Dry Azul M', unidades: 6, participacaoUnidades: 1, lucro: 90, deltaLucro: 10, semVendas: false, novaNoPeriodo: false },
      { codigo: '00124', titulo: 'Camiseta Dry Azul G', unidades: 0, participacaoUnidades: 0, lucro: null, deltaLucro: -15, semVendas: true, novaNoPeriodo: false },
    ] }), { pathname: '/faturamento/sku/familia/P1', state: { de } });
    const reg = screen.getByRole('region', { name: 'Mix da família' });
    expect(within(reg).getByText('sem vendas')).toBeInTheDocument();
    expect(within(reg).getByText('100,0%')).toBeInTheDocument();
    expect(within(reg).getByRole('link', { name: /Camiseta Dry Azul G/ })).toHaveAttribute('href', '/faturamento/sku/00124');
    expect(within(reg).getAllByRole('link').every((a) => !a.getAttribute('href')?.includes('familia:'))).toBe(true);
  });

  it('mix da família: irmã nova no período explica que o Δ é o lucro inteiro', () => {
    renderPagina('ok', dossie({ titulo: 'Camiseta Dry', codigos: ['00123', '00125'], mix: [
      { codigo: '00123', titulo: 'Camiseta Dry Azul M', unidades: 6, participacaoUnidades: 0.6, lucro: 90, deltaLucro: 10, semVendas: false, novaNoPeriodo: false },
      { codigo: '00125', titulo: 'Camiseta Dry Rosa M', unidades: 4, participacaoUnidades: 0.4, lucro: 30, deltaLucro: 30, semVendas: false, novaNoPeriodo: true },
    ] }), { pathname: '/faturamento/sku/familia/P1', state: null });
    const reg = screen.getByRole('region', { name: 'Mix da família' });
    const titulo = 'Sem vendas desta variação no período anterior: o Δ é o lucro inteiro deste período.';
    const celulas = within(reg).getAllByTitle(titulo);
    expect(celulas).toHaveLength(1);
    expect(celulas[0].closest('tr')).toHaveTextContent('Camiseta Dry Rosa M');
  });

  it('SKU solto não tem mix', () => {
    renderPagina('ok', dossie());
    expect(screen.queryByRole('region', { name: 'Mix da família' })).not.toBeInTheDocument();
  });

  it('campanhas: situação atual, participação histórica desconhecida', () => {
    renderPagina('ok', dossie({ campanhas: [{
      mlb: 'MLB1', nome: 'Oferta da semana', tipo: 'LIGHTNING', statusItem: 'started', statusCampanha: 'started', precoPromo: 29.9,
      vigencia: { inicio: '2026-09-20T03:00:00Z', fim: '2026-09-30T03:00:00Z' }, sincronizadoEm: '2026-09-27T12:00:00Z',
    }] }));
    const reg = screen.getByRole('region', { name: 'Campanhas' });
    expect(within(reg).getByText(/participação histórica desconhecida/)).toBeInTheDocument();
    expect(within(reg).getByText('Oferta da semana')).toBeInTheDocument();
    expect(within(reg).getByText('Participando')).toBeInTheDocument();
    expect(within(reg).getByText('R$ 29,90')).toBeInTheDocument();
    expect(within(reg).getByText(/sincronizado em/i)).toBeInTheDocument();
  });

  it('campanhas vazias: aviso próprio', () => {
    renderPagina('ok', dossie());
    expect(within(screen.getByRole('region', { name: 'Campanhas' })).getByText('Nenhuma campanha nos anúncios deste código')).toBeInTheDocument();
  });
});

describe('RankingSku → dossiê', () => {
  it('nome do SKU leva ao dossiê; a linha sem código não tem link', () => {
    render(
      <MemoryRouter initialEntries={['/faturamento?aba=sku']}><QueryClientProvider client={new QueryClient()}>
        <RankingSku linhas={[linha('00123', 'Camiseta Dry Azul M'), { ...linha(SEM_CODIGO, 'Avulso'), codigoPai: null }]} familias={null}
          tendencias={new Map()} coberturas={new Map()} alertas={new Map()} abc={new Map()} ordem="lucro" onOrdem={() => {}} />
      </QueryClientProvider></MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /Camiseta Dry Azul M/ })).toHaveAttribute('href', '/faturamento/sku/00123');
    const avulso = screen.getByText('Avulso');
    expect(avulso.closest('a')).toBeNull();
    expect(within(screen.getByRole('table')).getAllByRole('link')).toHaveLength(1);
  });

  it('família "sem-familia:" não tem link; família real tem', () => {
    const solta = { ...linha('00999', 'Avulso solto'), codigoPai: 'sem-familia:00999', nomeFamilia: null };
    const real = linha('00123', 'Camiseta Dry Azul M');
    render(
      <MemoryRouter><QueryClientProvider client={new QueryClient()}>
        <RankingSku linhas={[]} familias={[
          { codigoPai: 'P1', nomeFamilia: 'Camiseta Dry', acc: real.acc, m: real.m, filhos: [real] },
          { codigoPai: 'sem-familia:00999', nomeFamilia: null, acc: solta.acc, m: solta.m, filhos: [solta] },
        ]} tendencias={new Map()} coberturas={new Map()} alertas={new Map()} abc={new Map()} ordem="lucro" onOrdem={() => {}} />
      </QueryClientProvider></MemoryRouter>,
    );
    const links = within(screen.getByRole('table')).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/faturamento/sku/familia/P1');
  });
});

describe('idadeComercial', () => {
  it('dias, meses e anos', () => {
    const agora = Date.parse('2026-09-27T12:00:00Z');
    expect(idadeComercial('2026-09-26T12:00:00Z', agora)).toBe('1 dia');
    expect(idadeComercial('2026-08-01T12:00:00Z', agora)).toBe('57 dias');
    expect(idadeComercial('2026-05-10T12:00:00Z', agora)).toBe('4 meses');
    expect(idadeComercial('2025-06-01T12:00:00Z', agora)).toBe('1 ano e 3 meses');
  });
});

describe('SkuDossie: Ads', () => {
  it('aba Ads ao lado do tráfego; erro de leitura refaz só os Ads', async () => {
    const ads = { estado: 'erro', alcance: 'indisponivel', totais: null, lucroAposAds: null, motivoSemLucro: null,
      compartilhadoCom: { codigos: [], semVinculo: 0 }, serie: [], serieDiaria: [], grupos: [], coberturaDesde: null,
      ultimoOkEm: null, diasAbertos: 0, erro: null };
    renderPagina('ok', dossie(), '/faturamento/sku/00123', ads);
    const h = vi.mocked(useSkuDossie).mock.results.at(-1)!.value as { refetch: () => void; refetchTrafego: () => void; refetchAds: () => void };
    await userEvent.click(screen.getByRole('tab', { name: 'Ads' }));
    const reg = screen.getByRole('region', { name: 'Ads' });
    await userEvent.click(within(reg).getByRole('button', { name: 'Tentar de novo' }));
    expect(h.refetchAds).toHaveBeenCalled();
    expect(h.refetch).not.toHaveBeenCalled();
    expect(h.refetchTrafego).not.toHaveBeenCalled();
  });
});
