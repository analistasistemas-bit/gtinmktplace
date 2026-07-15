import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Publicados from '@/pages/Publicados';
import type { PublicadoItem } from '@/lib/publicados';

const usePublicadosMock = vi.fn();
const useStatusPublicadosMock = vi.fn();
const useRemoverPublicadoMock = vi.fn();
const usePausarReativarPublicadoMock = vi.fn();
const useResumoFinanceiroMock = vi.fn();
const useVendasMock = vi.fn();
const useCustosMock = vi.fn();
const useCanaisHabilitadosMock = vi.fn();

vi.mock('@/hooks/usePublicados', () => ({
  usePublicados: () => usePublicadosMock(),
}));

vi.mock('@/hooks/useVendas', () => ({
  useVendas: () => useVendasMock(),
}));

vi.mock('@/hooks/useCustos', () => ({
  useCustos: () => useCustosMock(),
}));

// CanalTabs (D2/D3): sem QueryClient no teste, mockamos o hook de canais habilitados.
vi.mock('@/hooks/useCanaisHabilitados', () => ({
  useCanaisHabilitados: () => useCanaisHabilitadosMock(),
}));
vi.mock('@/hooks/useConfiguracoes', () => ({
  useAliquotas: () => ({ data: { nacional: 8, importado: 16 } }),
}));

vi.mock('@/hooks/useStatusPublicados', () => ({
  useStatusPublicados: () => useStatusPublicadosMock(),
}));

vi.mock('@/hooks/useRemoverPublicado', () => ({
  useRemoverPublicado: () => useRemoverPublicadoMock(),
}));

vi.mock('@/hooks/usePausarReativarPublicado', () => ({
  usePausarReativarPublicado: () => usePausarReativarPublicadoMock(),
}));

vi.mock('@/hooks/useResumoFinanceiro', () => ({
  useResumoFinanceiro: () => useResumoFinanceiroMock(),
}));

// Expandir item carrega a família via react-query; sem QueryClient no teste, mockamos o hook.
vi.mock('@/hooks/useFamilia', () => ({
  useFamilia: () => ({ data: undefined, isLoading: false, isError: false }),
}));

function itemBase(over: Partial<PublicadoItem> = {}): PublicadoItem {
  return {
    familiaId: 'f1',
    codigoPai: '01829149',
    titulo: 'COLA LIQUIDA SILICONE 250ML',
    fornecedor: 'BUFALO',
    tipo: 'cola',
    categoria: null,
    precoPublicacao: 24.1,
    descricao: 'descricao',
    mlItemId: 'MLB1',
    mlPermalink: 'https://example.com/mlb1',
    publicadoEm: '2026-06-12T12:36:04.408Z',
    status: 'ativo',
    estoque: 87,
    precoAtual: 24.1,
    motivo: null,
    ...over,
  };
}

describe('Publicados', () => {
  beforeEach(() => {
    sessionStorage.clear(); // expansão da linha agora persiste em sessionStorage; isolar entre casos
    HTMLElement.prototype.scrollIntoView = vi.fn();
    usePublicadosMock.mockReturnValue({
      data: [itemBase()],
      isLoading: false,
      error: null,
    });
    useStatusPublicadosMock.mockReturnValue({
      data: { itens: [] },
      isFetching: false,
      refetch: vi.fn(),
    });
    useRemoverPublicadoMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: null,
    });
    usePausarReativarPublicadoMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: null,
    });
    useResumoFinanceiroMock.mockReturnValue({
      data: { semCredencialMP: true },
      isFetching: false,
      refetch: vi.fn(),
    });
    useVendasMock.mockReturnValue({
      data: [],
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    useCustosMock.mockReturnValue({ data: undefined });
    useCanaisHabilitadosMock.mockReturnValue({ data: ['mercado_livre'] });
  });

  it('oferece Cola no filtro de tipos', () => {
    render(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByRole('combobox')[2]);

    expect(screen.getByRole('option', { name: 'Cola' })).toBeInTheDocument();
  });

  it('mostra a ponte de líquido linkando para o Financeiro quando há dados', () => {
    // A ponte deriva de calcularResumo(vendas) (ADR-0038): líquido = soma de ml_vendas.liquido.
    useVendasMock.mockReturnValue({
      data: [{
        id: 'v1', order_id: 1, status: 'paid', total_amount: 606.8, liquido: 364.46,
        estorno: null, pack_id: null, shipping_id: null, frete_vendedor: null, itens: [],
      }],
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    render(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );
    const ponte = screen.getByRole('link', { name: /Líquido das vendas/i });
    expect(ponte).toHaveAttribute('href', '/financeiro');
    expect(ponte).toHaveTextContent('R$ 364,46');
  });

  it('exibe o selo do modo (Premium) vindo do status ao vivo', () => {
    useStatusPublicadosMock.mockReturnValue({
      data: { itens: [{ ml_item_id: 'MLB1', status: 'ativo', motivo: null, estoque: 87, preco: 24.1, listingType: 'premium' }] },
      isFetching: false,
      refetch: vi.fn(),
    });
    render(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );
    expect(screen.getByText('Premium')).toBeInTheDocument();
  });

  it('expandir a linha abre a área de análise (aria-expanded)', () => {
    render(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );
    const toggle = screen.getByRole('button', { name: 'Expandir análise' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Recolher análise' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('clicar em qualquer lugar da linha também expande', () => {
    render(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );
    // clica no título do produto (fora da seta) → a linha inteira é clicável
    fireEvent.click(screen.getByText('COLA LIQUIDA SILICONE 250ML'));
    expect(screen.getByRole('button', { name: 'Recolher análise' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('recorta a lista pelo canal ativo (?canal=): ML aparece, Shopee some; "todos" mostra os dois', () => {
    // parseCanalAtivo só aceita canal operável (habilitado E ativo no registry) — hoje só
    // 'mercado_livre' é 'ativo', então o item shopee nunca vira canal ativo válido, apenas
    // o que deve sumir do recorte quando o filtro é 'mercado_livre'.
    usePublicadosMock.mockReturnValue({
      data: [
        itemBase(),
        itemBase({
          familiaId: 'f2',
          codigoPai: '02000000',
          titulo: 'TESOURA INOX SHOPEE',
          mlItemId: 'MLB2',
          canal: 'shopee',
        }),
      ],
      isLoading: false,
      error: null,
    });

    const comFiltro = render(
      <MemoryRouter initialEntries={['/publicados?canal=mercado_livre']}>
        <Publicados />
      </MemoryRouter>,
    );
    expect(screen.getByText('COLA LIQUIDA SILICONE 250ML')).toBeInTheDocument();
    expect(screen.queryByText('TESOURA INOX SHOPEE')).not.toBeInTheDocument();
    comFiltro.unmount();

    render(
      <MemoryRouter initialEntries={['/publicados']}>
        <Publicados />
      </MemoryRouter>,
    );
    expect(screen.getByText('COLA LIQUIDA SILICONE 250ML')).toBeInTheDocument();
    expect(screen.getByText('TESOURA INOX SHOPEE')).toBeInTheDocument();
  });
});
