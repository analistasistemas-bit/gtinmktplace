import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const { usePlatformOrganization, usePlatformPreview, start, end, requestSupport, cancelSupport, listSupportRequests } = vi.hoisted(() => ({
  usePlatformOrganization: vi.fn(),
  usePlatformPreview: vi.fn(),
  start: vi.fn(),
  end: vi.fn(),
  requestSupport: vi.fn(),
  cancelSupport: vi.fn(),
  listSupportRequests: vi.fn(),
}));

vi.mock('@/hooks/usePlatformAdmin', () => ({ usePlatformOrganization, usePlatformPreview }));
vi.mock('@/lib/suporte', () => ({ requestSupport, cancelSupport, listSupportRequests }));
vi.mock('@/stores/support-store', () => ({
  useSupportStore: (selector: (state: { start: typeof start; end: typeof end }) => unknown) => selector({ start, end }),
}));
vi.mock('@/components/platform-admin/org-results', () => ({
  OrgResults: ({ organization }: { organization: { data?: { id: string } } }) => <p>Resultados {organization.data?.id}</p>,
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
          <Route path="/" element={<p>Operação</p>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function makePreview(overrides: Record<string, unknown> = {}) {
  return {
    org_id: 'org-avil',
    org_name: 'Avil',
    month: '2026-08',
    timezone: 'America/Fortaleza',
    terms: { id: 't1', org_id: 'org-avil', starts_on: '2026-01-01', modality: 1, monthly_fee_cents: 0, revenue_bps: 500, sonar_unit_cents: 0, setup_fee_cents: 0, setup_due_month: null, reason: '', version: 1, timezone: 'America/Fortaleza', created_at: '', created_by: '' },
    gross_cents: 0, refund_cents: 0, base_cents: 0, fee_cents: 0, sonar_units: 0, sonar_cents: 0,
    lines: [], total_cents: 0, credit_cents: 0, credit_balance_cents: 0, adjustments: [], sources: [],
    revision: 'r1',
    blockers: [],
    ...overrides,
  };
}

beforeEach(() => {
  usePlatformOrganization.mockReturnValue({
    data: {
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
      next_terms_starts_on: null,
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  usePlatformPreview.mockReturnValue({ data: makePreview(), isLoading: false, isError: false });
  listSupportRequests.mockResolvedValue({ requests: [], total: 0, page: 1, pageSize: 50 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OrganizacaoDetalhe', () => {
  it('mantém identidade, período e resultados sem iniciar suporte', async () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Avil' })).toBeInTheDocument();
    expect(screen.getByText('Ambiente de teste')).toBeInTheDocument();
    expect(screen.getByText(/avil · Modalidade 1 · 5% sobre receita/)).toBeInTheDocument();
    expect(screen.getByLabelText('Mês da organização')).toHaveValue('2026-08');
    expect(screen.getByText('Resultados org-avil')).toBeInTheDocument();
    expect(usePlatformOrganization).toHaveBeenCalledWith('org-avil', '2026-08');
    await waitFor(() => expect(listSupportRequests).toHaveBeenCalledWith({ orgId: 'org-avil', page: 1, pageSize: 50, status: 'actionable' }));
    expect(start).not.toHaveBeenCalled();
    expect(screen.queryByText(/pode estar desatualizado/i)).not.toBeInTheDocument();
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
    usePlatformOrganization.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Organização indisponível' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar os dados da organização');
  });

  it('mostra pendência de condições comerciais quando não há contrato', () => {
    usePlatformPreview.mockReturnValue({ data: makePreview({ terms: null }), isLoading: false, isError: false });
    renderPage();

    expect(screen.getByText('Sem condições comerciais')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cadastrar em Cobrança' })).toBeInTheDocument();
  });

  // ADR-0155: contrato com vigência futura não é pendência — informa, não cobra ação.
  it('informa a vigência futura em vez de acusar ausência de contrato', () => {
    usePlatformPreview.mockReturnValue({ data: makePreview({ terms: null }), isLoading: false, isError: false });
    usePlatformOrganization.mockReturnValue({
      data: {
        id: 'org-avil', nome: 'Avil', slug: 'avil', is_test: true, modality: null, metrics: null,
        forecast_cents: null, billable_units: null, daludi_searches: null, pending_count: 1,
        next_terms_starts_on: '2026-10-01',
      },
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText('Condição comercial começa em 2026-10')).toBeInTheDocument();
    expect(screen.queryByText('Sem condições comerciais')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Cadastrar em Cobrança' })).not.toBeInTheDocument();
  });

  it('distingue falha ao carregar a prévia de organização sem contrato', async () => {
    const refetch = vi.fn();
    usePlatformPreview.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    const user = userEvent.setup();
    renderPage();

    // Não é a mesma mensagem de "sem contrato": falha de rede não pode se passar por dado real.
    expect(screen.queryByText('Sem condições comerciais')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Cadastrar em Cobrança' })).not.toBeInTheDocument();
    expect(screen.getByText('Não foi possível carregar as condições comerciais.')).toBeInTheDocument();
    // Contagem desconhecida ≠ zero: sem badge na aba Cobrança.
    expect(screen.getByRole('tab', { name: /Cobrança/ })).not.toHaveTextContent(/[0-9]/);

    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('exibe a contagem de bloqueios na aba Cobrança', () => {
    usePlatformPreview.mockReturnValue({
      data: makePreview({ blockers: [{ code: 'commercial_terms_required', message: 'Sem condição comercial vigente.' }] }),
      isLoading: false,
      isError: false,
    });
    renderPage();

    expect(screen.getByRole('tab', { name: /Cobrança/ })).toHaveTextContent('1');
  });

  it('não exibe badge de bloqueio quando a prévia está limpa', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: /Cobrança/ })).not.toHaveTextContent(/[0-9]/);
  });

  it('solicita acesso, entra na operação com aprovação válida e cancela solicitação pendente', async () => {
    const user = userEvent.setup();
    requestSupport.mockResolvedValue({ id: 'request-1', status: 'pending' });
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Solicitar acesso' }));
    await user.type(screen.getByLabelText('Motivo do acesso'), 'Investigar cobrança');
    await user.click(screen.getByRole('button', { name: 'Enviar solicitação' }));
    await waitFor(() => expect(requestSupport).toHaveBeenCalledWith({ orgId: 'org-avil', scope: 'read', reason: 'Investigar cobrança' }));

    listSupportRequests.mockResolvedValue({
      requests: [{ id: 'request-1', org_id: 'org-avil', status: 'approved', scope: 'read', approval_expires_at: new Date(Date.now() + 60_000).toISOString() }],
      total: 1, page: 1, pageSize: 50,
    });
    renderPage();
    const enterButton = await screen.findByRole('button', { name: 'Entrar na operação' });
    await user.click(enterButton);
    await waitFor(() => expect(start).toHaveBeenCalledWith('request-1'));

    listSupportRequests.mockResolvedValue({
      requests: [{ id: 'request-2', org_id: 'org-avil', status: 'pending', scope: 'read' }],
      total: 1, page: 1, pageSize: 50,
    });
    renderPage();
    const cancelButton = await screen.findByRole('button', { name: 'Cancelar solicitação' });
    await user.click(cancelButton);
    await waitFor(() => expect(cancelSupport).toHaveBeenCalledWith('request-2'));
  });

  it('mostra a sessão de suporte ativa no cabeçalho e permite encerrá-la', async () => {
    const user = userEvent.setup();
    end.mockResolvedValue(undefined);
    listSupportRequests.mockResolvedValue({
      requests: [{ id: 'request-3', org_id: 'org-avil', status: 'active', scope: 'read', expires_at: '2026-08-15T18:30:00Z' }],
      total: 1, page: 1, pageSize: 50,
    });
    renderPage();

    expect(await screen.findByText(/Acesso ativo/)).toBeInTheDocument();
    const endButton = screen.getByRole('button', { name: 'Encerrar suporte' });
    await user.click(endButton);
    await waitFor(() => expect(end).toHaveBeenCalledWith('request-3'));
  });
});
