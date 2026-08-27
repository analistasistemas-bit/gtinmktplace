import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

let alertasPulse = 0;
vi.mock('@/lib/pulse-contagem', () => ({
  contarPulseAlertas: () => Promise.resolve(alertasPulse),
}));

// SidebarNav usa TanStack Query (contagem de alertas do Pulse); em produção vive dentro do
// provider do App.
function renderNav() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><SidebarNav /></MemoryRouter>
    </QueryClientProvider>
  );
}

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
  beforeEach(() => { modulosHabilitados = []; alertasPulse = 0; });

  it('org sem o módulo estoque: renderiza os 9 links com hrefs corretos, sem Estoque', () => {
    renderNav();
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
    renderNav();
    expect(screen.getAllByRole('link')).toHaveLength(10);
    expect(screen.getByRole('link', { name: /Estoque/i }).getAttribute('href')).toBe('/estoque');
  });

  it('módulo pulse com alertas de ação: badge com a contagem e trilha só no menu Pulse', async () => {
    modulosHabilitados = ['pulse'];
    alertasPulse = 3;
    renderNav();

    // O badge chega com a query: esperar por ele, não pelo link (que já existe sem contagem).
    const badge = await screen.findByText('3');
    const pulse = screen.getByRole('link', { name: /Pulse/i });
    expect(pulse).toContainElement(badge);
    // A trilha marca só o Pulse: um wrapper para todo o menu significaria alerta genérico.
    expect(document.querySelectorAll('.border-trail')).toHaveLength(1);
    expect(document.querySelector('.border-trail')).toContainElement(pulse);
  });

  it('módulo pulse sem alertas: sem badge e sem trilha', async () => {
    modulosHabilitados = ['pulse'];
    renderNav();

    const pulse = await screen.findByRole('link', { name: /Pulse/i });
    expect(pulse).not.toHaveTextContent(/\d/);
    expect(document.querySelector('.border-trail')).not.toBeInTheDocument();
  });
});
