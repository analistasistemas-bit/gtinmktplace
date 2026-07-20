import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboardPdfFixture } from './pdf-dashboard-fixture';
import type { ReportData } from '../tipos';

const { visual, generico } = vi.hoisted(() => ({
  visual: vi.fn(() => ({ save: vi.fn() })),
  generico: vi.fn(() => ({ save: vi.fn(), output: vi.fn(() => new Blob()) })),
}));

vi.mock('../pdf-dashboard', () => ({ gerarPdfDashboard: visual }));
vi.mock('../pdf', () => ({ gerarPdf: generico }));

function reportFixture(overrides: Partial<ReportData> = {}): ReportData {
  return {
    titulo: 'Dashboard',
    colunas: [{ chave: 'valor', titulo: 'Valor' }],
    linhas: [{ celulas: { valor: 1 } }],
    ...overrides,
  };
}

describe('exportar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('open', vi.fn(() => null));
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:dashboard'),
      revokeObjectURL: vi.fn(),
    });
    vi.useFakeTimers();
  });

  it('usa renderer visual somente para Dashboard PDF com payload', async () => {
    const { exportar } = await import('../index');
    await exportar(reportFixture({ dashboardPdf: dashboardPdfFixture() }), 'pdf');
    expect(visual).toHaveBeenCalledOnce();
    expect(generico).not.toHaveBeenCalled();
  });

  it.each(['imprimir', 'pdf'] as const)(
    'usa renderer genérico em %s sem seleção visual aplicável',
    async (formato) => {
      const { exportar } = await import('../index');
      const report = formato === 'imprimir'
        ? reportFixture({ dashboardPdf: dashboardPdfFixture() })
        : reportFixture();
      await exportar(report, formato);
      expect(generico).toHaveBeenCalledOnce();
      expect(visual).not.toHaveBeenCalled();
    },
  );
});
