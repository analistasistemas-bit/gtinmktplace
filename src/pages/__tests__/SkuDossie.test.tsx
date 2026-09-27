import { fireEvent, render, screen, within } from '@testing-library/react';
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
  ...over,
});

function renderPagina(estado: EstadoDossie, dados: DossieSku | null, rota: string | { pathname: string; state: unknown } = '/faturamento/sku/00123') {
  vi.mocked(useSkuDossie).mockReturnValue({ estado, dados, refetch: vi.fn() } as never);
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
    expect(screen.getByText('20,0%')).toBeInTheDocument(); // taxa de devolução 1/5
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
    expect(screen.getByText('desconhecido')).toBeInTheDocument();
  });

  it('sem vendas: cabeçalho, estoque e o aviso, sem KPIs', () => {
    renderPagina('sem_vendas', dossie({ linhaPeriodo: null, tendencia: null, historicoDesde: null, ultimaVenda: null }));
    expect(screen.getByText('Sem vendas registradas desde a entrada no PubliAI')).toBeInTheDocument();
    expect(screen.getByText('12 un.')).toBeInTheDocument();
    expect(screen.queryByText('Faturamento')).not.toBeInTheDocument();
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
    { id: 'e1', tipo: 'moderacao_detectada', em: '2026-09-16T12:00:00Z', titulo: 'Moderação detectada', detalhe: 'Foto', vinculo: 'compartilhado', mlb: 'MLB3' },
    { id: 'e2', tipo: 'moderacao_resolvida', em: '2026-09-18T12:00:00Z', titulo: 'Resolução observada', detalhe: null, vinculo: 'nao_resolvido', mlb: 'MLB9' },
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
    expect(screen.getByText(/3 un\. dentro de kit/)).toBeInTheDocument();
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
      eventos: [{ id: 'e3', tipo: 'ruptura', em: '2026-09-16T12:00:00Z', titulo: 'Ruptura do kit', detalhe: null, vinculo: 'exato', mlb: null }],
    }));
    expect(within(screen.getByRole('region', { name: 'Eventos' })).getByText('estoque da base')).toBeInTheDocument();
  });

  it('eventos vazios: aviso próprio', () => {
    renderPagina('ok', comSerie({ eventos: [] }));
    expect(within(screen.getByRole('region', { name: 'Eventos' })).getByText('Nenhum evento registrado')).toBeInTheDocument();
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
