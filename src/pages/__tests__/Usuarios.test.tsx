import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
    functions: { invoke: vi.fn() },
  },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useConfiguracoes', () => ({
  useEnviarTesteTelegram: () => ({ isPending: false, mutate: vi.fn() }),
}));

import Usuarios from '../Usuarios';

describe('Usuarios', () => {
  it('oferece acesso ao histórico de suporte no cabeçalho', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <Usuarios />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /histórico de suporte/i }))
      .toHaveAttribute('href', '/suporte');
    expect(screen.getByRole('button', { name: /convidar usuário/i }))
      .toBeInTheDocument();
  });
});
