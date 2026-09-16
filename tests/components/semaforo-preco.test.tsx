import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SemaforoPreco } from '@/components/semaforo-preco';
import { useTarifaML } from '@/hooks/useTarifaML';

vi.mock('@/hooks/useTarifaML', () => ({ useTarifaML: vi.fn() }));

function renderWithClient(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const PROPS_BASE = {
  piso: 20,
  custo: 10,
  categoriaMlId: 'MLB123',
};

describe('SemaforoPreco — badge de frete por conta do vendedor', () => {
  it('preço R$19 com frete real > 0: badge "frete por sua conta" aparece (regressão do bug do heurístico preco > 19)', () => {
    vi.mocked(useTarifaML).mockReturnValue({
      data: { classico: { recebe: 15 }, frete: 4.5 },
      isLoading: false,
    } as ReturnType<typeof useTarifaML>);

    renderWithClient(<SemaforoPreco preco={19} {...PROPS_BASE} />);

    expect(screen.getByText('frete por sua conta')).toBeInTheDocument();
  });

  it('preço R$25 mas frete=0: badge NÃO aparece (não é mais heurístico por preço)', () => {
    vi.mocked(useTarifaML).mockReturnValue({
      data: { classico: { recebe: 25 }, frete: 0 },
      isLoading: false,
    } as ReturnType<typeof useTarifaML>);

    renderWithClient(<SemaforoPreco preco={25} {...PROPS_BASE} />);

    expect(screen.queryByText('frete por sua conta')).not.toBeInTheDocument();
  });

  it('preço R$16,70 com líquido acima do piso e frete=0: mostra "Vale a pena" sem badge de frete', () => {
    vi.mocked(useTarifaML).mockReturnValue({
      data: { classico: { recebe: 21 }, frete: 0 },
      isLoading: false,
    } as ReturnType<typeof useTarifaML>);

    renderWithClient(<SemaforoPreco preco={16.7} {...PROPS_BASE} />);

    expect(screen.getByText('Vale a pena')).toBeInTheDocument();
    expect(screen.queryByText('frete por sua conta')).not.toBeInTheDocument();
  });
});
