import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useAuthStore } from '@/stores/auth-store';
import SemAcesso from '../SemAcesso';

describe('SemAcesso', () => {
  it('redireciona a identidade da plataforma para o painel administrativo', () => {
    useAuthStore.setState({
      profile: {
        id: 'sa',
        is_admin: false,
        is_active: true,
        allowed_menus: [],
        nome: 'Daludi',
        org_id: null,
        is_super_admin: true,
      },
      profileLoading: false,
    });

    render(
      <MemoryRouter initialEntries={['/sem-acesso']}>
        <Routes>
          <Route path="/sem-acesso" element={<SemAcesso />} />
          <Route path="/admin" element={<span>Painel</span>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Painel')).toBeInTheDocument();
  });
});
