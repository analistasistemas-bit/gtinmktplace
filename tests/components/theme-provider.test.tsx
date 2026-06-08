import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ThemeProvider, useTheme, getStoredTheme } from '@/components/theme-provider';

function Probe() {
  const { theme, toggle } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={toggle}>toggle</button>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('default é dark quando não há valor salvo', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('lê o tema salvo no localStorage', () => {
    localStorage.setItem('publiai-theme', 'light');
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('toggle alterna e persiste no localStorage', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    act(() => { screen.getByText('toggle').click(); });
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(localStorage.getItem('publiai-theme')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('getStoredTheme retorna dark por default e respeita valor salvo', () => {
    expect(getStoredTheme()).toBe('dark');
    localStorage.setItem('publiai-theme', 'light');
    expect(getStoredTheme()).toBe('light');
  });
});
