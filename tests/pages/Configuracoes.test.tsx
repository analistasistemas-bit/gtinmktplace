import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

// Os controles saíram da coluna única e viraram seções com rota própria (2026-08-28), então o
// ponto de montagem mudou: cada teste renderiza a seção dona do controle, não a página inteira.
// As asserções continuam as mesmas — é o mesmo contrato de negócio.
import { SecaoGeral } from '@/components/configuracoes/secao-geral';
import { SecaoPrecos } from '@/components/configuracoes/secao-precos';

// Perfil de admin: os controles agora replicam o RLS de `configuracoes`, que exige admin.
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (seletor: (s: unknown) => unknown) => seletor({
    profile: { is_admin: true, is_active: true, allowed_menus: ['configuracoes'], org_id: 'org-1' },
    profileLoading: false,
  }),
}));
vi.mock('@/stores/support-store', () => ({
  useSupportStore: (seletor: (s: unknown) => unknown) => seletor({ context: null }),
}));

const salvarReancoraLiderAtiva = vi.fn();
const salvarMostrarLucroDashboard = vi.fn();

vi.mock('@/hooks/useConfiguracoes', () => ({
  useDescontoPct: () => ({ data: 15 }),
  useSalvarDescontoPct: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, isError: false }),
  useDescontoConcorrenciaPct: () => ({ data: 5 }),
  useSalvarDescontoConcorrenciaPct: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, isError: false }),
  useReancoraLiderAtiva: () => ({ data: true }),
  useSalvarReancoraLiderAtiva: () => ({ mutate: salvarReancoraLiderAtiva, isPending: false, isSuccess: false, isError: false }),
  useMostrarLucroDashboard: () => ({ data: false }),
  useSalvarMostrarLucroDashboard: () => ({ mutate: salvarMostrarLucroDashboard, isPending: false, isSuccess: false, isError: false }),
}));

function renderSecao(secao: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{secao}</QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Configurações — re-âncora no piso dos MercadoLíderes', () => {
  it('reflete o valor atual e dispara a mutation ao alternar', () => {
    renderSecao(<SecaoPrecos />);

    const toggle = screen.getByRole('switch', { name: /ancorar preço no piso dos MercadoLíderes/i });
    expect(toggle).toHaveAttribute('data-state', 'checked');

    fireEvent.click(toggle);
    expect(salvarReancoraLiderAtiva).toHaveBeenCalledWith(false);
  });
});

describe('Configurações — mostrar lucro no Dashboard', () => {
  it('reflete o valor atual (desligado) e dispara a mutation ao alternar', () => {
    renderSecao(<SecaoGeral />);

    const toggle = screen.getByRole('switch', { name: /mostrar lucro no card do dashboard/i });
    expect(toggle).toHaveAttribute('data-state', 'unchecked');

    fireEvent.click(toggle);
    expect(salvarMostrarLucroDashboard).toHaveBeenCalledWith(true);
  });
});

describe('Configurações — gate de edição', () => {
  it('membro comum não consegue alternar: o RLS de configuracoes exige admin', async () => {
    vi.resetModules();
    vi.doMock('@/stores/auth-store', () => ({
      useAuthStore: (seletor: (s: unknown) => unknown) => seletor({
        profile: { is_admin: false, is_active: true, allowed_menus: ['configuracoes'], org_id: 'org-1' },
        profileLoading: false,
      }),
    }));
    const { SecaoGeral: SecaoGeralMembro } = await import('@/components/configuracoes/secao-geral');

    renderSecao(<SecaoGeralMembro />);
    const toggle = screen.getByRole('switch', { name: /mostrar lucro no card do dashboard/i });
    expect(toggle).toBeDisabled();
  });
});
