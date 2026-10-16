import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

let orgAtual = 'org-1';
vi.mock('@/stores/support-store', () => ({ effectiveOrgId: () => orgAtual }));
const baixar = vi.fn();
vi.mock('@/lib/pacote-contador/baixar', async (orig) => ({ ...(await orig<object>()), baixarNotasMes: (...a: unknown[]) => baixar(...a) }));
const salvar = vi.fn();
vi.mock('@/lib/pacote-contador/montar', async (orig) => ({ ...(await orig<object>()), salvarArquivo: (...a: unknown[]) => salvar(...a) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { toast } from 'sonner';
import { CardPacoteContador } from '../card-pacote-contador';
import { ErroPacote } from '@/lib/pacote-contador/baixar';

beforeEach(() => { orgAtual = 'org-1'; baixar.mockReset(); salvar.mockReset(); vi.mocked(toast.error).mockReset(); });

describe('CardPacoteContador', () => {
  it('padrão = mês anterior; sem mês futuro; vazio gera pacote', async () => {
    vi.setSystemTime(new Date('2026-10-16T12:00:00-03:00'));
    baixar.mockResolvedValueOnce({ tipo: 'vazio', contaMl: '99' });
    render(<CardPacoteContador razaoSocial="EMPRESA TESTE LTDA" cnpj="11444777000161" />);
    const sel = screen.getByLabelText('Mês') as HTMLSelectElement;
    expect(sel.value).toBe('2026-09');
    expect([...sel.options].map((o) => o.value)).not.toContain('2026-11');
    fireEvent.click(screen.getByRole('button', { name: 'Baixar pacote' }));
    await waitFor(() => expect(salvar).toHaveBeenCalledWith('pacote-2026-09.zip', expect.any(Uint8Array), 'application/zip'));
    expect(baixar).toHaveBeenCalledWith('2026-09', 'org-1', expect.any(AbortSignal));
    vi.useRealTimers();
  });
  it('erro do servidor vira toast com a mensagem', async () => {
    baixar.mockRejectedValueOnce(new ErroPacote('O Mercado Livre limitou os downloads — tente de novo em alguns minutos (cerca de 5).', 429));
    render(<CardPacoteContador razaoSocial={null} cnpj={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Baixar pacote' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('O Mercado Livre limitou os downloads — tente de novo em alguns minutos (cerca de 5).'));
  });
  it('org trocada durante o download não salva', async () => {
    baixar.mockImplementationOnce(async () => { orgAtual = 'org-2'; return { tipo: 'vazio', contaMl: '99' }; });
    render(<CardPacoteContador razaoSocial={null} cnpj={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Baixar pacote' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('A organização mudou durante o download — gere o pacote de novo.'));
    expect(salvar).not.toHaveBeenCalled();
  });
  it('desmontar ou trocar a org durante as pausas de leitura/montagem não salva', async () => {
    for (const acao of ['desmontar', 'trocar'] as const) {
      salvar.mockReset(); orgAtual = 'org-1';
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      baixar.mockResolvedValueOnce({ tipo: 'vazio', contaMl: '99' });
      const { unmount } = render(<CardPacoteContador razaoSocial={null} cnpj={null} />);
      fireEvent.click(screen.getByRole('button', { name: 'Baixar pacote' }));
      await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });   // download resolvido; parado na 1ª pausa
      if (acao === 'desmontar') unmount(); else orgAtual = 'org-2';
      await act(async () => { await vi.runAllTimersAsync(); });
      expect(salvar).not.toHaveBeenCalled();
      if (acao === 'trocar') { expect(toast.error).toHaveBeenCalledWith('A organização mudou durante o download — gere o pacote de novo.'); unmount(); }
      vi.useRealTimers();
    }
  });
  it('desmontar durante o download não salva', async () => {
    let soltar: (v: unknown) => void = () => {};
    baixar.mockImplementationOnce(() => new Promise((r) => { soltar = r; }));
    const { unmount } = render(<CardPacoteContador razaoSocial={null} cnpj={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Baixar pacote' }));
    unmount();
    soltar({ tipo: 'vazio', contaMl: '99' });
    await new Promise((r) => setTimeout(r, 20));
    expect(salvar).not.toHaveBeenCalled();
  });
});
