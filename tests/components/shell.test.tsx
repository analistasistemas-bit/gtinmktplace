import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { SidebarNav } from '@/components/sidebar';
import { MENU_KEYS } from '@/lib/menus';

// Perfil não-admin com TODOS os menus permitidos. O que sobra na sidebar depende só do
// gate de módulo (E6b, D-13): 'estoque' está em MENU_KEYS mas é de módulo pago.
vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({
    profile: { id: 'u1', is_admin: false, is_active: true, allowed_menus: [...MENU_KEYS], nome: 'Op' },
    isAdmin: false,
    profileLoading: false,
  }),
}));

let modulosHabilitados: string[] = [];
vi.mock('@/hooks/useModulosHabilitados', () => ({
  useModulosHabilitados: () => ({ data: modulosHabilitados, isLoading: false }),
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
  beforeEach(() => { modulosHabilitados = []; });

  it('org sem o módulo estoque: renderiza os 9 links com hrefs corretos, sem Estoque', () => {
    render(<MemoryRouter><SidebarNav /></MemoryRouter>);
    expect(screen.getAllByRole('link')).toHaveLength(9);
    expect(screen.queryByRole('link', { name: /Estoque/i })).toBeNull();
    expect(screen.getByRole('link', { name: /Dashboard/i }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: /Publicados/i }).getAttribute('href')).toBe('/publicados');
    expect(screen.getByRole('link', { name: /Faturamento/i }).getAttribute('href')).toBe('/faturamento');
    expect(screen.getByRole('link', { name: /Financeiro/i }).getAttribute('href')).toBe('/financeiro');
    expect(screen.getByRole('link', { name: /Viabilidade/i }).getAttribute('href')).toBe('/viabilidade');
    expect(screen.getByRole('link', { name: /Canais/i }).getAttribute('href')).toBe('/canais');
  });

  it('org COM o módulo estoque: o menu Estoque aparece', () => {
    modulosHabilitados = ['estoque'];
    render(<MemoryRouter><SidebarNav /></MemoryRouter>);
    expect(screen.getAllByRole('link')).toHaveLength(10);
    expect(screen.getByRole('link', { name: /Estoque/i }).getAttribute('href')).toBe('/estoque');
  });
});
