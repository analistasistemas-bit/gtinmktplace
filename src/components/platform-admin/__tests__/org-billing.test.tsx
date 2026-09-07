import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgBilling } from '../org-billing';
import type { BillingPreview, BillingStatement, CommercialTerms } from '@/lib/platform-admin';

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  reconcile: vi.fn(),
  refetch: vi.fn(),
  usePreview: vi.fn(),
  useStatements: vi.fn(),
  report: null as unknown,
}));

vi.mock('@/hooks/usePlatformAdmin', () => ({
  usePlatformPreview: mocks.usePreview,
  usePlatformStatements: mocks.useStatements,
  useClosePlatformStatement: () => ({ mutateAsync: mocks.close, isPending: false }),
  useReconcilePlatformRevenue: () => ({ mutateAsync: mocks.reconcile, isPending: false }),
}));

vi.mock('@/components/export/botao-exportar', () => ({
  BotaoExportar: ({ montarReport }: { montarReport: (config: object) => unknown }) => (
    <button onClick={() => { mocks.report = montarReport({ formato: 'pdf' }); }}>Exportar snapshot</button>
  ),
}));

const terms: CommercialTerms = {
  id: 'terms-1',
  org_id: 'org-a',
  starts_on: '2026-08-01',
  modality: 2,
  monthly_fee_cents: 60_000,
  revenue_bps: 500,
  sonar_unit_cents: 120,
  setup_fee_cents: 0,
  setup_due_month: null,
  reason: 'contrato',
  version: 1,
  timezone: 'America/Fortaleza',
  created_at: '2026-08-01T03:00:00Z',
  created_by: 'admin',
};

function makePreview(overrides: Partial<BillingPreview> = {}): BillingPreview {
  return {
    org_id: 'org-a',
    org_name: 'Loja Exemplo',
    month: '2026-08',
    timezone: 'America/Fortaleza',
    terms,
    gross_cents: 1_000_000,
    refund_cents: 100_000,
    base_cents: 900_000,
    fee_cents: 45_000,
    sonar_units: 10,
    sonar_cents: 1_200,
    lines: [
      { key: 'infrastructure', label: 'Infraestrutura', quantity: 1, unit_cents: 60_000, amount_cents: 60_000, source_type: 'commercial_terms', source_id: 'terms-1' },
      { key: 'revenue', label: 'Remuneração sobre vendas', quantity: null, unit_cents: null, amount_cents: 45_000, source_type: 'sales', source_id: null },
      { key: 'sonar', label: 'Consultas Sonar', quantity: 10, unit_cents: 120, amount_cents: 1_200, source_type: 'sonar_deliveries', source_id: null },
    ],
    total_cents: 106_200,
    credit_cents: 0,
    credit_balance_cents: 0,
    adjustments: [],
    sources: [],
    revision: 'rev-1',
    blockers: [],
    ...overrides,
  };
}

function makeStatement(): BillingStatement {
  return {
    ...makePreview(),
    id: 'statement-1',
    closed_at: '2026-09-01T12:00:00Z',
    closed_by: 'admin',
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-06T15:00:00Z'));
  mocks.close.mockReset().mockResolvedValue(makeStatement());
  mocks.reconcile.mockReset().mockResolvedValue({ id: 'reconciliation-1' });
  mocks.refetch.mockReset().mockResolvedValue({ data: makePreview() });
  mocks.report = null;
  mocks.usePreview.mockReturnValue({
    data: makePreview(),
    isLoading: false,
    isError: false,
    refetch: mocks.refetch,
  });
  mocks.useStatements.mockReturnValue({
    data: { rows: [makeStatement()], total: 1, page: 1, page_size: 20 },
    isLoading: false,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('OrgBilling', () => {
  it('fecha com revisão e organização selecionadas após confirmação', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<OrgBilling orgId="org-a" month="2026-08" />);

    await user.click(screen.getByRole('button', { name: 'Fechar demonstrativo' }));
    expect(screen.getByText('Confirmar fechamento de 2026-08')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirmar fechamento' }));

    expect(mocks.close).toHaveBeenCalledWith({
      org_id: 'org-a',
      month: '2026-08',
      expected_revision: 'rev-1',
    });
  });

  it('refaz a prévia no conflito e exige nova confirmação', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.close.mockRejectedValueOnce(Object.assign(new Error('revision conflict'), { code: 'conflict' }));
    render(<OrgBilling orgId="org-a" month="2026-08" />);

    await user.click(screen.getByRole('button', { name: 'Fechar demonstrativo' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar fechamento' }));

    await waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Confirmar fechamento de 2026-08')).not.toBeInTheDocument();
    expect(screen.getByText(/Revise os novos valores/)).toBeInTheDocument();
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('concilia pendência sem permitir editar o bruto da venda', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.usePreview.mockReturnValue({
      data: makePreview({
        blockers: [{
          code: 'refund_reconciliation_required',
          message: 'Devolução precisa de conciliação',
          sale_id: 'sale-1',
          order_ref: 'ORDER-1',
          source_updated_at: '2026-08-10T12:00:00Z',
          gross_cents: 50_000,
          status: 'refunded',
        }],
      }),
      isLoading: false,
      refetch: mocks.refetch,
    });
    render(<OrgBilling orgId="org-a" month="2026-08" />);

    expect(screen.getByRole('button', { name: 'Fechar demonstrativo' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Conciliar devolução' }));
    expect(screen.getByText('R$ 500,00')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /bruto/i })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Produtos devolvidos'), '100,00');
    await user.type(screen.getByLabelText('Motivo da conciliação'), 'devolução parcial');
    await user.click(screen.getByRole('button', { name: 'Salvar conciliação' }));

    expect(mocks.reconcile).toHaveBeenCalledWith({
      org_id: 'org-a',
      sale_id: 'sale-1',
      source_updated_at: '2026-08-10T12:00:00Z',
      refunded_product_cents: 10_000,
      reason: 'devolução parcial',
    });
  });

  it('exporta o total do snapshot fechado sem recalcular', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<OrgBilling orgId="org-a" month="2026-08" />);

    await user.click(screen.getByRole('button', { name: 'Exportar snapshot' }));
    expect(mocks.report).toMatchObject({
      kpis: [{ label: 'Total', valor: expect.stringContaining('1.062,00') }],
    });
  });

  it('não fecha o mês atual e descreve total negativo como crédito', () => {
    mocks.usePreview.mockReturnValue({
      data: makePreview({ month: '2026-09', total_cents: -1_000 }),
      isLoading: false,
      refetch: mocks.refetch,
    });
    render(<OrgBilling orgId="org-a" month="2026-09" />);

    expect(screen.getByRole('button', { name: 'Fechar demonstrativo' })).toBeDisabled();
    expect(screen.getAllByText('Crédito a favor da organização').length).toBeGreaterThan(0);
  });
});
