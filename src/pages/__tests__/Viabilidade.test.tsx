import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Viabilidade from '../Viabilidade';
import { useAnaliseViabilidade } from '@/hooks/useAnaliseViabilidade';
import type { ItemAnalisado } from '@/lib/viabilidade';

const SEM_DADOS = {
  data: undefined,
  error: null,
  isError: false,
  isPending: false,
  isSuccess: false,
  mutate: vi.fn(),
  variables: undefined,
};

vi.mock('@/hooks/useAnaliseViabilidade', () => ({ useAnaliseViabilidade: vi.fn() }));

vi.mock('@/hooks/useTabelaFreteML', () => ({
  useTabelaFreteML: () => ({
    data: {
      faixasPreco: [{ label: 'Até R$ 18,99' }],
      faixasPeso: [{ label: 'Até 300 g' }],
      celulas: [[0]],
    },
    isLoading: false,
    isError: false,
  }),
  isTabelaFrete: (r: unknown) => !!r && typeof r === 'object' && 'faixasPreco' in r,
}));

vi.mock('@/components/calculadora-ml/calculadora-ml', () => ({
  CalculadoraML: () => <div data-testid="calculadora-ml">Calculadora ML montada</div>,
}));

function renderViabilidade() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <Viabilidade />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Viabilidade', () => {
  it('alterna entre análise de mercado e Calculadora ML sem perder as opções da análise', async () => {
    vi.mocked(useAnaliseViabilidade).mockReturnValue(SEM_DADOS as never);
    const user = userEvent.setup();
    renderViabilidade();

    expect(screen.getByRole('tab', { name: 'Análise de mercado' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Calculadora ML' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Subir planilha' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Colar GTINs' })).toBeInTheDocument();
    expect(screen.queryByTestId('calculadora-ml')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Calculadora ML' }));
    expect(screen.getByTestId('calculadora-ml')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Subir planilha' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Análise de mercado' }));
    expect(screen.getByRole('tab', { name: 'Subir planilha' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Colar GTINs' })).toBeInTheDocument();
    expect(screen.queryByTestId('calculadora-ml')).not.toBeInTheDocument();
  });

  it('mostra a tabela de frete do Mercado Envios como último bloco, depois da análise', () => {
    const item = {
      gtin: '7891025111825',
      nome: 'Fórmula Infantil Aptamil Premium 1 800g Danone',
      unidade: null,
      minimo: null,
      custo: null,
      origem: 'nacional',
      existeNoML: true,
      categoriaMlId: 'MLB269341',
      mercado: {
        menor: 70.19, maior: 145.99, vendedores: 27, freteGratis: 21, full: 3, ofertas: 27,
        observado: { menor: 36, maior: 179.99, vendedores: 88, ofertas: 90 },
      },
    } as unknown as ItemAnalisado;
    vi.mocked(useAnaliseViabilidade).mockReturnValue({
      ...SEM_DADOS,
      data: { itens: [item], ignorados: 0, me2Habilitado: true },
      isSuccess: true,
      variables: { tipo: 'gtins', gtins: [item.gtin] },
    } as never);

    renderViabilidade();

    const posicaoTabela = screen.getByText(item.nome).compareDocumentPosition(
      screen.getByText('Frete que o vendedor absorve (Mercado Envios)', { exact: false }),
    );
    // DOCUMENT_POSITION_FOLLOWING (4): o texto do frete vem DEPOIS do produto no DOM.
    expect(posicaoTabela & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
