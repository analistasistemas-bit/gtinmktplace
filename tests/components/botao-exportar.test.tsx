import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// exportar() é mockado p/ não tocar o sistema de arquivos; validamos o FLUXO de UI.
const exportarMock = vi.fn();
vi.mock('@/lib/export', () => ({ exportar: (...a: unknown[]) => exportarMock(...a) }));

import { BotaoExportar } from '@/components/export/botao-exportar';
import type { ReportData, ExportConfig } from '@/lib/export/tipos';

const REPORT: ReportData = {
  titulo: 'Teste',
  colunas: [{ chave: 'a', titulo: 'A' }],
  linhas: [{ celulas: { a: '1' } }],
};

beforeAll(() => {
  // Radix usa Pointer Capture / scrollIntoView, ausentes no jsdom.
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => exportarMock.mockClear());

describe('BotaoExportar', () => {
  it('oferece CSV e encaminha o formato ao exportador', async () => {
    const user = userEvent.setup();
    const montar = vi.fn((_c: ExportConfig): ReportData => REPORT);
    render(<BotaoExportar montarReport={montar} />);

    await user.click(screen.getByRole('button', { name: /exportar/i }));
    await user.click(await screen.findByRole('menuitem', { name: /csv/i }));

    expect(montar).toHaveBeenCalledWith({ formato: 'csv', expandido: false, incluirKpis: false });
    expect(exportarMock).toHaveBeenCalledWith(REPORT, 'csv');
  });

  it('tela sem KPIs/expansão: escolher Excel dispara export direto (sem diálogo)', async () => {
    const user = userEvent.setup();
    const montar = vi.fn((_c: ExportConfig): ReportData => REPORT);
    render(<BotaoExportar montarReport={montar} />);

    await user.click(screen.getByRole('button', { name: /exportar/i }));
    await user.click(await screen.findByRole('menuitem', { name: /excel/i }));

    expect(montar).toHaveBeenCalledWith({ formato: 'excel', expandido: false, incluirKpis: false });
    expect(exportarMock).toHaveBeenCalledWith(REPORT, 'excel');
    // sem diálogo
    expect(screen.queryByText(/opções de exportação/i)).not.toBeInTheDocument();
  });

  it('tela com KPIs+expansão: PDF abre diálogo; alternar p/ expandidas e confirmar', async () => {
    const user = userEvent.setup();
    const montar = vi.fn((_c: ExportConfig): ReportData => REPORT);
    render(<BotaoExportar temExpansao temKpis montarReport={montar} />);

    await user.click(screen.getByRole('button', { name: /exportar/i }));
    await user.click(await screen.findByRole('menuitem', { name: /pdf/i }));

    // diálogo aparece, nada exportado ainda
    expect(await screen.findByText(/opções de exportação/i)).toBeInTheDocument();
    expect(exportarMock).not.toHaveBeenCalled();

    // escolher "Expandidas" e confirmar
    await user.click(screen.getByRole('radio', { name: /expandidas/i }));
    await user.click(screen.getByRole('button', { name: /^exportar$/i }));

    expect(montar).toHaveBeenCalledWith({ formato: 'pdf', expandido: true, incluirKpis: true });
    expect(exportarMock).toHaveBeenCalledWith(REPORT, 'pdf');
  });

  it('Imprimir com "somente dados" passa incluirKpis=false', async () => {
    const user = userEvent.setup();
    const montar = vi.fn((_c: ExportConfig): ReportData => REPORT);
    render(<BotaoExportar temKpis montarReport={montar} />);

    await user.click(screen.getByRole('button', { name: /exportar/i }));
    await user.click(await screen.findByRole('menuitem', { name: /imprimir/i }));
    await user.click(await screen.findByRole('radio', { name: /somente os dados/i }));
    await user.click(screen.getByRole('button', { name: /imprimir/i }));

    expect(montar).toHaveBeenCalledWith({ formato: 'imprimir', expandido: false, incluirKpis: false });
    expect(exportarMock).toHaveBeenCalledWith(REPORT, 'imprimir');
  });
});
