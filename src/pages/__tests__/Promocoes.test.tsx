import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Promocoes from '../Promocoes';
import { useAtualizarPromocoes, useEstadoSyncPromocoes, usePromocoes } from '@/hooks/usePromocoes';
import { useCanalAtivo } from '@/hooks/useCanalAtivo';

vi.mock('@/hooks/usePromocoes', () => ({
  usePromocoes: vi.fn(), useEstadoSyncPromocoes: vi.fn(), useAtualizarPromocoes: vi.fn(),
}));
vi.mock('@/hooks/useCanalAtivo', () => ({ useCanalAtivo: vi.fn() }));

const QUERY_PENDENTE = { data: undefined, isLoading: true, isPending: true };
const QUERY_VAZIA = { data: [], isLoading: false, isPending: false };

function renderPromocoes() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <Promocoes />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Promocoes', () => {
  beforeEach(() => {
    vi.mocked(useAtualizarPromocoes).mockReturnValue({ mutate: vi.fn(), isPending: false } as never);
    vi.mocked(useCanalAtivo).mockReturnValue({ canal: 'todos', setCanal: vi.fn(), habilitados: ['mercado_livre'] } as never);
  });

  it('com as duas queries carregando, não mostra o painel de estado de sync (sem flash contraditório com o skeleton)', () => {
    vi.mocked(usePromocoes).mockReturnValue(QUERY_PENDENTE as never);
    vi.mocked(useEstadoSyncPromocoes).mockReturnValue(QUERY_PENDENTE as never);
    renderPromocoes();

    expect(screen.queryByText('Ainda não buscamos as promoções desta conta.')).toBeNull();
  });

  it('depois de carregar, sem dados e sem estado, mostra o convite a buscar', () => {
    vi.mocked(usePromocoes).mockReturnValue(QUERY_VAZIA as never);
    vi.mocked(useEstadoSyncPromocoes).mockReturnValue({ data: null, isLoading: false, isPending: false } as never);
    renderPromocoes();

    expect(screen.getByText('Ainda não buscamos as promoções desta conta.')).toBeTruthy();
  });
});
