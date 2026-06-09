import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/components/theme-provider';
import { AppRoutes } from '@/App';

// As rotas protegidas dependem de useAuth; mockamos com um usuário válido
// para que ProtectedRoute libere a renderização. As rotas públicas
// (/login, /cadastro, /reset-senha) também funcionam com esse mock.
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'diego@empresa' },
    session: { access_token: 't' },
    loading: false,
  }),
}));

// Topbar/signOut chamam supabase em runtime real; stubamos a lib de auth
// (signOut etc.) para evitar contato com supabase nas rotas protegidas.
vi.mock('@/lib/auth', () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
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
  it('renderiza Dashboard na rota /', () => {
    renderRoute('/');
    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
  });

  it('renderiza NovoLote na rota /novo-lote', () => {
    renderRoute('/novo-lote');
    expect(screen.getByRole('heading', { name: /novo lote/i })).toBeInTheDocument();
  });

  it('renderiza Progresso na rota /progresso/:loteId', () => {
    renderRoute('/progresso/lote-37');
    expect(screen.getByRole('heading', { name: /processando/i })).toBeInTheDocument();
  });

  it('renderiza Revisao na rota /revisao/:loteId', () => {
    renderRoute('/revisao/lote-42');
    // Now uses a header with buscar input — assert on the placeholder text
    expect(screen.getByPlaceholderText(/buscar por código ou nome/i)).toBeInTheDocument();
  });

  it('renderiza Relatorio na rota /relatorio/:loteId', () => {
    renderRoute('/relatorio/lote-41');
    expect(screen.getByRole('heading', { name: /relat/i })).toBeInTheDocument();
  });

  it('renderiza Configuracoes na rota /configuracoes', () => {
    renderRoute('/configuracoes');
    expect(screen.getByRole('heading', { name: /config/i })).toBeInTheDocument();
  });

  it('renderiza NotFound em rota desconhecida', () => {
    renderRoute('/rota-que-nao-existe');
    expect(screen.getByText(/404/)).toBeInTheDocument();
    expect(screen.getByText(/Página não encontrada/i)).toBeInTheDocument();
  });

  it('renderiza Sidebar dentro das rotas com shell', () => {
    renderRoute('/');
    expect(screen.getAllByText('PubliAI').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('renderiza Login na rota /login (pública)', () => {
    renderRoute('/login');
    expect(screen.getByRole('heading', { name: /PubliAI/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /entrar/i })).toBeInTheDocument();
  });

  it('renderiza Cadastro na rota /cadastro (pública)', () => {
    renderRoute('/cadastro');
    expect(screen.getByRole('heading', { name: /criar conta/i })).toBeInTheDocument();
  });

  it('renderiza ResetSenha na rota /reset-senha (pública)', () => {
    renderRoute('/reset-senha');
    expect(screen.getByRole('heading', { name: /recuperar senha/i })).toBeInTheDocument();
  });
});
