import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommercialTermsForm } from '../commercial-terms-form';
import type { CommercialTerms } from '@/lib/platform-admin';

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  useTerms: vi.fn(),
}));

vi.mock('@/hooks/usePlatformAdmin', () => ({
  usePlatformTerms: mocks.useTerms,
  useSavePlatformTerms: () => ({ mutateAsync: mocks.save, isPending: false }),
}));

const current: CommercialTerms = {
  id: 'terms-current',
  org_id: 'org-a',
  starts_on: '2026-09-01',
  modality: 1,
  monthly_fee_cents: 0,
  revenue_bps: 0,
  sonar_unit_cents: 0,
  setup_fee_cents: 0,
  setup_due_month: null,
  reason: 'condição atual',
  version: 1,
  timezone: 'America/Fortaleza',
  created_at: '2026-09-01T03:00:00Z',
  created_by: 'admin',
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-06T15:00:00Z'));
  mocks.save.mockReset().mockResolvedValue(current);
  mocks.useTerms.mockReturnValue({ data: { rows: [] }, isLoading: false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('CommercialTermsForm', () => {
  it('salva modalidade 2, infraestrutura e vigência no próximo mês', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CommercialTermsForm orgId="org-a" current={null} onSaved={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('Modalidade'), '2');
    await user.clear(screen.getByLabelText('Infraestrutura mensal'));
    await user.type(screen.getByLabelText('Infraestrutura mensal'), '600,00');
    await user.type(screen.getByLabelText('Motivo'), 'novo contrato');
    await user.click(screen.getByRole('button', { name: 'Salvar condições' }));

    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      org_id: 'org-a',
      modality: 2,
      monthly_fee_cents: 60_000,
      starts_on: '2026-10-01',
    }));
  });

  it('permite primeiro contrato iniciando no mês corrente', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CommercialTermsForm orgId="org-a" current={null} onSaved={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('Início da vigência'), '2026-09-01');
    await user.type(screen.getByLabelText('Motivo'), 'início imediato');
    await user.click(screen.getByRole('button', { name: 'Salvar condições' }));

    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      org_id: 'org-a',
      starts_on: '2026-09-01',
    }));
  });

  it('renegociação envia apenas o próximo mês, sem opção de mês corrente', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CommercialTermsForm orgId="org-zero" current={current} onSaved={vi.fn()} />);

    await user.click(screen.getByText('Renegociar'));
    expect(screen.queryByLabelText('Início da vigência')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Motivo'), 'ajuste futuro');
    await user.click(screen.getByRole('button', { name: 'Salvar condições' }));

    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      org_id: 'org-zero',
      starts_on: '2026-10-01',
    }));
  });

  it('preserva zeros e os valores digitados ao trocar modalidade', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CommercialTermsForm orgId="org-zero" current={current} onSaved={vi.fn()} />);

    await user.click(screen.getByText('Renegociar'));
    const monthly = screen.getByLabelText('Infraestrutura mensal');
    await user.clear(monthly);
    await user.type(monthly, '0');
    await user.selectOptions(screen.getByLabelText('Modalidade'), '2');
    expect(monthly).toHaveValue('0');
    await user.type(screen.getByLabelText('Motivo'), 'manter gratuidade');
    await user.click(screen.getByRole('button', { name: 'Salvar condições' }));

    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      org_id: 'org-zero',
      modality: 2,
      monthly_fee_cents: 0,
      revenue_bps: 0,
      sonar_unit_cents: 0,
      setup_fee_cents: 0,
    }));
  });

  it('aplica o padrão de 7% da modalidade 2 sem sobrescrever percentual digitado', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CommercialTermsForm orgId="org-a" current={null} onSaved={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('Modalidade'), '2');
    expect(screen.getByLabelText('Percentual sobre receita')).toHaveValue('7,00');
    await user.clear(screen.getByLabelText('Percentual sobre receita'));
    await user.type(screen.getByLabelText('Percentual sobre receita'), '4,25');
    await user.selectOptions(screen.getByLabelText('Modalidade'), '1');

    expect(screen.getByLabelText('Percentual sobre receita')).toHaveValue('4,25');
  });

  it.each(['-1', '1,001'])('rejeita valor monetário inválido: %s', async (invalid) => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CommercialTermsForm orgId="org-a" current={null} onSaved={vi.fn()} />);

    await user.clear(screen.getByLabelText('Infraestrutura mensal'));
    await user.type(screen.getByLabelText('Infraestrutura mensal'), invalid);
    await user.type(screen.getByLabelText('Motivo'), 'teste inválido');
    await user.click(screen.getByRole('button', { name: 'Salvar condições' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('no máximo duas casas decimais');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('com condição vigente, o card abre recolhido com o resumo e "Renegociar"', () => {
    render(<CommercialTermsForm orgId="org-zero" current={current} onSaved={vi.fn()} />);

    expect(screen.getByText('Renegociar')).toBeInTheDocument();
    expect(screen.getByText('Modalidade 1 · 0,00% sobre receita · desde 2026-09-01')).toBeInTheDocument();
  });

  it('sem condição vigente (primeiro contrato), o card abre aberto', () => {
    render(<CommercialTermsForm orgId="org-a" current={null} onSaved={vi.fn()} />);

    expect(screen.queryByText('Renegociar')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Motivo')).toBeVisible();
  });

  it('mostra histórico vigente, futuro e anterior', () => {
    mocks.useTerms.mockReturnValue({
      data: {
        rows: [
          { ...current, id: 'future', starts_on: '2026-10-01', version: 3 },
          { ...current, id: 'active', starts_on: '2026-09-01', version: 2 },
          { ...current, id: 'old', starts_on: '2026-08-01', version: 1 },
        ],
      },
      isLoading: false,
    });
    render(<CommercialTermsForm orgId="org-a" current={current} onSaved={vi.fn()} />);

    expect(screen.getByText(/Futura/)).toBeInTheDocument();
    expect(screen.getByText(/Vigente/)).toBeInTheDocument();
    expect(screen.getByText(/Anterior/)).toBeInTheDocument();
  });
});
