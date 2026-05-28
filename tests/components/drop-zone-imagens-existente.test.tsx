import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DropZoneImagensExistente } from '@/components/drop-zone-imagens-existente';

describe('DropZoneImagensExistente', () => {
  it('renderiza instrução visível', () => {
    render(<DropZoneImagensExistente onArquivos={() => {}} />);
    expect(screen.getByText(/arraste imagens/i)).toBeInTheDocument();
  });

  it('chama onArquivos quando recebe File via input', async () => {
    const onArquivos = vi.fn();
    render(<DropZoneImagensExistente onArquivos={onArquivos} />);
    const input = screen.getByTestId('drop-zone-input') as HTMLInputElement;
    const arquivo = new File(['x'], '00000123.jpeg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [arquivo] } });
    await waitFor(() => {
      expect(onArquivos).toHaveBeenCalled();
    });
    expect(onArquivos.mock.calls[0][0]).toHaveLength(1);
    expect(onArquivos.mock.calls[0][0][0]).toBe(arquivo);
  });
});
