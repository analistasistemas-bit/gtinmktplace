import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BotaoTrocarFoto } from '@/components/botao-trocar-foto';

describe('BotaoTrocarFoto', () => {
  it('chama onArquivo com o File selecionado', () => {
    const onArquivo = vi.fn();
    render(<BotaoTrocarFoto onArquivo={onArquivo} />);
    const input = screen.getByTestId('input-trocar-foto') as HTMLInputElement;
    const arquivo = new File(['x'], '00000123.jpeg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [arquivo] } });
    expect(onArquivo).toHaveBeenCalledWith(arquivo);
  });

  it('renderiza ícone de câmera com aria-label', () => {
    render(<BotaoTrocarFoto onArquivo={() => {}} />);
    expect(screen.getByRole('button', { name: /trocar foto/i })).toBeInTheDocument();
  });
});
