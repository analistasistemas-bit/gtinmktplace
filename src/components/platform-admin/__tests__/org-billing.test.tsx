import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgBilling } from '../org-billing';
import type { BillingPreview, BillingStatement, CommercialTerms } from '@/lib/platform-admin';

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  reconcile: vi.fn(),
  save: vi.fn(),
  refetch: vi.fn(),
  usePreview: vi.fn(),
  useStatements: vi.fn(),
  useTerms: vi.fn(),
  useReport: vi.fn(),
  report: null as unknown,
  baixar: vi.fn(),
}));

vi.mock('@/lib/export/relatorio-mensal-download', () => ({ baixarRelatorioMensal: mocks.baixar }));

vi.mock('@/hooks/usePlatformAdmin', () => ({
  usePlatformPreview: mocks.usePreview,
  usePlatformStatements: mocks.useStatements,
  usePlatformTerms: mocks.useTerms,
  useMonthlyReport: mocks.useReport,
  useClosePlatformStatement: () => ({ mutateAsync: mocks.close, isPending: false }),
  useReconcilePlatformRevenue: () => ({ mutateAsync: mocks.reconcile, isPending: false }),
  useSavePlatformTerms: () => ({ mutateAsync: mocks.save, isPending: false }),
}));

vi.mock('@/components/export/botao-exportar', () => ({
  BotaoExportar: ({ montarReport }: { montarReport: (config: object) => unknown }) => (
    <button onClick={() => { mocks.report = montarReport({ formato: 'pdf' }); }}>Exportar snapshot</button>
  ),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

const terms: CommercialTerms = {
  id: 'terms-1',
  org_id: 'org-a',
  starts_on: '2026-08-01',
  modality: 2,
  monthly_fee_cents: 0,
  revenue_bps_t1: 500,
  revenue_bps_t2: 400,
  revenue_bps_t3: 350,
  revenue_bps_t4: 300,
  sonar_unit_cents: 120,
  setup_fee_cents: 0,
  setup_due_month: null,
  reason: 'contrato',
  due_day: 5,
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
    applied_bps: 500,
    applied_tier: 1,
    sonar_units: 10,
    sonar_cents: 1_200,
    lines: [
      { key: 'infrastructure', label: 'Infraestrutura', quantity: 1, unit_cents: 0, amount_cents: 0, source_type: 'commercial_terms', source_id: 'terms-1' },
      { key: 'revenue', label: 'Remuneração sobre vendas', quantity: null, unit_cents: null, amount_cents: 45_000, source_type: 'sales', source_id: null },
      { key: 'sonar', label: 'Consultas Sonar', quantity: 10, unit_cents: 120, amount_cents: 1_200, source_type: 'sonar_deliveries', source_id: null },
    ],
    total_cents: 46_200,
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
  mocks.save.mockReset().mockResolvedValue(terms);
  mocks.refetch.mockReset().mockResolvedValue({ data: makePreview() });
  mocks.report = null;
  mocks.baixar.mockReset().mockResolvedValue(undefined);
  toastSuccess.mockReset();
  toastError.mockReset();
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
  mocks.useReport.mockReturnValue({ data: undefined, isLoading: false, isError: false });
  mocks.useTerms.mockReturnValue({
    data: { rows: [terms] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('OrgBilling', () => {
  it('relatório mensal: desabilitado sem demonstrativo fechado do mês, com o motivo', () => {
    render(<OrgBilling orgId="org-a" month="2026-07" />);
    const botao = screen.getByRole('button', { name: /Gerar relatório mensal/ });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute('title', expect.stringContaining('Feche o demonstrativo de 2026-07'));
  });

  it('relatório mensal: com mês fechado, gera o PDF da organização e do mês', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<OrgBilling orgId="org-a" month="2026-08" />);
    await user.click(screen.getByRole('button', { name: /Gerar relatório mensal/ }));
    expect(mocks.baixar).toHaveBeenCalledWith('org-a', '2026-08');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Relatório mensal gerado.'));
  });

  it('relatório mensal: com 21+ demonstrativos, o mais antigo (fora da 1ª página) continua habilitado', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const pagina = Array.from({ length: 20 }, (_, i) => ({ ...makeStatement(), id: `st-${i}`, month: `2025-${String(i % 12 + 1).padStart(2, '0')}` }));
    const antigo = { ...makeStatement(), id: 'st-antigo', month: '2024-01' };
    mocks.useStatements.mockImplementation((_orgId: string, month?: string) => ({
      data: month ? { rows: month === '2024-01' ? [antigo] : [], total: month === '2024-01' ? 1 : 0, page: 1, page_size: 1 }
        : { rows: pagina, total: 21, page: 1, page_size: 20 },
      isLoading: false,
    }));
    render(<OrgBilling orgId="org-a" month="2024-01" />);
    const botao = screen.getByRole('button', { name: /Gerar relatório mensal/ });
    expect(botao).toBeEnabled();
    await user.click(botao);
    expect(mocks.baixar).toHaveBeenCalledWith('org-a', '2024-01');
    expect(mocks.useStatements).toHaveBeenCalledWith('org-a', '2024-01');
  });

  it('relatório mensal: falha vira toast de erro', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.baixar.mockRejectedValueOnce(new Error('sem rede'));
    render(<OrgBilling orgId="org-a" month="2026-08" />);
    await user.click(screen.getByRole('button', { name: /Gerar relatório mensal/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('sem rede'));
  });

  it('contrato futuro ainda nao vigente nao reabre como primeiro contrato', () => {
    mocks.useTerms.mockReturnValue({
      data: { rows: [{ ...terms, starts_on: '2026-10-01' }] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<OrgBilling orgId="org-a" month="2026-09" />);

    expect(screen.getByText('Renegociar')).toBeInTheDocument();
    expect(screen.queryByLabelText('Início da vigência')).not.toBeInTheDocument();
  });

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
    expect(toastError).toHaveBeenCalledWith('A prévia mudou. Revise os novos valores e confirme novamente.');
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
      kpis: [{ label: 'Total', valor: expect.stringContaining('462,00') }],
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

  it('sem condições comerciais: formulário aberto, pill de aviso e bloqueio listado', () => {
    mocks.useTerms.mockReturnValue({ data: { rows: [] }, isLoading: false, isError: false, refetch: vi.fn() });
    mocks.usePreview.mockReturnValue({
      data: makePreview({
        terms: null,
        blockers: [{ code: 'commercial_terms_required', message: 'Condição comercial ausente' }],
      }),
      isLoading: false,
      refetch: mocks.refetch,
    });
    render(<OrgBilling orgId="org-a" month="2026-08" />);

    expect(screen.getByText('Sem condições comerciais')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar condições' })).toBeInTheDocument();
    expect(screen.getByText('Condição comercial ausente')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fechar demonstrativo' })).toBeDisabled();
  });

  it('pronta para fechar: condições vigentes, sem bloqueios e mês encerrado', () => {
    render(<OrgBilling orgId="org-a" month="2026-08" />);

    expect(screen.getByText('Pronta para fechar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fechar demonstrativo' })).toBeEnabled();
  });

  it('mês sem demonstrativo: pill "em aberto", motivo visível e ligado ao botão, sem ponte do cupom', () => {
    render(<OrgBilling orgId="org-a" month="2026-07" />);
    expect(screen.getByText('Demonstrativo em aberto')).toBeInTheDocument();
    const botao = screen.getByRole('button', { name: /Gerar relatório mensal/ });
    expect(botao).toHaveAccessibleDescription(expect.stringContaining('Feche o demonstrativo de 2026-07'));
    expect(screen.getByText(/Fechamento automático: dia 01, às 06h/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Ponte para o faturamento da loja')).not.toBeInTheDocument();
  });

  it('mês fechado: pill com a data e ponte do cupom com a diferença assinada para a loja', () => {
    const fechado = { ...makeStatement(), month: '2026-08', seller_coupon_cents: 30_000 };
    mocks.useStatements.mockReturnValue({ data: { rows: [fechado], total: 1, page: 1, page_size: 20 }, isLoading: false, isError: false });
    mocks.useReport.mockReturnValue({ data: { summary: { current: { gross_cents: 970_000 } } }, isLoading: false, isError: false });
    render(<OrgBilling orgId="org-a" month="2026-08" />);
    expect(screen.getByText('Demonstrativo fechado em 01/09')).toBeInTheDocument();
    const ponte = screen.getByLabelText('Ponte para o faturamento da loja');
    expect(ponte).toHaveTextContent(/R\$\s*300,00/);
    expect(ponte).toHaveTextContent(/−R\$\s*300,00/);
  });

  it('snapshot antigo sem cupons: avisa a ausência do detalhamento em vez de inventar zero', () => {
    const fechado = { ...makeStatement(), month: '2026-08' };
    mocks.useStatements.mockReturnValue({ data: { rows: [fechado], total: 1, page: 1, page_size: 20 }, isLoading: false, isError: false });
    render(<OrgBilling orgId="org-a" month="2026-08" />);
    expect(screen.getByText('Snapshot sem detalhamento de cupons')).toBeInTheDocument();
  });

  it('erro na leitura dos demonstrativos não vira "mês em aberto"', () => {
    mocks.useStatements.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
    render(<OrgBilling orgId="org-a" month="2026-08" />);
    expect(screen.getByText('Estado do fechamento indisponível')).toBeInTheDocument();
    expect(screen.queryByText('Demonstrativo em aberto')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gerar relatório mensal/ })).toBeDisabled();
  });
});
