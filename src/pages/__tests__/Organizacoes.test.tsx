import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const { invoke, requestSupport, listSupportRequests, start } = vi.hoisted(() => ({
  invoke: vi.fn(), requestSupport: vi.fn(), listSupportRequests: vi.fn(), start: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke } } }));
vi.mock('@/lib/suporte', () => ({ requestSupport, listSupportRequests }));
vi.mock('@/stores/support-store', () => ({ useSupportStore: (selector: (state: { start: typeof start }) => unknown) => selector({ start }) }));

import Organizacoes from '../Organizacoes';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><Organizacoes /></QueryClientProvider></MemoryRouter>);
}

describe('Organizacoes', () => {
  it('solicita acesso somente leitura com motivo e identifica tenant de teste', async () => {
    invoke.mockResolvedValue({ data: { orgs: [{ id: 'dsa', nome: 'DSA', slug: 'diego-souza', membros: 1, criado_em: '2026-07-25T10:00:00Z', canais_habilitados: [], is_test: true }] }, error: null });
    listSupportRequests.mockResolvedValue({ requests: [], total: 0, page: 1, pageSize: 50 });
    requestSupport.mockResolvedValue({ id: 'request-1', status: 'pending' });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Teste')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Solicitar acesso' }));
    await user.type(screen.getByLabelText('Motivo do acesso'), 'Verificar falha de integração');
    await user.click(screen.getByRole('button', { name: 'Enviar solicitação' }));

    await waitFor(() => expect(requestSupport).toHaveBeenCalledWith({
      orgId: 'dsa', scope: 'read', reason: 'Verificar falha de integração',
    }));
  });

  it('permite entrar só com aprovação ainda utilizável', async () => {
    invoke.mockResolvedValue({ data: { orgs: [{ id: 'org-1', nome: 'Cliente', slug: 'cliente', membros: 2, criado_em: '2026-07-25T10:00:00Z', canais_habilitados: [] }] }, error: null });
    listSupportRequests.mockResolvedValue({ requests: [{ id: 'request-1', org_id: 'org-1', status: 'approved', scope: 'full', approval_expires_at: new Date(Date.now() + 60_000).toISOString() }], total: 1, page: 1, pageSize: 50 });
    renderPage();

    await screen.findByText('Cliente');
    fireEvent.click(screen.getByRole('button', { name: 'Entrar na operação' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith('request-1'));
  });

  it('preserva o pedido mais recente por organização e só oferece renovação nos 15 minutos finais', async () => {
    invoke.mockResolvedValue({ data: { orgs: [{ id: 'org-2', nome: 'Cliente', slug: 'cliente', membros: 2, criado_em: '2026-07-25T10:00:00Z', canais_habilitados: [] }] }, error: null });
    listSupportRequests.mockResolvedValue({ requests: [
      { id: 'new', org_id: 'org-2', status: 'active', scope: 'read', expires_at: new Date(Date.now() + 10 * 60_000).toISOString() },
      { id: 'old', org_id: 'org-2', status: 'approved', scope: 'full', approval_expires_at: new Date(Date.now() + 60_000).toISOString() },
    ], total: 2, page: 1, pageSize: 50 });
    renderPage();
    await screen.findByText('Cliente');
    await waitFor(() => expect(listSupportRequests).toHaveBeenCalledWith({ page: 1, pageSize: 50, status: 'actionable' }));
    expect(screen.getByRole('button', { name: 'Solicitar renovação' })).toBeInTheDocument();
  });
});
