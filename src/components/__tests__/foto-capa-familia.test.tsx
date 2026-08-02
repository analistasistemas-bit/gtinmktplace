import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
});
