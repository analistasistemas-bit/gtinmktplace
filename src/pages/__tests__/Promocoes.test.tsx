import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Promocoes from '../Promocoes';
import { useAtualizarPromocoes, useEstadoSyncPromocoes, usePromocoes } from '@/hooks/usePromocoes';
import { useCanalAtivo } from '@/hooks/useCanalAtivo';
import type { Promocao } from '@/lib/promocoes';

vi.mock('@/hooks/usePromocoes', () => ({
  usePromocoes: vi.fn(), useEstadoSyncPromocoes: vi.fn(), useAtualizarPromocoes: vi.fn(),
}));
vi.mock('@/hooks/useCanalAtivo', () => ({ useCanalAtivo: vi.fn() }));
// A aba Operações é testada isolada em lista-operacoes.test.tsx; aqui só o roteamento da página.
vi.mock('@/components/promocoes/lista-operacoes', () => ({ ListaOperacoes: () => <div data-testid="lista-operacoes" /> }));

const QUERY_PENDENTE = { data: undefined, isLoading: true, isPending: true };
const QUERY_VAZIA = { data: [], isLoading: false, isPending: false };

// `finished` há mais de 30 dias: `abaDa` a exclui das 3 abas de campanha (nenhuma renderiza
// CardCampanha), mas ela ainda conta pra `temDados` — testa o roteamento das abas sem precisar
// da forma completa de `ContagemPromo`.
function promoForaDeQualquerAba(): Promocao {
  return {
    promocao_id: 'P-OLD', tipo: 'DEAL', nome: 'Antiga', status: 'finished',
    inicio: null, fim: new Date(Date.now() - 60 * 86_400_000).toISOString(), prazo_adesao: null,
    beneficios: null, contagem: null, erro: null, itens_sincronizados_em: null, rodada_em_curso: null,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location-search">{location.search}</p>;
}

function renderPromocoes(initialEntry = '/promocoes') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <Promocoes />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Promocoes', () => {
  beforeEach(() => {
    vi.mocked(useAtualizarPromocoes).mockReturnValue({ mutate: vi.fn(), isPending: false } as never);
    vi.mocked(useCanalAtivo).mockReturnValue({ canal: 'todos', setCanal: vi.fn(), habilitados: ['mercado_livre'] } as never);
  });

  it('com as duas queries carregando, não mostra o painel de estado de sync (sem flash contraditório com o skeleton)', () => {
    vi.mocked(usePromocoes).mockReturnValue(QUERY_PENDENTE as never);
    vi.mocked(useEstadoSyncPromocoes).mockReturnValue(QUERY_PENDENTE as never);
    renderPromocoes();

    expect(screen.queryByText('Ainda não buscamos as promoções desta conta.')).toBeNull();
  });

  it('depois de carregar, sem dados e sem estado, mostra o convite a buscar', () => {
    vi.mocked(usePromocoes).mockReturnValue(QUERY_VAZIA as never);
    vi.mocked(useEstadoSyncPromocoes).mockReturnValue({ data: null, isLoading: false, isPending: false } as never);
    renderPromocoes();

    expect(screen.getByText('Ainda não buscamos as promoções desta conta.')).toBeTruthy();
  });

  describe('aba fica na URL (?aba=...) — fix round 1, achado 3', () => {
    beforeEach(() => {
      vi.mocked(usePromocoes).mockReturnValue({ data: [promoForaDeQualquerAba()], isLoading: false, isPending: false } as never);
      vi.mocked(useEstadoSyncPromocoes).mockReturnValue({ data: null, isLoading: false, isPending: false } as never);
    });

    it('clicar em Operações grava o parâmetro na URL e mostra a lista', async () => {
      const user = userEvent.setup();
      renderPromocoes();

      await user.click(screen.getByRole('tab', { name: 'Operações' }));

      expect(screen.getByTestId('location-search')).toHaveTextContent('?aba=operacoes');
      expect(screen.getByTestId('lista-operacoes')).toBeInTheDocument();
    });

    it('abrir direto em ?aba=operacoes (navegação da Task 7 após executar) mostra a aba certa sem clicar', () => {
      renderPromocoes('/promocoes?aba=operacoes');
      expect(screen.getByTestId('lista-operacoes')).toBeInTheDocument();
    });

    it('voltar para Ativas remove o parâmetro da URL', async () => {
      const user = userEvent.setup();
      renderPromocoes('/promocoes?aba=operacoes');
      expect(screen.getByTestId('location-search')).toHaveTextContent('?aba=operacoes');

      await user.click(screen.getByRole('tab', { name: /^Ativas/ }));

      expect(screen.getByTestId('location-search')).toHaveTextContent('');
      expect(screen.queryByTestId('lista-operacoes')).not.toBeInTheDocument();
    });
  });
});
