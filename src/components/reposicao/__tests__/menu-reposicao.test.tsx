// Spec Reposição §2: item "Reposição" logo abaixo de Estoque; some com o módulo desligado.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NAV_ITEMS, SidebarNav } from '@/components/sidebar';
import { urgenciaDoProduto } from '@/hooks/useReposicao';

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { is_admin: true, is_active: true, allowed_menus: [] }, profileLoading: false }),
}));
const modulosMock = vi.fn(() => ({ data: ['estoque', 'reposicao'] as string[] | undefined, isLoading: false }));
vi.mock('@/hooks/useModulosHabilitados', () => ({ useModulosHabilitados: () => modulosMock() }));
vi.mock('@/lib/pulse-contagem', () => ({ contarPulseAlertas: vi.fn().mockResolvedValue(0) }));

afterEach(cleanup);

function renderSidebar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><SidebarNav /></MemoryRouter></QueryClientProvider>);
}

describe('menu Reposição', () => {
  it('fica logo abaixo de Estoque', () => {
    const keys = NAV_ITEMS.map((i) => i.key);
    expect(keys.indexOf('reposicao')).toBe(keys.indexOf('estoque') + 1);
    expect(NAV_ITEMS.find((i) => i.key === 'reposicao')?.to).toBe('/reposicao');
  });

  it('aparece com o módulo e some sem ele', () => {
    renderSidebar();
    expect(screen.getByText('Reposição')).toBeInTheDocument();
    cleanup();
    modulosMock.mockReturnValue({ data: ['estoque'], isLoading: false });
    renderSidebar();
    expect(screen.queryByText('Reposição')).toBeNull();
  });
});

describe('urgenciaDoProduto', () => {
  it('pega a urgência da família, ou null', () => {
    const data = { resultado: { familias: [{ codigoPai: 'A', urgencia: 'ruptura' }] } } as never;
    expect(urgenciaDoProduto(data, 'A')).toBe('ruptura');
    expect(urgenciaDoProduto(data, 'B')).toBeNull();
    expect(urgenciaDoProduto(undefined, 'A')).toBeNull();
  });
});
