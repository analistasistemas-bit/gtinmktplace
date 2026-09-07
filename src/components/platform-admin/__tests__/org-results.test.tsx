import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgResults } from '../org-results';
import type { OrgMetrics } from '@/lib/platform-admin';

const mocks = vi.hoisted(() => ({ useMetrics: vi.fn(), refetch: vi.fn() }));

vi.mock('@/hooks/usePlatformAdmin', () => ({
  usePlatformMetrics: mocks.useMetrics,
}));

function makeMetrics(overrides: Partial<OrgMetrics> = {}): OrgMetrics {
  return {
    org_id: 'org-a',
    month: '2026-08',
    gross_cents: 1_000_000,
    orders: 42,
    ticket_cents: 23_800,
    markup: 0.44,
    cost_covered_orders: 40,
    total_orders: 42,
    active_ads: null,
    publications: null,
    pending_operations: null,
    updated_at: null,
    previous: { gross_cents: 900_000, orders: 38, markup: 0.4 },
    series: [{ month: '2026-08', gross_cents: 1_000_000, markup: 0.44 }],
    warnings: [],
    ...overrides,
  };
}

beforeEach(() => {
  mocks.refetch.mockReset();
  mocks.useMetrics.mockReturnValue({ data: makeMetrics(), isLoading: false, isError: false, refetch: mocks.refetch });
});

afterEach(() => {
  cleanup();
});

describe('OrgResults', () => {
  it('markup 0.44 vira +44% com cor de sucesso', () => {
    render(<OrgResults orgId="org-a" month="2026-08" />);
    expect(screen.getByText('+44%')).toBeInTheDocument();
  });

  it('markup null vira — com o motivo, nunca um número inventado', () => {
    mocks.useMetrics.mockReturnValue({
      data: makeMetrics({ markup: null }),
      isLoading: false,
      isError: false,
      refetch: mocks.refetch,
    });
    render(<OrgResults orgId="org-a" month="2026-08" />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Sem custo ou alíquota confirmada')).toBeInTheDocument();
  });

  it('nunca mostra a palavra Indisponível', () => {
    render(<OrgResults orgId="org-a" month="2026-08" />);
    expect(screen.queryByText(/Indisponível/)).not.toBeInTheDocument();
  });

  it('erro sem dado mostra faixa de erro com Tentar novamente', () => {
    mocks.useMetrics.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: mocks.refetch });
    render(<OrgResults orgId="org-a" month="2026-08" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });
});
