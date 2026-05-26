import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '@/App';

describe('App (smoke)', () => {
  it('renderiza o título do EAN2Marketplace', () => {
    render(<App />);
    expect(screen.getByText('EAN2Marketplace')).toBeInTheDocument();
  });

  it('renderiza o botão "Funciona"', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Funciona' })).toBeInTheDocument();
  });
});
