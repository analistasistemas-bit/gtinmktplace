import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import Configuracoes from '@/pages/Configuracoes';

vi.mock('@/hooks/useMlConnection', () => ({
  useMlConnection: () => ({ data: { conectado: false }, isLoading: false }),
}));
vi.mock('@/components/config-telegram', () => ({ ConfigTelegram: () => <div /> }));

const salvarReancoraLiderAtiva = vi.fn();
const salvarMostrarLucroDashboard = vi.fn();

vi.mock('@/hooks/useConfiguracoes', () => ({
  useDescontoPct: () => ({ data: 15 }),
  useSalvarDescontoPct: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
  useDescontoConcorrenciaPct: () => ({ data: 5 }),
  useSalvarDescontoConcorrenciaPct: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
  useAliquotas: () => ({ data: { nacional: 8, importado: 16 } }),
  useSalvarAliquotas: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
  useReancoraLiderAtiva: () => ({ data: true }),
  useSalvarReancoraLiderAtiva: () => ({ mutate: salvarReancoraLiderAtiva, isPending: false, isSuccess: false }),
  useMostrarLucroDashboard: () => ({ data: false }),
  useSalvarMostrarLucroDashboard: () => ({ mutate: salvarMostrarLucroDashboard, isPending: false, isSuccess: false }),
  useModeloTexto: () => ({ data: 'openai/gpt-4o-mini' }),
  useSalvarModeloTexto: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
  useModeloImagem: () => ({ data: 'google/gemini-2.5-flash-image' }),
  useSalvarModeloImagem: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <Configuracoes />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe('Configurações — re-âncora no piso dos MercadoLíderes', () => {
  it('reflete o valor atual e dispara a mutation ao alternar', () => {
    renderPage();

    const toggle = screen.getByRole('switch', { name: /ancorar preço no piso dos MercadoLíderes/i });
    expect(toggle).toHaveAttribute('data-state', 'checked');

    fireEvent.click(toggle);
    expect(salvarReancoraLiderAtiva).toHaveBeenCalledWith(false);
  });
});

describe('Configurações — mostrar lucro no Dashboard', () => {
  it('reflete o valor atual (desligado) e dispara a mutation ao alternar', () => {
    renderPage();

    const toggle = screen.getByRole('switch', { name: /mostrar lucro no card do dashboard/i });
    expect(toggle).toHaveAttribute('data-state', 'unchecked');

    fireEvent.click(toggle);
    expect(salvarMostrarLucroDashboard).toHaveBeenCalledWith(true);
  });
});
