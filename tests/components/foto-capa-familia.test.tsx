import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FotoCapaFamilia } from '@/components/foto-capa-familia';

describe('<FotoCapaFamilia>', () => {
  it('mostra placeholder quando capaUrl é null', () => {
    render(<FotoCapaFamilia capaUrl={null} tamanho="small" />);
    expect(screen.getByTestId('capa-placeholder')).toBeInTheDocument();
  });

  it('renderiza img quando capaUrl é string', () => {
    render(<FotoCapaFamilia capaUrl="https://example.com/x.jpg" tamanho="large" />);
    const img = screen.getByRole('img', { name: /capa/i });
    expect(img).toHaveAttribute('src', 'https://example.com/x.jpg');
  });

  it('tamanho small renderiza 40x40, large renderiza 200x200', () => {
    const { rerender } = render(<FotoCapaFamilia capaUrl={null} tamanho="small" />);
    expect(screen.getByTestId('capa-placeholder')).toHaveClass('h-10', 'w-10');
    rerender(<FotoCapaFamilia capaUrl={null} tamanho="large" />);
    expect(screen.getByTestId('capa-placeholder')).toHaveClass('h-48', 'w-48');
  });
});
