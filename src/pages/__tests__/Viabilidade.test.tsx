import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import Viabilidade from '../Viabilidade';

vi.mock('@/hooks/useAnaliseViabilidade', () => ({
  useAnaliseViabilidade: () => ({
    data: undefined,
    error: null,
    isError: false,
    isPending: false,
    isSuccess: false,
    mutate: vi.fn(),
    variables: undefined,
  }),
}));

vi.mock('@/components/calculadora-ml/calculadora-ml', () => ({
  CalculadoraML: () => <div data-testid="calculadora-ml">Calculadora ML montada</div>,
}));

function renderViabilidade() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Viabilidade />
    </QueryClientProvider>,
  );
}

describe('Viabilidade', () => {
  it('alterna entre análise de mercado e Calculadora ML sem perder as opções da análise', async () => {
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
});
