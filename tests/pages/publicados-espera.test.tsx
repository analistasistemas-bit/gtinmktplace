import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Publicados from '@/pages/Publicados';
import type { PublicadoItem } from '@/lib/publicados';

// Mesmo padrão de mocks de tests/pages/Publicados.test.tsx — arquivo separado exige repetir os
// mocks de módulo (escopo por arquivo no vitest).
const usePublicadosMock = vi.fn();
const useStatusPublicadosMock = vi.fn();
const useRemoverPublicadoMock = vi.fn();
const usePrepararRepublicacaoMock = vi.fn();
const usePausarReativarPublicadoMock = vi.fn();
const useMigrarPrecoPorVariacaoMock = vi.fn();
const useRetentarCatalogoMock = vi.fn();
const useResumoFinanceiroMock = vi.fn();
const useVendasMock = vi.fn();
const useCustosMock = vi.fn();
const useCanaisHabilitadosMock = vi.fn();
const useAnuncioCanonicoMock = vi.fn();
const useFamiliaMock = vi.fn();
const fetchMovimentosEstoqueMock = vi.fn();
const useModulosHabilitadosMock = vi.fn();
const useKitsDoProdutoMock = vi.fn();
const useEncerrarKitVirtualMock = vi.fn();
const useProfileMock = vi.fn();
const carregarKitVirtualParaRefazerMock = vi.fn();

vi.mock('@/hooks/usePublicados', () => ({
  usePublicados: () => usePublicadosMock(),
}));
vi.mock('@/hooks/useVendas', () => ({
  useVendas: () => useVendasMock(),
}));
vi.mock('@/hooks/useCustos', () => ({
  useCustos: () => useCustosMock(),
}));
vi.mock('@/hooks/useAnuncioCanonico', () => ({
  useAnuncioCanonico: () => useAnuncioCanonicoMock(),
}));
vi.mock('@/hooks/useCanaisHabilitados', () => ({
  useCanaisHabilitados: () => useCanaisHabilitadosMock(),
}));
vi.mock('@/hooks/useConfiguracoes', () => ({
  useAliquotas: () => ({ data: { nacional: 8, importado: 16 } }),
}));
vi.mock('@/hooks/useStatusPublicados', () => ({
  useStatusPublicados: () => useStatusPublicadosMock(),
}));
vi.mock('@/hooks/useCatalogoEmRisco', () => ({
  useCatalogoEmRisco: () => ({ data: [] }),
}));
vi.mock('@/hooks/useRemoverPublicado', () => ({
  useRemoverPublicado: () => useRemoverPublicadoMock(),
  usePrepararRepublicacao: () => usePrepararRepublicacaoMock(),
}));
vi.mock('@/hooks/usePausarReativarPublicado', () => ({
  usePausarReativarPublicado: () => usePausarReativarPublicadoMock(),
}));
vi.mock('@/hooks/useMigrarPrecoPorVariacao', () => ({
  useMigrarPrecoPorVariacao: () => useMigrarPrecoPorVariacaoMock(),
}));
vi.mock('@/hooks/useRetentarCatalogo', () => ({
  useRetentarCatalogo: () => useRetentarCatalogoMock(),
}));
vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => useProfileMock(),
}));
vi.mock('@/hooks/useResumoFinanceiro', () => ({
  useResumoFinanceiro: () => useResumoFinanceiroMock(),
}));
vi.mock('@/hooks/useFamilia', () => ({
  useFamilia: () => useFamiliaMock(),
}));
vi.mock('@/hooks/useKitsDoProduto', () => ({
  useKitsDoProduto: () => useKitsDoProdutoMock(),
}));
vi.mock('@/hooks/useEncerrarKitVirtual', () => ({
  useEncerrarKitVirtual: () => useEncerrarKitVirtualMock(),
}));
vi.mock('@/lib/kit-virtual', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/kit-virtual')>();
  return {
    ...actual,
    carregarKitVirtualParaRefazer: (kitId: string) => carregarKitVirtualParaRefazerMock(kitId),
  };
});
vi.mock('@/components/kit-virtual/DialogCriarKitVirtual', () => ({
  DialogCriarKitVirtual: ({ open }: { open: boolean; onOpenChange: (v: boolean) => void }) =>
    open ? <div data-testid="dialog-criar-kit-virtual" /> : null,
}));
vi.mock('@/lib/movimentos-estoque', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/movimentos-estoque')>();
  return {
    ...actual,
    fetchMovimentosEstoque: (...args: Parameters<typeof actual.fetchMovimentosEstoque>) =>
      fetchMovimentosEstoqueMock(...args),
  };
});
vi.mock('@/hooks/useModulosHabilitados', () => ({
  useModulosHabilitados: () => useModulosHabilitadosMock(),
}));
vi.mock('@/components/estoque/dialog-fiscal-produto', () => ({
  DialogFiscalProduto: ({ familiaId }: { familiaId: string | null }) =>
    familiaId ? <div data-testid="dialog-fiscal-produto">{familiaId}</div> : null,
}));

