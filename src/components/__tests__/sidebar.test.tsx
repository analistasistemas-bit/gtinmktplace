// ADR-0153 D5: RPC de módulos falhando na 1ª carga da sessão deixa `useModulosHabilitados`
// com `data: undefined` sem estar carregando ("não sei"). A sidebar não pode tratar isso como
// `[]` ("sei que a org não contratou nenhum módulo") e sumir com Estoque/Pulse — quem
// realmente contratou continuaria vendo o menu depois de uma falha de rede transitória.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SidebarNav } from '../sidebar';

const profileMock = vi.fn(() => ({
  profile: { is_admin: false, is_active: true, allowed_menus: ['dashboard', 'lotes', 'estoque', 'pulse'] },
  profileLoading: false,
}));
vi.mock('@/hooks/useProfile', () => ({ useProfile: () => profileMock() }));

const modulosMock = vi.fn(() => ({ data: ['estoque', 'pulse'] as string[] | undefined, isLoading: false }));
vi.mock('@/hooks/useModulosHabilitados', () => ({ useModulosHabilitados: () => modulosMock() }));

vi.mock('@/lib/pulse-contagem', () => ({ contarPulseAlertas: vi.fn().mockResolvedValue(0) }));

afterEach(cleanup);

function renderSidebar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SidebarNav />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SidebarNav — módulos undefined na 1ª carga (ADR-0153 D5)', () => {
  it('RPC falhou (modulos undefined, não carregando): Estoque e Pulse continuam no menu', () => {
    modulosMock.mockReturnValue({ data: undefined, isLoading: false });
    renderSidebar();
    expect(screen.getByText('Estoque')).toBeTruthy();
    expect(screen.getByText('Pulse')).toBeTruthy();
  });

  it('ainda carregando (modulos undefined, isLoading true): menu de módulo some (comportamento intencional)', () => {
    modulosMock.mockReturnValue({ data: undefined, isLoading: true });
    renderSidebar();
    expect(screen.queryByText('Estoque')).toBeNull();
    expect(screen.queryByText('Pulse')).toBeNull();
  });

  it('[] de verdade (org sem módulos contratados) CONTINUA escondendo Estoque e Pulse', () => {
    modulosMock.mockReturnValue({ data: [], isLoading: false });
    renderSidebar();
    expect(screen.queryByText('Estoque')).toBeNull();
    expect(screen.queryByText('Pulse')).toBeNull();
  });
});
