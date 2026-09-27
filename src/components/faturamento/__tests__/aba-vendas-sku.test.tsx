import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AbaVendasSku } from '@/components/faturamento/aba-vendas-sku';
import { metricas, somarAcumuladores, type LinhaSku, type VendasSku } from '@/lib/vendas-sku';

function linha(codigo: string, lucro: number | null, over: { semCusto?: boolean; parcial?: boolean; codigoPai?: string } = {}): LinhaSku {
  const acc = somarAcumuladores([]);
  acc.bruto = 100; acc.unidades = 2; acc.pedidos = 2; acc.liquido = 80;
  if (lucro != null) { acc.itensComCusto = 1; acc.unidadesComCusto = 2; acc.custo = 80 - lucro; acc.liquidoComCusto = 80; acc.brutoComCusto = 100; acc.brutoCustoReal = 100; }
  if (over.semCusto || over.parcial) acc.itensSemCusto = 1;
  return { codigo, titulo: `Produto ${codigo}`, imagemPath: null, codigoPai: over.codigoPai ?? 'P', nomeFamilia: 'Família P',
    fornecedor: null, origem: null, ehKit: false, estoque: 10, primeiraVenda: null, acc, m: metricas(acc), pedidoChaves: ['1'] };
}
const kz = { bruto: 0, lucro: null, markup: null, margemSVenda: null, unidades: 0, skusComVenda: 0, skusVendaUnica: 0, concentracaoTop5: null, pctBrutoCustoReal: null, prejuizo: 0 };
const dados: VendasSku = {
  linhas: [linha('A', 30), linha('C', 10), linha('B', null, { semCusto: true }), linha('D', 5, { parcial: true })],
  linhasAnterior: [],
  kpis: { bruto: 400, lucro: 45, markup: 0.6, margemSVenda: 0.3, unidades: 8, skusComVenda: 4, skusVendaUnica: 0, concentracaoTop5: 1, pctBrutoCustoReal: 0.5, prejuizo: 0 },
  kpisAnterior: kz,
  tendencias: new Map([['A', 'em_alta']]), coberturas: new Map(), alertas: new Map([['B', ['sem_custo']]]),
  variacoes: [], insights: [{ texto: '1 SKU faz metade do lucro do período.', skus: [{ codigo: 'A', nome: 'Família P · Preto', detalhe: 'R$ 10,00' }] }], parados: 0, devolucoesNaoAtribuidas: 0,
  historicoDesde: '2026-06-02T12:00:00Z',
};
vi.mock('@/hooks/useVendasSku', () => ({ useVendasSku: () => ({ dados, isLoading: false, isFetching: false, refetch: vi.fn() }) }));

const renderAba = () => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter><AbaVendasSku /></MemoryRouter></QueryClientProvider>,
);

describe('AbaVendasSku', () => {
  it('faixa separa sem custo de lucro parcial; rótulos Markup e Margem s/ venda; histórico com data', () => {
    renderAba();
    expect(screen.getByText(/1 SKU sem custo/i)).toBeInTheDocument();
    expect(screen.getByText(/1 com lucro parcial/i)).toBeInTheDocument();
    expect(screen.getAllByText('Markup').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Margem s/ venda').length).toBeGreaterThan(0);
    expect(screen.getByText(/Histórico desde 02\/06\/2026/)).toBeInTheDocument();
  });

  it('leitura do período lista de quais SKUs fala, com link para o dossiê', () => {
    renderAba();
    expect(screen.getByText('ver quais')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Família P · Preto', hidden: true })).toHaveAttribute('href', '/faturamento/sku/A');
  });

  it('ordena por lucro e troca a ordem ao clicar em Unidades', () => {
    renderAba();
    const nomes = () => screen.getAllByTestId('sku-titulo').map((e) => e.textContent);
    expect(nomes()[0]).toBe('Produto A');
    fireEvent.click(screen.getByRole('button', { name: /Unidades/ }));
    expect(nomes()).toHaveLength(4);
  });

  it('agrupar por família mostra a família e, ao expandir, as variações', () => {
    renderAba();
    fireEvent.click(screen.getByRole('button', { name: 'Agrupar por família' }));
    expect(screen.getByText(/Família P \(4 variações\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Família P \(4 variações\)/ })).toHaveAttribute('href', '/faturamento/sku/familia/P');
    fireEvent.click(screen.getByRole('button', { name: /Mostrar variações de Família P/ }));
    expect(screen.getAllByTestId('sku-titulo').map((e) => e.textContent)).toContain('Produto A');
  });

  it('abrir a conta de um filho não fecha a família', () => {
    renderAba();
    fireEvent.click(screen.getByRole('button', { name: 'Agrupar por família' }));
    fireEvent.click(screen.getByRole('button', { name: /Mostrar variações de Família P/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver a conta de Produto A' }));
    expect(screen.getAllByTestId('sku-titulo').map((e) => e.textContent)).toEqual(expect.arrayContaining(['Produto A', 'Produto C']));
    expect(screen.getByText('Comissão + frete')).toBeInTheDocument();
  });
});
