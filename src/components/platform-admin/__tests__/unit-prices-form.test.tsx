import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnitPricesForm } from '../commercial-terms-form';
import type { CommercialTerms } from '@/lib/platform-admin';

const mocks = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock('@/hooks/usePlatformAdmin', () => ({
  usePlatformTerms: vi.fn(),
  useSavePlatformTerms: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSavePlatformUnitPrices: () => ({ mutateAsync: mocks.save, isPending: false }),
}));

const base: CommercialTerms = {
  id: '60000000-0000-0000-0000-000000000001',
  org_id: 'org-a',
  starts_on: '2026-10-01',
  modality: 2,
  monthly_fee_cents: 0,
  revenue_bps_t1: 700,
  revenue_bps_t2: 600,
  revenue_bps_t3: 550,
  revenue_bps_t4: 500,
  sonar_unit_cents: 120,
  image_unit_cents: 50,
  setup_fee_cents: 0,
  setup_due_month: null,
  reason: 'contrato',
  due_day: 5,
  version: 1,
  timezone: 'America/Fortaleza',
  created_at: '2026-10-01T03:00:00Z',
  created_by: 'admin',
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-08T15:00:00Z'));
  mocks.save.mockReset().mockResolvedValue(base);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('UnitPricesForm', () => {
  it('envia só os dois preços e o termo vigente como base, com o texto de vigência imediata', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onSaved = vi.fn();
    render(<UnitPricesForm orgId="org-a" rows={[base]} onSaved={onSaved} />);
    expect(screen.getByText(/vale para consultas e imagens a partir de agora, neste mês/i)).toBeTruthy();

    const sonar = screen.getByLabelText('Sonar por consulta a partir de agora');
    await user.clear(sonar);
    await user.type(sonar, '1,50');
    const image = screen.getByLabelText('Imagem IA por unidade a partir de agora');
    await user.clear(image);
    await user.type(image, '0,80');
    await user.click(screen.getByRole('button', { name: 'Aplicar a partir de agora' }));

    expect(mocks.save).toHaveBeenCalledWith({
      org_id: 'org-a', expected_terms_id: base.id, sonar_unit_cents: 150, image_unit_cents: 80,
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('modalidade 1: Sonar travado em 0, só a Imagem IA é editável', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<UnitPricesForm orgId="org-a" rows={[{ ...base, modality: 1, monthly_fee_cents: 60000, sonar_unit_cents: 0 }]} onSaved={vi.fn()} />);
    const sonar = screen.getByLabelText('Sonar por consulta a partir de agora') as HTMLInputElement;
    expect(sonar.disabled).toBe(true);
    expect(sonar.value).toBe('0,00');
    const image = screen.getByLabelText('Imagem IA por unidade a partir de agora');
    await user.clear(image);
    await user.type(image, '0,70');
    await user.click(screen.getByRole('button', { name: 'Aplicar a partir de agora' }));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ sonar_unit_cents: 0, image_unit_cents: 70 }));
  });

  it('usa o termo vigente hoje (não o agendado) e avisa que o agendado mantém os preços dele', () => {
    const futuro = { ...base, id: '60000000-0000-0000-0000-000000000002', starts_on: '2026-12-01', sonar_unit_cents: 200, image_unit_cents: 90 };
    render(<UnitPricesForm orgId="org-a" rows={[futuro, base]} onSaved={vi.fn()} />);
    expect((screen.getByLabelText('Sonar por consulta a partir de agora') as HTMLInputElement).value).toBe('1,20');
    expect(screen.getByText(/2026-12-01/).closest('p')?.textContent).toContain('mantém os preços dela');
  });

  it('conflito (tela desatualizada) pede recarga; sem termo vigente, o bloco não aparece', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.save.mockRejectedValueOnce(Object.assign(new Error('Commercial terms revision conflict'), { code: 'conflict' }));
    render(<UnitPricesForm orgId="org-a" rows={[base]} onSaved={vi.fn()} />);
    const image = screen.getByLabelText('Imagem IA por unidade a partir de agora');
    await user.clear(image);
    await user.type(image, '0,60');
    await user.click(screen.getByRole('button', { name: 'Aplicar a partir de agora' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Recarregue/);
    cleanup();

    const { container } = render(<UnitPricesForm orgId="org-a" rows={[{ ...base, starts_on: '2026-12-01' }]} onSaved={vi.fn()} />);
    expect(container.textContent).toBe('');
  });
});
