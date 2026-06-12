import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/components/theme-provider';
import Viabilidade from '@/pages/Viabilidade';

// useAnaliseViabilidade usa useMutation (TanStack Query) — só precisa do
// QueryClientProvider; não faz fetch no mount, então não requer mock de rede.
function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <Viabilidade />
      </QueryClientProvider>
    </ThemeProvider>
  );
}

describe('Página Viabilidade', () => {
  it('mostra o título e as duas abas de entrada', () => {
    renderPage();
    expect(screen.getByText('Análise de viabilidade')).toBeInTheDocument();
    expect(screen.getByText('Subir planilha')).toBeInTheDocument();
    expect(screen.getByText('Colar GTINs')).toBeInTheDocument();
  });
});
