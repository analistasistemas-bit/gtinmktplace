import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const { usePlatformOrganizations, start } = vi.hoisted(() => ({
  usePlatformOrganizations: vi.fn(),
  start: vi.fn(),
}));

vi.mock('@/hooks/usePlatformAdmin', () => ({ usePlatformOrganizations }));
vi.mock('@/stores/support-store', () => ({
  useSupportStore: (selector: (state: { start: typeof start }) => unknown) => selector({ start }),
}));
vi.mock('@/components/platform-admin/org-results', () => ({
  OrgResults: ({ orgId, month }: { orgId: string; month: string }) => <p>Resultados {orgId} {month}</p>,
}));
vi.mock('@/components/platform-admin/org-pulse', () => ({
  OrgPulse: ({ orgId, month }: { orgId: string; month: string }) => <p>Pulse {orgId} {month}</p>,
}));
vi.mock('@/components/platform-admin/org-billing', () => ({
  OrgBilling: ({ orgId, month }: { orgId: string; month: string }) => <p>Cobrança {orgId} {month}</p>,
}));
vi.mock('@/components/platform-admin/org-audit', () => ({
  OrgAudit: ({ orgId, month }: { orgId: string; month: string }) => <p>Auditoria {orgId} {month}</p>,
}));
vi.mock('@/components/platform-admin/org-settings', () => ({
  OrgSettings: ({ orgId }: { orgId: string }) => <p>Configurações {orgId}</p>,
}));

import OrganizacaoDetalhe from '../OrganizacaoDetalhe';

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.search}</p>;
}

function renderPage(initialEntry = '/admin/organizacoes/org-avil?mes=2026-08') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/admin/organizacoes/:orgId" element={<><OrganizacaoDetalhe /><LocationProbe /></>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  usePlatformOrganizations.mockReturnValue({
    data: {
      rows: [{
        id: 'org-avil',
        nome: 'Avil',
        slug: 'avil',
        is_test: true,
        modality: 1,
        metrics: null,
        forecast_cents: null,
        billable_units: null,
        daludi_searches: null,
        pending_count: null,
      }],
      total: 1,
      page: 1,
      page_size: 100,
    },
    isLoading: false,
    isError: false,
    isStale: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OrganizacaoDetalhe', () => {
  it('mantém identidade, período e resultados sem iniciar suporte', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Avil' })).toBeInTheDocument();
    expect(screen.getByText('avil')).toBeInTheDocument();
    expect(screen.getByText('Ambiente de teste')).toBeInTheDocument();
    expect(screen.getByLabelText('Mês da organização')).toHaveValue('2026-08');
    expect(screen.getByText('Resultados org-avil 2026-08')).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
  });

  it('preserva a aba escolhida na URL e integra cobrança/configurações existentes', async () => {
    const user = userEvent.setup();
    renderPage('/admin/organizacoes/org-avil?mes=2026-08&aba=cobranca');

    expect(screen.getByText('Cobrança org-avil 2026-08')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Configurações' }));
    expect(screen.getByText('Configurações org-avil')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('mes=2026-08');
    expect(screen.getByTestId('location')).toHaveTextContent('aba=configuracoes');
    expect(start).not.toHaveBeenCalled();
  });

  it('expõe falha de carregamento em vez de um detalhe vazio', () => {
    usePlatformOrganizations.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isStale: false,
    });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Organização indisponível' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar os dados da organização');
  });
});
