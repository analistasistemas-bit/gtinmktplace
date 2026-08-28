import { Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const perfil = {
  atual: {
    is_admin: false, is_active: true, allowed_menus: ['configuracoes'],
    org_id: 'org-1', is_super_admin: false,
  } as Record<string, unknown>,
  suporte: null as { orgId: string; scope: 'read' | 'full' } | null,
};

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (seletor: (s: unknown) => unknown) =>
    seletor({ profile: perfil.atual, profileLoading: false }),
}));
vi.mock('@/stores/support-store', () => ({
  useSupportStore: (seletor: (s: unknown) => unknown) => seletor({ context: perfil.suporte }),
}));

// As seções só precisam existir para o roteamento — o conteúdo delas tem teste próprio.
vi.mock('@/components/configuracoes/secao-geral', () => ({ SecaoGeral: () => <div>conteudo-geral</div> }));
vi.mock('@/components/configuracoes/secao-precos', () => ({ SecaoPrecos: () => <div>conteudo-precos</div> }));
vi.mock('@/components/configuracoes/secao-fiscal', () => ({ SecaoFiscal: () => <div>conteudo-fiscal</div> }));
vi.mock('@/components/configuracoes/secao-ia', () => ({ SecaoIA: () => <div>conteudo-ia</div> }));
vi.mock('@/components/configuracoes/secao-notificacoes', () => ({ SecaoNotificacoes: () => <div>conteudo-notificacoes</div> }));
vi.mock('@/pages/Usuarios', () => ({ default: () => <div>conteudo-membros</div> }));

vi.mock('@/hooks/useConfiguracoes', () => ({
  useAliquotas: () => ({ data: { nacional: 8, importado: 16, confirmada: false } }),
}));

import Configuracoes from '../Configuracoes';

function UrlAtual() {
  const { pathname, search } = useLocation();
  return <div data-testid="url">{pathname}{search}</div>;
}

function montar(rota: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <QueryClientProvider client={client}>
        <UrlAtual />
        {/* A seção Membros carrega a página de Usuários por lazy() — como em App.tsx. */}
        <Suspense fallback={<div>carregando-secao</div>}>
          <Routes>
            <Route path="/configuracoes/*" element={<Configuracoes />} />
            <Route path="/canais" element={<div>tela-canais</div>} />
          </Routes>
        </Suspense>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const url = () => screen.getByTestId('url').textContent;

beforeEach(() => {
  perfil.atual = {
    is_admin: false, is_active: true, allowed_menus: ['configuracoes'],
    org_id: 'org-1', is_super_admin: false,
  };
  perfil.suporte = null;
});

describe('Configurações — guard de OAuth', () => {
  // A edge devolve o callback do ML em /configuracoes (URL fixa), mas quem confirma a conexão
  // é /canais, lendo esses parâmetros. Perder a query mata a conexão sem erro visível.
  it.each(['ml_claim', 'ml_conectado', 'ml_erro'])(
    'redireciona %s para /canais preservando a query',
    (param) => {
      montar(`/configuracoes?${param}=abc123`);
      expect(url()).toBe(`/canais?${param}=abc123`);
      expect(screen.getByText('tela-canais')).toBeInTheDocument();
    },
  );

  it('roda ANTES do redirecionamento de seção, mesmo com slug na URL', () => {
    montar('/configuracoes/fiscal?ml_claim=abc123');
    expect(url()).toBe('/canais?ml_claim=abc123');
  });
});

describe('Configurações — seleção de seção', () => {
  it('sem slug, cai na primeira seção visível', () => {
    montar('/configuracoes');
    expect(url()).toBe('/configuracoes/geral');
  });

  it('slug desconhecido cai na primeira seção visível, sem loop', () => {
    montar('/configuracoes/nao-existe');
    expect(url()).toBe('/configuracoes/geral');
  });

  it('abre a seção pedida por deep-link', () => {
    montar('/configuracoes/precos');
    expect(screen.getByText('conteudo-precos')).toBeInTheDocument();
  });
});

describe('Configurações — visibilidade das seções', () => {
  it('não-admin VÊ Fiscal e IA (o SELECT é liberado na org — só a escrita é restrita)', () => {
    montar('/configuracoes/fiscal');
    expect(url()).toBe('/configuracoes/fiscal');
    expect(screen.getByText('conteudo-fiscal')).toBeInTheDocument();

    montar('/configuracoes/ia');
    expect(screen.getAllByText('conteudo-ia').length).toBeGreaterThan(0);
  });

  it('não-admin NÃO vê Membros, nem na sub-nav nem por deep-link', () => {
    montar('/configuracoes/membros');
    expect(url()).toBe('/configuracoes/geral');
    expect(screen.queryByText('conteudo-membros')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /membros e acessos/i })).not.toBeInTheDocument();
  });

  it('admin vê Membros', async () => {
    perfil.atual = { ...perfil.atual, is_admin: true };
    montar('/configuracoes/membros');
    expect(url()).toBe('/configuracoes/membros');
    expect(await screen.findByText('conteudo-membros')).toBeInTheDocument();
  });

  // visibleMenus(p, true) devolve MENU_KEYS, que NÃO contém 'usuarios'. O super-admin que abre
  // a sessão tem is_admin = true, então derivar a visibilidade de `isAdmin` reabriria Membros
  // para quem nunca o viu — por isso ela sai de visibleMenus.
  it('sessão de suporte não vê Membros, mesmo com is_admin no perfil', () => {
    perfil.atual = { ...perfil.atual, is_admin: true, is_super_admin: true };
    perfil.suporte = { orgId: 'org-9', scope: 'full' };

    montar('/configuracoes/membros');
    expect(url()).toBe('/configuracoes/geral');
    expect(screen.queryByText('conteudo-membros')).not.toBeInTheDocument();
  });

  it('sessão de suporte vê Fiscal e IA', () => {
    perfil.atual = { ...perfil.atual, is_admin: true, is_super_admin: true };
    perfil.suporte = { orgId: 'org-9', scope: 'full' };

    montar('/configuracoes/fiscal');
    expect(url()).toBe('/configuracoes/fiscal');
    expect(screen.getByText('conteudo-fiscal')).toBeInTheDocument();
  });
});

describe('Configurações — marcador de alíquotas não confirmadas', () => {
  it('marca a seção Fiscal na sub-nav enquanto não confirmadas', () => {
    montar('/configuracoes/geral');
    expect(screen.getByLabelText('Alíquotas não confirmadas')).toBeInTheDocument();
  });
});
