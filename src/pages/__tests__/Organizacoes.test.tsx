import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const { invoke, requestSupport, cancelSupport, listSupportRequests, start, usePlatformOverview, usePlatformOrganizations } = vi.hoisted(() => ({
  invoke: vi.fn(), requestSupport: vi.fn(), cancelSupport: vi.fn(), listSupportRequests: vi.fn(), start: vi.fn(),
  usePlatformOverview: vi.fn(), usePlatformOrganizations: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke } } }));
vi.mock('@/lib/suporte', () => ({ requestSupport, cancelSupport, listSupportRequests }));
vi.mock('@/stores/support-store', () => ({ useSupportStore: (selector: (state: { start: typeof start }) => unknown) => selector({ start }) }));
vi.mock('@/hooks/usePlatformAdmin', () => ({ usePlatformOverview, usePlatformOrganizations }));

import Organizacoes from '../Organizacoes';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const makeOrg = (overrides: Record<string, unknown> = {}) => ({
  id: 'org-1',
  nome: 'Cliente',
  slug: 'cliente',
  is_test: false,
  modality: 1,
  metrics: {
    org_id: 'org-1',
    month: '2026-09',
    gross_cents: 150_000,
    orders: 5,
    ticket_cents: 30_000,
    markup: 2.1,
    cost_covered_orders: 4,
    total_orders: 5,
    active_ads: null,
    publications: null,
    pending_operations: 1,
    updated_at: null,
    previous: { gross_cents: 100_000, orders: 4, markup: 2 },
    series: [],
    warnings: [],
  },
  forecast_cents: 200_000,
  billable_units: 8,
  daludi_searches: 2,
  pending_count: 1,
  canais_habilitados: [],
  modulos_habilitados: [],
  tipo_pessoa: null,
  ...overrides,
});

beforeEach(() => {
  usePlatformOverview.mockReturnValue({
    data: { gross_cents: 150_000, forecast_cents: 200_000, org_count: 1, pending_count: 1, warnings: [] },
    isLoading: false,
    isError: false,
  });
  usePlatformOrganizations.mockReturnValue({
    data: { rows: [makeOrg()], total: 1, page: 1, page_size: 10 },
    isLoading: false,
    isError: false,
  });
  listSupportRequests.mockResolvedValue({ requests: [], total: 0, page: 1, pageSize: 50 });
});

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}{location.search}</p>;
}

function renderPage(initialEntry = '/admin?mes=2026-09') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/admin" element={<Organizacoes />} />
          <Route path="/admin/organizacoes/:orgId" element={<LocationProbe />} />
          <Route path="/" element={<p>Operação</p>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Organizacoes', () => {
  it('solicita acesso somente leitura com motivo e identifica tenant de teste', async () => {
    usePlatformOrganizations.mockReturnValue({
      data: { rows: [makeOrg({ id: 'sandbox', nome: 'Sandbox', slug: 'sandbox', is_test: true })], total: 1, page: 1, page_size: 10 },
      isLoading: false,
      isError: false,
    });
    requestSupport.mockResolvedValue({ id: 'request-1', status: 'pending' });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('checkbox', { name: 'Incluir testes' }));
    expect(await screen.findByText('Teste')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Solicitar acesso' }));
    await user.type(screen.getByLabelText('Motivo do acesso'), 'Verificar falha de integração');
    await user.click(screen.getByRole('button', { name: 'Enviar solicitação' }));

    await waitFor(() => expect(requestSupport).toHaveBeenCalledWith({
      orgId: 'sandbox', scope: 'read', reason: 'Verificar falha de integração',
    }));
  });

  it('permite entrar só com aprovação ainda utilizável', async () => {
    listSupportRequests.mockResolvedValue({ requests: [{ id: 'request-1', org_id: 'org-1', status: 'approved', scope: 'full', approval_expires_at: new Date(Date.now() + 60_000).toISOString() }], total: 1, page: 1, pageSize: 50 });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Entrar na operação' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith('request-1'));
  });

  it('preserva o pedido mais recente por organização e só oferece renovação nos 15 minutos finais', async () => {
    usePlatformOrganizations.mockReturnValue({
      data: { rows: [makeOrg({ id: 'org-2' })], total: 1, page: 1, page_size: 10 },
      isLoading: false,
      isError: false,
    });
    listSupportRequests.mockResolvedValue({ requests: [
      { id: 'new', org_id: 'org-2', status: 'active', scope: 'read', expires_at: new Date(Date.now() + 10 * 60_000).toISOString() },
      { id: 'old', org_id: 'org-2', status: 'approved', scope: 'full', approval_expires_at: new Date(Date.now() + 60_000).toISOString() },
    ], total: 2, page: 1, pageSize: 50 });
    renderPage();
    await screen.findByText('Cliente');
    await waitFor(() => expect(listSupportRequests).toHaveBeenCalledWith({ page: 1, pageSize: 50, status: 'actionable' }));
    expect(screen.getByRole('button', { name: 'Solicitar renovação' })).toBeInTheDocument();
  });

  it('mantém o cancelamento visível e bloqueia cliques repetidos enquanto processa', async () => {
    usePlatformOrganizations.mockReturnValue({
      data: { rows: [makeOrg({ id: 'org-3' })], total: 1, page: 1, page_size: 10 },
      isLoading: false,
      isError: false,
    });
    listSupportRequests.mockResolvedValue({ requests: [{ id: 'request-3', org_id: 'org-3', status: 'pending', scope: 'read' }], total: 1, page: 1, pageSize: 50 });
    cancelSupport.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    renderPage();

    const button = await screen.findByRole('button', { name: 'Cancelar solicitação' });
    await user.click(button);

    expect(cancelSupport).toHaveBeenCalledWith('request-3');
    expect(screen.getByRole('button', { name: 'Cancelando…' })).toBeDisabled();
  });

  it('mostra a carteira, dados indisponíveis e navega mantendo o mês', async () => {
    usePlatformOrganizations.mockReturnValue({
      data: { rows: [makeOrg({ id: 'avil', nome: 'Avil', slug: 'avil', metrics: { ...makeOrg().metrics, markup: null } })], total: 1, page: 1, page_size: 10 },
      isLoading: false,
      isError: false,
    });
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByRole('heading', { name: 'Organizações' })).toBeInTheDocument();
    expect(screen.getByText('Markup')).toBeInTheDocument();
    expect(screen.getAllByText('Indisponível').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('link', { name: /Ver organização Avil/i }));
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/organizacoes/avil?mes=2026-09');
  });

  it('filtra organizações de teste e exibe falha do backend', async () => {
    usePlatformOrganizations.mockReturnValue({
      data: { rows: [makeOrg({ id: 'test', nome: 'Org teste', is_test: true })], total: 1, page: 1, page_size: 10 },
      isLoading: false,
      isError: true,
    });
    renderPage();

    expect(screen.queryByText('Org teste')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar a carteira');
    expect(usePlatformOrganizations).toHaveBeenCalledWith(expect.objectContaining({ include_test: false }));
  });
});
