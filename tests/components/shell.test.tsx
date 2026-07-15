import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { SidebarNav } from '@/components/sidebar';
import { MENU_KEYS } from '@/lib/menus';

// Perfil não-admin com todos os 9 menus → renderiza exatamente os 9 links (sem Usuários).
vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({
    profile: { id: 'u1', is_admin: false, is_active: true, allowed_menus: [...MENU_KEYS], nome: 'Op' },
    isAdmin: false,
    profileLoading: false,
  }),
}));

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
  it('renderiza os 9 links com hrefs corretos', () => {
    render(<MemoryRouter><SidebarNav /></MemoryRouter>);
    expect(screen.getAllByRole('link')).toHaveLength(9);
    expect(screen.getByRole('link', { name: /Dashboard/i }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: /Publicados/i }).getAttribute('href')).toBe('/publicados');
    expect(screen.getByRole('link', { name: /Faturamento/i }).getAttribute('href')).toBe('/faturamento');
    expect(screen.getByRole('link', { name: /Financeiro/i }).getAttribute('href')).toBe('/financeiro');
    expect(screen.getByRole('link', { name: /Viabilidade/i }).getAttribute('href')).toBe('/viabilidade');
    expect(screen.getByRole('link', { name: /Canais/i }).getAttribute('href')).toBe('/canais');
  });
});
