import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { SidebarNav } from '@/components/sidebar';

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('alterna o tema ao clicar (dark -> light)', () => {
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
    const btn = screen.getByRole('button', { name: /tema claro/i }); // default dark
    fireEvent.click(btn);
    expect(localStorage.getItem('publiai-theme')).toBe('light');
  });
});

describe('SidebarNav', () => {
  it('renderiza os 8 links com hrefs corretos', () => {
    render(<MemoryRouter><SidebarNav /></MemoryRouter>);
    expect(screen.getAllByRole('link')).toHaveLength(8);
    expect(screen.getByRole('link', { name: /Dashboard/i }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: /Publicados/i }).getAttribute('href')).toBe('/publicados');
    expect(screen.getByRole('link', { name: /Faturamento/i }).getAttribute('href')).toBe('/faturamento');
    expect(screen.getByRole('link', { name: /Financeiro/i }).getAttribute('href')).toBe('/financeiro');
    expect(screen.getByRole('link', { name: /Viabilidade/i }).getAttribute('href')).toBe('/viabilidade');
  });
});
