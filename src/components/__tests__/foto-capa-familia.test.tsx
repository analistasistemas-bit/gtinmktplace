import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FotoCapaFamilia } from '../foto-capa-familia';

describe('FotoCapaFamilia', () => {
  it('sem url mostra o placeholder', () => {
    render(<FotoCapaFamilia capaUrl={null} tamanho="small" />);
    expect(screen.getByTestId('capa-placeholder')).toBeInTheDocument();
  });

  // Arquivo apagado do bucket ou URL assinada expirada: o card não pode ficar com imagem
  // quebrada — cai no mesmo placeholder do caso "sem foto".
  it('imagem que falha ao carregar cai no placeholder', () => {
    render(<FotoCapaFamilia capaUrl="https://exemplo.invalido/foto.jpg" tamanho="small" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByTestId('capa-placeholder')).toBeInTheDocument();
  });

  // Safari: URL assinada guardada no cache local pode ficar ruim; a tela precisa se curar sozinha.
  describe('autocura (opt-in via `renovar`)', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    it('1ª falha pede URL nova uma vez e mostra o placeholder até ela chegar', () => {
      const renovar = vi.fn();
      const { rerender } = render(<FotoCapaFamilia capaUrl="https://x.test/velha" tamanho="small" renovar={renovar} />);
      fireEvent.error(screen.getByRole('img'));
      expect(renovar).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('capa-placeholder')).toBeInTheDocument();
      rerender(<FotoCapaFamilia capaUrl="https://x.test/nova" tamanho="small" renovar={renovar} />);
      expect(screen.getByRole('img')).toHaveAttribute('src', 'https://x.test/nova');
    });

    it('URL nova também falha: baixa por fetch e exibe a imagem pelo blob', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['x'], { type: 'image/png' }) });
      vi.stubGlobal('fetch', fetchMock);
      // jsdom não implementa createObjectURL/revokeObjectURL: o stub define as duas.
      URL.createObjectURL = vi.fn().mockReturnValue('blob:foto-1');
      URL.revokeObjectURL = vi.fn();
      const renovar = vi.fn();
      const { rerender } = render(<FotoCapaFamilia capaUrl="https://x.test/velha" tamanho="small" renovar={renovar} />);
      fireEvent.error(screen.getByRole('img'));
      rerender(<FotoCapaFamilia capaUrl="https://x.test/nova" tamanho="small" renovar={renovar} />);
      fireEvent.error(screen.getByRole('img'));
      await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:foto-1'));
      expect(fetchMock).toHaveBeenCalledWith('https://x.test/nova');
      expect(renovar).toHaveBeenCalledTimes(1);
    });

    it('fetch também falha: placeholder, sem laço', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('bloqueado')));
      const renovar = vi.fn();
      const { rerender } = render(<FotoCapaFamilia capaUrl="https://x.test/velha" tamanho="small" renovar={renovar} />);
      fireEvent.error(screen.getByRole('img'));
      rerender(<FotoCapaFamilia capaUrl="https://x.test/nova" tamanho="small" renovar={renovar} />);
      fireEvent.error(screen.getByRole('img'));
      await waitFor(() => expect(screen.getByTestId('capa-placeholder')).toBeInTheDocument());
      expect(renovar).toHaveBeenCalledTimes(1);
    });
  });
});
