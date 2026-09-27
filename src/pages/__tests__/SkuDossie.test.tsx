import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import SkuDossie from '../SkuDossie';
import { idadeComercial } from '@/components/sku-dossie/formato-dossie';
import { useSkuDossie } from '@/hooks/useSkuDossie';
import { RankingSku } from '@/components/faturamento/ranking-sku';
import { SEM_CODIGO, metricas, somarAcumuladores, type LinhaSku } from '@/lib/vendas-sku';
import type { DossieSku, EstadoDossie } from '@/lib/sku-dossie';
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
  ufs: { valores: {}, semUf: 0 }, mix: null, campanhas: [], mlbs: new Map(),
  qualidade: { pctBrutoCustoReal: 0.9, fontesParciais: ['Promoções: só a situação atual'] },
  ...over,
});

function renderPagina(estado: EstadoDossie, dados: DossieSku | null, rota = '/faturamento/sku/00123') {
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