function itemBase(over: Partial<PublicadoItem> = {}): PublicadoItem {
  return {
    familiaId: 'f1',
    codigoPai: '01829149',
    titulo: 'COLA LIQUIDA SILICONE 250ML',
    fornecedor: 'BUFALO',
    tipo: 'cola',
    categoria: null,
    precoPublicacao: 24.1,
    descricao: 'descricao',
    mlItemId: 'MLB1',
    mlPermalink: 'https://example.com/mlb1',
    publicadoEm: '2026-06-12T12:36:04.408Z',
    status: 'ativo',
    estoque: 87,
    precoAtual: 24.1,
    motivo: null,
    ...over,
  };
}

function kitItemBase(over: Partial<PublicadoItem> = {}): PublicadoItem {
  return {
    familiaId: '',
    codigoPai: 'kit-virtual:k1',
    titulo: 'Kit Aventura: 1 Motosserra + 1 Canivete',
    fornecedor: null,
    tipo: null,
    categoria: null,
    precoPublicacao: 0,
    descricao: null,
    mlItemId: 'MLB-KIT1',
    mlPermalink: 'https://example.com/kit1',
    publicadoEm: '2026-09-06T00:00:00.000Z',
    status: 'ativo',
    estoque: 4,
    precoAtual: 199.9,
    motivo: null,
    ehKitVirtual: true,
    kitVirtualId: 'k1',
    ...over,
  };
}

function mockHooksPadrao() {
  usePublicadosMock.mockReturnValue({
    data: [itemBase()],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  useStatusPublicadosMock.mockReturnValue({
    data: { itens: [{ ml_item_id: 'MLB1', status: 'ativo', motivo: null, estoque: 87, preco: 24.1 }] },
    isFetching: false,
    refetch: vi.fn(),
  });
  useRemoverPublicadoMock.mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    error: null,
  });
  usePrepararRepublicacaoMock.mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({ lote_id: 'l1' }),
    isPending: false,
    error: null,
  });
  usePausarReativarPublicadoMock.mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    error: null,
  });
  useMigrarPrecoPorVariacaoMock.mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    error: null,
  });
  useRetentarCatalogoMock.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  });
  useResumoFinanceiroMock.mockReturnValue({
    data: { semCredencialMP: true },
    isFetching: false,
    refetch: vi.fn(),
  });
  useVendasMock.mockReturnValue({
    data: [],
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  });
  useCustosMock.mockReturnValue({ data: undefined });
  useCanaisHabilitadosMock.mockReturnValue({ data: ['mercado_livre'] });
  useAnuncioCanonicoMock.mockReturnValue({ data: { listings: {} }, isSuccess: true, isError: false });
  useFamiliaMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });
  fetchMovimentosEstoqueMock.mockResolvedValue({ itens: [], total: 0 });
  useModulosHabilitadosMock.mockReturnValue({ data: [] });
  useKitsDoProdutoMock.mockReturnValue({ data: [] });
  useProfileMock.mockReturnValue({ isAdmin: true });
  useEncerrarKitVirtualMock.mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  });
  carregarKitVirtualParaRefazerMock.mockClear();
  carregarKitVirtualParaRefazerMock.mockResolvedValue({ ok: false, motivo: 'sem_componentes_suficientes' });
}

