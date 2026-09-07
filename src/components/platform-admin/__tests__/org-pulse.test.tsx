import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgPulse } from '../org-pulse';
import type { PulseUsage } from '@/lib/platform-admin';

const mocks = vi.hoisted(() => ({ usePulse: vi.fn() }));

vi.mock('@/hooks/usePlatformAdmin', () => ({
  usePlatformPulseUsage: mocks.usePulse,
}));

function makeUsage(overrides: Partial<PulseUsage> = {}): PulseUsage {
  return {
    rows: [], total: 25, page: 1, page_size: 20,
    client_units: 0, client_cents: 0, daludi_searches: 0, failures: 0, reopens: 0,
    measured_cost_cents: null, tracked_since: null,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.usePulse.mockReset();
  mocks.usePulse.mockReturnValue({ data: makeUsage(), isLoading: false, isError: false, refetch: vi.fn() });
});

afterEach(() => {
  cleanup();
});

describe('OrgPulse', () => {
  it('volta para a página 1 ao trocar de mês, para não pedir uma página que não existe mais no novo recorte', async () => {
    const user = userEvent.setup();
    const { rerender, getByRole } = render(<OrgPulse orgId="org-a" month="2026-08" />);

    await user.click(getByRole('button', { name: 'Próxima página' }));
    expect(mocks.usePulse).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));

    rerender(<OrgPulse orgId="org-a" month="2026-09" />);
    expect(mocks.usePulse).toHaveBeenLastCalledWith(expect.objectContaining({ month: '2026-09', page: 1 }));
  });
});
