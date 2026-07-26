import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth-store';
import { useSupportStore } from '@/stores/support-store';
import { SupportRoute } from '../support-route';

describe('SupportRoute', () => {
  beforeEach(() => {
    useSupportStore.setState({ context: null, loaded: true, loading: false });
  });

  it('redireciona super-admin sem sessão de suporte para o painel', () => {
    useAuthStore.setState({ profile: { id: 'sa', is_admin: false, is_active: true, allowed_menus: [], nome: 'Daludi', org_id: null, is_super_admin: true }, profileLoading: false });
    render(<MemoryRouter initialEntries={['/']}><Routes><Route element={<SupportRoute />}><Route path="/" element={<span>Operação</span>} /></Route><Route path="/admin" element={<span>Painel</span>} /></Routes></MemoryRouter>);

    expect(screen.getByText('Painel')).toBeInTheDocument();
  });

  it('mantém o membro da organização na operação', () => {
    useAuthStore.setState({ profile: { id: 'u1', is_admin: false, is_active: true, allowed_menus: [], nome: 'Membro', org_id: 'org-1', is_super_admin: false }, profileLoading: false });
    render(<MemoryRouter initialEntries={['/']}><Routes><Route element={<SupportRoute />}><Route path="/" element={<span>Operação</span>} /></Route><Route path="/admin" element={<span>Painel</span>} /></Routes></MemoryRouter>);

    expect(screen.getByText('Operação')).toBeInTheDocument();
  });

  it('protege a rota canônica de suporte para super-admin sem sessão e libera admin do tenant', () => {
    useAuthStore.setState({ profile: { id: 'sa', is_admin: false, is_active: true, allowed_menus: [], nome: 'Daludi', org_id: null, is_super_admin: true }, profileLoading: false });
    render(<MemoryRouter initialEntries={['/admin/suporte']}><Routes><Route element={<SupportRoute />}><Route path="/admin/suporte" element={<span>Histórico</span>} /></Route><Route path="/admin" element={<span>Painel</span>} /></Routes></MemoryRouter>);
    expect(screen.getByText('Painel')).toBeInTheDocument();

    cleanup();
    useAuthStore.setState({ profile: { id: 'admin', is_admin: true, is_active: true, allowed_menus: [], nome: 'Admin', org_id: 'org-1', is_super_admin: false }, profileLoading: false });
    render(<MemoryRouter initialEntries={['/admin/suporte']}><Routes><Route element={<SupportRoute />}><Route path="/admin/suporte" element={<span>Histórico</span>} /></Route><Route path="/admin" element={<span>Painel</span>} /></Routes></MemoryRouter>);
    expect(screen.getByText('Histórico')).toBeInTheDocument();
  });

  it('exibe falha de contexto com nova tentativa controlada', async () => {
    const loadContext = vi.fn();
    useAuthStore.setState({ profile: { id: 'sa', is_admin: false, is_active: true, allowed_menus: [], nome: 'Daludi', org_id: null, is_super_admin: true }, profileLoading: false });
    useSupportStore.setState({ context: null, loaded: true, loading: false, error: 'rede indisponível', loadContext } as never);
    render(<MemoryRouter initialEntries={['/']}><Routes><Route element={<SupportRoute />}><Route path="/" element={<span>Operação</span>} /></Route></Routes></MemoryRouter>);

    await screen.findByRole('button', { name: /tentar novamente/i }).then((button) => button.click());
    expect(screen.getByRole('alert')).toHaveTextContent('rede indisponível');
    expect(loadContext).toHaveBeenCalledTimes(1);
  });
});
