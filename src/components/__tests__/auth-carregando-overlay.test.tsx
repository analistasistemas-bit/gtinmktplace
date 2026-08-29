import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthCarregandoOverlay } from '../auth-carregando-overlay';

beforeEach(() => {
  vi.spyOn(window, 'matchMedia').mockImplementation(() => ({
    matches: false,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AuthCarregandoOverlay', () => {
  it('não renderiza quando invisível', () => {
    render(<AuthCarregandoOverlay visivel={false} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('mostra logo e status de entrada', () => {
    render(<AuthCarregandoOverlay visivel />);
    expect(screen.getByRole('status', { name: 'Entrando' })).toBeInTheDocument();
    expect(screen.getByText('Entrando…')).toBeInTheDocument();
    expect(screen.getAllByLabelText('PubliAI').length).toBeGreaterThanOrEqual(1);
  });

  it('mostra confirmação no sucesso', () => {
    render(<AuthCarregandoOverlay visivel sucesso />);
    expect(screen.getByRole('status', { name: 'Login realizado' })).toBeInTheDocument();
    expect(screen.getByText('Entrando no painel…')).toBeInTheDocument();
  });
});
