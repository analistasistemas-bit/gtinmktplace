import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signOut: vi.fn() } },
}));

import { useAuthStore } from '@/stores/auth-store';
import { ProtectedRoute } from '../protected-route';

function renderProtegida() {
  render(
    <MemoryRouter initialEntries={['/painel']}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/painel" element={<span>Conteúdo protegido</span>} />
        </Route>
        <Route path="/login" element={<span>Tela de login</span>} />
        <Route path="/sem-acesso" element={<span>Sem acesso</span>} />
      </Routes>
    </MemoryRouter>,
  );
}

// ADR-0153 (D5): offline não é falta de permissão. Erro de rede ao carregar o perfil não pode
// levar a /login nem a /sem-acesso — tem que mostrar um estado "Sem conexão".
describe('ProtectedRoute — offline (ADR-0153 D5)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('perfil nunca carregou por falha de rede: mostra "Sem conexão", sem navegar para /sem-acesso ou /login', () => {
    useAuthStore.setState({
      user: { id: 'u1' } as never,
      loading: false,
      profile: null,
      profileLoading: false,
      profileOffline: true,
    });

    renderProtegida();

    expect(screen.getByText(/sem conexão/i)).toBeInTheDocument();
    expect(screen.queryByText('Tela de login')).not.toBeInTheDocument();
    expect(screen.queryByText('Sem acesso')).not.toBeInTheDocument();
    expect(screen.queryByText('Conteúdo protegido')).not.toBeInTheDocument();
  });

  it('sem usuário autenticado continua indo para /login mesmo com a flag offline pendurada', () => {
    useAuthStore.setState({
      user: null,
      loading: false,
      profile: null,
      profileLoading: false,
      profileOffline: true,
    });

    renderProtegida();

    expect(screen.getByText('Tela de login')).toBeInTheDocument();
  });

  it('perfil carregado com sucesso libera a rota normalmente', () => {
    useAuthStore.setState({
      user: { id: 'u1' } as never,
      loading: false,
      profile: {
        id: 'u1', is_admin: false, is_active: true, allowed_menus: ['faturamento'],
        nome: 'Diego', org_id: 'org-1', is_super_admin: false,
      },
      profileLoading: false,
      profileOffline: false,
    });

    renderProtegida();

    expect(screen.getByText('Conteúdo protegido')).toBeInTheDocument();
  });
});
