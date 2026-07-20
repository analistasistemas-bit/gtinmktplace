import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/components/theme-provider';
import { AppRoutes } from '@/App';

// As rotas protegidas dependem de useAuth; mockamos com um usuário válido
// para que ProtectedRoute libere a renderização. As rotas públicas
// (/login, /reset-senha, /definir-senha) também funcionam com esse mock.
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'diego@empresa' },
    session: { access_token: 't' },
    loading: false,
  }),
}));

// Perfil admin: ProtectedRoute libera (is_active) e MenuGuard libera todas as rotas.
vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({
    profile: { id: 'u1', is_admin: true, is_active: true, allowed_menus: [], nome: 'Diego' },
    isAdmin: true,
    profileLoading: false,
  }),
}));

// Topbar/signOut chamam supabase em runtime real; stubamos a lib de auth
// (signOut etc.) para evitar contato com supabase nas rotas protegidas.
vi.mock('@/lib/auth', () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  sendPasswordReset: vi.fn(),
}));

// useLotes/useFamilias agora usam TanStack Query + Supabase. Para os smoke tests
// de rota neste arquivo basta devolver lista vazia (loading=false) — assim
// Dashboard renderiza o título e Revisao renderiza o input de busca.
vi.mock('@/hooks/useLotes', () => ({
  useLotes: () => ({ data: [], isLoading: false, error: null, isSuccess: true }),
  useLote: () => ({
    data: {
      id: 'lote-41',
      numero: 41,
      criadoEm: '2026-05-24T10:15:00.000Z',
      status: 'concluido',
      totalFamilias: 0,
      totalPublicadas: 0,
      totalErros: 0,
      anomalias: { codigos_duplicados: [], filhos_orfaos: [], familias_sem_filho: [] },
    },
    isLoading: false,
    error: null,
    isSuccess: true,
  }),
}));
vi.mock('@/hooks/useFamilias', () => ({
  useFamilias: () => ({ data: [], isLoading: false, error: null, isSuccess: true }),
  useFamiliasResumo: () => ({ data: [], isLoading: false, error: null, isSuccess: true }),
}));

function renderRoute(initialPath: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[initialPath]}>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

describe('App routing', () => {
  // Páginas são lazy (code-splitting): findBy* aguarda o Suspense resolver.
  it('renderiza Dashboard na rota /', async () => {
    renderRoute('/');
    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
  });

  it('renderiza Lotes na rota /lotes', async () => {
    renderRoute('/lotes');
    expect(await screen.findByRole('heading', { name: 'Lotes' })).toBeInTheDocument();
  });

  it('mantém /novo-lote como alias da tela Lotes', async () => {
    renderRoute('/novo-lote');
    expect(await screen.findByRole('heading', { name: 'Lotes' })).toBeInTheDocument();
  });

  it('renderiza Progresso na rota /progresso/:loteId', async () => {
    renderRoute('/progresso/lote-37');
    expect(await screen.findByRole('heading', { name: /processando/i })).toBeInTheDocument();
  });

  it('renderiza Revisao na rota /revisao/:loteId', async () => {
    renderRoute('/revisao/lote-42');
    // Now uses a header with buscar input — assert on the placeholder text
    expect(await screen.findByPlaceholderText(/buscar por código ou nome/i)).toBeInTheDocument();
  });

  it('renderiza Relatorio na rota /relatorio/:loteId', async () => {
    renderRoute('/relatorio/lote-41');
    expect(await screen.findByRole('heading', { name: /relat/i })).toBeInTheDocument();
  });

  it('renderiza Configuracoes na rota /configuracoes', async () => {
    renderRoute('/configuracoes');
    expect(await screen.findByRole('heading', { name: /config/i })).toBeInTheDocument();
  });

  it('renderiza NotFound em rota desconhecida', async () => {
    renderRoute('/rota-que-nao-existe');
    expect(await screen.findByText(/404/)).toBeInTheDocument();
    expect(screen.getByText(/Página não encontrada/i)).toBeInTheDocument();
  });

  it('renderiza Sidebar dentro das rotas com shell', async () => {
    renderRoute('/');
    expect(await screen.findByRole('navigation')).toBeInTheDocument();
    expect(screen.getAllByLabelText('PubliAI').length).toBeGreaterThanOrEqual(1);
  });

  it('renderiza Login na rota /login (pública)', async () => {
    renderRoute('/login');
    expect(await screen.findByRole('button', { name: /entrar/i })).toBeInTheDocument();
    expect(screen.getByLabelText('PubliAI')).toBeInTheDocument();
  });

  it('renderiza ResetSenha na rota /reset-senha (pública)', async () => {
    renderRoute('/reset-senha');
    expect(await screen.findByRole('heading', { name: /recuperar senha/i })).toBeInTheDocument();
  });
});
