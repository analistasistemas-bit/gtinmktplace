import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { listSupportRequests, decideSupport, revokeSupport, from } = vi.hoisted(() => ({
  listSupportRequests: vi.fn(), decideSupport: vi.fn(), revokeSupport: vi.fn(), from: vi.fn(),
}));
let isAdmin = true;

vi.mock('@/hooks/useProfile', () => ({ useProfile: () => ({ isAdmin, profileLoading: false }) }));
vi.mock('@/lib/suporte', () => ({ listSupportRequests, decideSupport, revokeSupport }));
vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import SupportRequests from '../SupportRequests';

afterEach(() => {
  vi.clearAllMocks();
  isAdmin = true;
});

function auditChain() {
  const range = vi.fn().mockResolvedValue({ data: [], count: 0, error: null });
  const order = vi.fn(() => ({ range }));
  const select = vi.fn(() => ({ order }));
  return { select };
}

const page = (requests: unknown[] = [], total = requests.length) => ({ requests, total, page: 1, pageSize: 20 });

describe('SupportRequests', () => {
  it('bloqueia a tela no frontend para membro que não é admin', () => {
    isAdmin = false;
    render(<SupportRequests />);
    expect(screen.getByText('Acesso restrito')).toBeInTheDocument();
  });

  it('pede confirmação e aprova a solicitação pendente', async () => {
    isAdmin = true;
    const request = { id: 'request-1', requester_id: 'operator', requester_name: 'Diego', org_id: 'org-1', scope: 'read', reason: 'Investigar integração', status: 'pending', created_at: '2026-07-25T10:00:00Z', pending_expires_at: '2026-07-26T10:00:00Z' };
    listSupportRequests
      .mockResolvedValueOnce(page([request]))
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(page())
      .mockResolvedValue(page());
    from.mockReturnValue(auditChain());
    decideSupport.mockResolvedValue({ id: 'request-1', status: 'approved' });
    const user = userEvent.setup();
    render(<SupportRequests />);

    await screen.findByText('Investigar integração');
    expect(screen.getByText('Diego')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Aprovar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar aprovação' }));

    await waitFor(() => expect(decideSupport).toHaveBeenCalledWith('request-1', 'approved'));
  });

  it('recarrega a lista quando outro admin decide primeiro', async () => {
    const request = { id: 'request-409', requester_id: 'operator', org_id: 'org-1', scope: 'read', reason: 'Verificar erro', status: 'pending', created_at: '2026-07-25T10:00:00Z', pending_expires_at: '2026-07-26T10:00:00Z' };
    isAdmin = true;
    listSupportRequests
      .mockResolvedValueOnce(page([request]))
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(page());
    from.mockReturnValue(auditChain());
    decideSupport.mockRejectedValue(Object.assign(new Error('transição não disponível'), { status: 409 }));
    const user = userEvent.setup();
    render(<SupportRequests />);

    await screen.findByText('Verificar erro');
    await user.click(screen.getByRole('button', { name: 'Aprovar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar aprovação' }));

    await screen.findByText(/já foi decidida por outro administrador/i);
    expect(listSupportRequests).toHaveBeenCalledTimes(6);
  });
});