beforeEach(() => {
  sessionStorage.clear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mockHooksPadrao();
});

function renderPublicados() {
  return render(
    <MemoryRouter>
      <Publicados />
    </MemoryRouter>,
  );
}

// O modal de confirmação fecha no clique hoje — o operador volta para a tabela sem saber se a
// ação foi. Passa a segurar aberto mostrando o sinal, e fecha sozinho quando o ML responde.
// Fecha também quando falha: modal preso aberto é pior que fechar cedo.
describe('Publicados — confirmação segura aberta durante a operação', () => {
  it('o modal continua aberto e mostra a barra enquanto a pausa está em voo', async () => {
    let concluir!: () => void;
    const mutateAsync = vi.fn(() => new Promise<void>((res) => { concluir = () => res(); }));
    usePausarReativarPublicadoMock.mockReturnValue({ mutate: vi.fn(), mutateAsync, isPending: false, error: null });

    const { rerender } = renderPublicados();

    await userEvent.click(screen.getByRole('button', { name: 'Pausar' }));
    await userEvent.click(screen.getByRole('button', { name: /^Pausar$/ }));

    usePausarReativarPublicadoMock.mockReturnValue({ mutate: vi.fn(), mutateAsync, isPending: true, error: null });
    rerender(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('Pausando anúncio');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();

    concluir();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('handler que rejeita também fecha o modal — nunca fica preso', async () => {
    // Task 5 faz o handler engolir o erro, mas o fechamento não pode DEPENDER disso: é um
    // invariante que mora em outro arquivo. O `finally` do onClick é quem garante.
    //
    // Controlamos a rejeição manualmente (em vez de usar Promise.reject direto) porque o ponto
    // que discrimina a arquitetura nova da antiga é o estado ENQUANTO a promise está pendente: no
    // Radix, `AlertDialogAction` fecha o diálogo sincronamente no clique a menos que o `onClick`
    // dê `preventDefault`. Sem isso (código antigo), o clique já fecharia o modal na hora —
    // "fechar depois de rejeitar" seria verdade por acidente, não pelo `finally`. Por isso a
    // asserção central daqui é o `alertdialog`/`progressbar` AINDA presentes antes de rejeitar.
    let rejeitar!: (err: Error) => void;
    const mutateAsync = vi.fn(() => new Promise<void>((_res, rej) => { rejeitar = rej; }));
    usePausarReativarPublicadoMock.mockReturnValue({ mutate: vi.fn(), mutateAsync, isPending: false, error: null });

    const { rerender } = renderPublicados();

    await userEvent.click(screen.getByRole('button', { name: 'Pausar' }));
    await userEvent.click(screen.getByRole('button', { name: /^Pausar$/ }));

    usePausarReativarPublicadoMock.mockReturnValue({ mutate: vi.fn(), mutateAsync, isPending: true, error: null });
    rerender(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );

    // No código antigo (sem preventDefault) o clique já fechou o modal — este `getByRole` não
    // acharia nada e o teste falharia aqui, antes mesmo de chegar na rejeição.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('Pausando anúncio');

    rejeitar(new Error('ML fora do ar'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('a ação é disparada uma única vez, mesmo com clique duplo', async () => {
    const mutateAsync = vi.fn(() => new Promise<void>(() => {}));
    usePausarReativarPublicadoMock.mockReturnValue({ mutate: vi.fn(), mutateAsync, isPending: false, error: null });

    const { rerender } = renderPublicados();

    await userEvent.click(screen.getByRole('button', { name: 'Pausar' }));
    const confirmar = screen.getByRole('button', { name: /^Pausar$/ });
    await userEvent.click(confirmar);

    // A trava do segundo clique é o `disabled={pausando}`, e `pausando` vem do pai — sem este
    // rerender o botão continua habilitado e o teste reprovaria uma implementação correta.
    usePausarReativarPublicadoMock.mockReturnValue({ mutate: vi.fn(), mutateAsync, isPending: true, error: null });
    rerender(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );

    // No código antigo o primeiro clique já fecharia o modal (sem preventDefault) — o `getByRole`
    // abaixo não acharia o `alertdialog` e o teste falharia aqui, antes de sequer chegar ao
    // segundo clique. É essa presença + o `disabled` que provam que o segundo clique não tem
    // como disparar de novo, não só a contagem final de chamadas.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    const confirmarPendente = screen.getByRole('button', { name: /^Pausar$/ });
    expect(confirmarPendente).toBeDisabled();
    await userEvent.click(confirmarPendente);

    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });
});

// Os outros cinco modais são a mesma transformação. Em vez de cinco cópias do teste acima, uma
// tabela: o que precisa ser garantido em ação de Mercado Livre é que ela dispare UMA vez e que
// o modal não fique preso.
type Caso = {
  nome: string;
  abrir: string;
  confirmar: string;
  montarItem?: () => void;
  mockPendente: (mutateAsync: ReturnType<typeof vi.fn>, pendente: boolean) => void;
};

const casos: Caso[] = [
  {
    nome: 'Migrar para preço por variação',
    abrir: 'Migrar para preço por variação',
    confirmar: 'Migrar anúncio',
    montarItem: () => {
      usePublicadosMock.mockReturnValue({
        data: [itemBase({ qtdVariacoesFamilia: 2 })],
        isLoading: false,
        error: null,
      });
    },
    mockPendente: (mutateAsync, pendente) =>
      useMigrarPrecoPorVariacaoMock.mockReturnValue({ mutate: vi.fn(), mutateAsync, isPending: pendente, error: null }),
  },
  {
    nome: 'Corrigir e republicar',
    abrir: 'Corrigir e republicar',
    confirmar: 'Pausar e voltar à Revisão',
    mockPendente: (mutateAsync, pendente) =>
      usePrepararRepublicacaoMock.mockReturnValue({ mutate: vi.fn(), mutateAsync, isPending: pendente, error: null }),
  },
  {
    nome: 'Remover do sistema',
    abrir: 'Remover',
    confirmar: 'Remover',
    mockPendente: (mutateAsync, pendente) =>
      useRemoverPublicadoMock.mockReturnValue({ mutate: vi.fn(), mutateAsync, isPending: pendente, error: null }),
  },
  {
    nome: 'Remover publicação incompleta',
    abrir: 'Remover publicação incompleta',
    confirmar: 'Pausar no ML e remover',
    montarItem: () => {
      usePublicadosMock.mockReturnValue({
        data: [itemBase({ publicacaoIncompleta: true })],
        isLoading: false,
        error: null,
      });
    },
    mockPendente: (mutateAsync, pendente) =>
      useRemoverPublicadoMock.mockReturnValue({ mutate: vi.fn(), mutateAsync, isPending: pendente, error: null }),
  },
  {
    nome: 'Refazer kit',
    abrir: 'Refazer kit',
    confirmar: 'Encerrar e refazer',
    montarItem: () => {
      usePublicadosMock.mockReturnValue({ data: [kitItemBase()], isLoading: false, error: null });
    },
    mockPendente: (mutateAsync, pendente) =>
      useEncerrarKitVirtualMock.mockReturnValue({ mutate: vi.fn(), mutateAsync, isPending: pendente }),
  },
];

// `$nome` no título é resolvido pelo próprio vitest a partir do objeto do caso — não precisa
// (nem pode) ser desestruturado aqui, senão o lint acusa variável não usada.
describe.each(casos)('$nome — segura aberto e dispara uma vez', ({ abrir, confirmar, montarItem, mockPendente }) => {
  it('dispara uma única vez e fecha ao concluir', async () => {
    montarItem?.();
    let concluir!: () => void;
    const mutateAsync = vi.fn(() => new Promise<void>((res) => { concluir = () => res(); }));
    mockPendente(mutateAsync, false);

    const { rerender } = renderPublicados();

    await userEvent.click(screen.getByRole('button', { name: abrir }));
    await userEvent.click(screen.getByRole('button', { name: confirmar }));

    mockPendente(mutateAsync, true);
    rerender(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    concluir();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });
});
