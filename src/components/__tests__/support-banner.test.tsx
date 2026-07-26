import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useSupportStore } from '@/stores/support-store';
import { SupportBanner } from '../support-banner';

describe('SupportBanner', () => {
  beforeEach(() => {
    useSupportStore.setState({
      context: { requestId: 'r1', orgId: 'org-1', orgName: 'Avil', scope: 'full', expiresAt: '2030-01-01T12:00:00.000Z' },
      end: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('expõe o contexto e permite encerrar por botão nativo', async () => {
    render(<MemoryRouter><SupportBanner /></MemoryRouter>);
    await userEvent.setup().click(screen.getByRole('button', { name: /encerrar suporte/i }));

    expect(screen.getByText(/Avil/)).toBeInTheDocument();
    expect(screen.getByText(/Acesso total/)).toBeInTheDocument();
  });
});
