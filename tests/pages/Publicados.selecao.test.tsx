import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import Publicados from '@/pages/Publicados';
import type { PublicadoItem } from '@/lib/publicados';

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

vi.mock('@/hooks/usePublicados', () => ({
  usePublicados: () => usePublicadosMock(),
}));

vi.mock('@/hooks/useVendas', () => ({
  useVendas: () => useVendasMock(),
}));

vi.mock('@/hooks/useCustos', () => ({
  useCustos: () => useCustosMock(),
}));

// Mapa listing de catálogo → anúncio dono (ADR-0021). Sem mock, useResumoVendas bateria no supabase.
vi.mock('@/hooks/useAnuncioCanonico', () => ({
  useAnuncioCanonico: () => useAnuncioCanonicoMock(),
}));

// CanalTabs (D2/D3): sem QueryClient no teste, mockamos o hook de canais habilitados.
vi.mock('@/hooks/useCanaisHabilitados', () => ({
  useCanaisHabilitados: () => useCanaisHabilitadosMock(),
}));
vi.mock('@/hooks/useConfiguracoes', () => ({
  useAliquotas: () => ({ data: { nacional: 8, importado: 16 } }),
}));

vi.mock('@/hooks/useStatusPublicados', () => ({
  useStatusPublicados: () => useStatusPublicadosMock(),
}));

// Card "Catálogo em risco" (spec 2026-08-12): a página consulta o hook de verdade, que usaria
// useQuery sem QueryClientProvider neste harness. Lista vazia = card não renderiza.
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

const useProfileMock = vi.fn();
vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => useProfileMock(),
}));

vi.mock('@/hooks/useResumoFinanceiro', () => ({
  useResumoFinanceiro: () => useResumoFinanceiroMock(),
}));

// Expandir item carrega a família via react-query; sem QueryClient no teste, mockamos o hook.
vi.mock('@/hooks/useFamilia', () => ({
  useFamilia: () => useFamiliaMock(),
}));

// ADR-0151: kits vinculados existentes (botão "Criar kit" + lista sob o card do produto-base).
vi.mock('@/hooks/useKitsDoProduto', () => ({
  useKitsDoProduto: () => useKitsDoProdutoMock(),
}));

// ADR-0154: mutation de "Refazer kit" (encerrar-kit-virtual).
vi.mock('@/hooks/useEncerrarKitVirtual', () => ({
  useEncerrarKitVirtual: () => useEncerrarKitVirtualMock(),
}));

// ADR-0154 D-8: `carregarKitVirtualParaRefazer` consulta o supabase de verdade (fora do escopo
// deste teste de página) — mockada; `prefillAposEncerrarKitVirtual` fica REAL (é a peça que
// garante a ordem "só carrega depois do encerrar ter sucesso", o que este arquivo testa).
const carregarKitVirtualParaRefazerMock = vi.fn();
vi.mock('@/lib/kit-virtual', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/kit-virtual')>();
  return {
    ...actual,
    carregarKitVirtualParaRefazer: (kitId: string) => carregarKitVirtualParaRefazerMock(kitId),
  };
});

// O diálogo real usa vários hooks/queries próprios, fora do escopo deste teste de página — um
// stub que expõe `open`/`onOpenChange` basta para provar que o botão/ação certos o abrem.
vi.mock('@/components/kit-virtual/DialogCriarKitVirtual', () => ({
  DialogCriarKitVirtual: ({ open }: { open: boolean; onOpenChange: (v: boolean) => void }) =>
    open ? <div data-testid="dialog-criar-kit-virtual" /> : null,
}));

// MovimentosEstoque (dentro do painel expandido) usa useQuery de verdade — só a busca é mockada.
vi.mock('@/lib/movimentos-estoque', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/movimentos-estoque')>();
  return {
    ...actual,
    fetchMovimentosEstoque: (...args: Parameters<typeof actual.fetchMovimentosEstoque>) =>
      fetchMovimentosEstoqueMock(...args),
  };
});

// Gate do módulo fiscal (ADR-0135 D-13) — mockado no nível do módulo porque viabilidade-linha.tsx
// (dentro do painel expandido) também chama o hook.
vi.mock('@/hooks/useModulosHabilitados', () => ({
  useModulosHabilitados: () => useModulosHabilitadosMock(),
}));

// DialogFiscalProduto (T13) busca dados fiscais direto no supabase — fora do escopo deste teste
// de página. Um stub que expõe `familiaId` basta para provar que o clique dispara o handler certo.
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

// Defaults compartilhados: Publicados consome estes hooks incondicionalmente (sem depender de
// dado/estado), então qualquer describe que renderize <Publicados /> precisa deles configurados —
// não só o describe que os exercita diretamente. Reaproveitado pelo describe de movimentos abaixo.
function mockHooksPadrao() {
  usePublicadosMock.mockReturnValue({
    data: [itemBase()],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  useStatusPublicadosMock.mockReturnValue({
    data: { itens: [] },
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
    mutateAsync: vi.fn().mockResolvedValue(undefined),
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
  // isSuccess importa: as colunas de venda por anúncio só preenchem com o mapa assentado
  // (useResumoVendas.canonicoPronto) — senão a linha mostraria a fatia própria e depois saltaria.
  useAnuncioCanonicoMock.mockReturnValue({ data: { listings: {} }, isSuccess: true, isError: false });
  useFamiliaMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });
  fetchMovimentosEstoqueMock.mockResolvedValue({ itens: [], total: 0 });
  // Default: org sem o módulo fiscal — a coluna "Fiscal" não existe (ver describe dedicado abaixo).
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


// Seleção em massa não toca o backend aqui: só o acompanhamento e a criação da operação.
vi.mock('@/hooks/useOperacoes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useOperacoes')>();
  return { ...actual, useAcompanharOperacao: () => undefined };
});


// I5: o preview do reajuste chama a edge; aqui só interessa o pedido que a tela monta.
vi.mock('@/components/operacoes/preview-reajuste', () => ({
  PreviewReajuste: ({ pedido }: { pedido: unknown }) => <div data-testid="preview-reajuste">{JSON.stringify(pedido)}</div>,
}));

// Aba Operações: a lista tem teste próprio; aqui só o roteamento da aba e o filtro passado.
vi.mock('@/components/operacoes/lista-operacoes', () => ({
  ListaOperacoes: ({ filtro }: { filtro?: string }) => <div data-testid="lista-operacoes">{filtro}</div>,
}));

const FORNECEDORES = ['BUFALO', 'ACME'];
function lote() {
  // 11 anúncios ativos (BUFALO nos pares, ACME nos ímpares) + 1 Kit Virtual + 1 moderado = 13 (2 páginas de 10).
  const itens: PublicadoItem[] = Array.from({ length: 11 }, (_, i) =>
    itemBase({ familiaId: `f${i + 1}`, mlItemId: `MLB${i + 1}`, titulo: `PRODUTO ${String(i + 1).padStart(2, '0')}`, fornecedor: FORNECEDORES[i % 2] }));
  itens.push(itemBase({ familiaId: 'fk', mlItemId: 'MLBK', titulo: 'KIT VIRTUAL X', ehKitVirtual: true, fornecedor: 'BUFALO' }));
  itens.push(itemBase({ familiaId: 'fm', mlItemId: 'MLBM', titulo: 'PRODUTO MODERADO', fornecedor: 'BUFALO' }));
  usePublicadosMock.mockReturnValue({ data: itens, isLoading: false, error: null, refetch: vi.fn() });
  useStatusPublicadosMock.mockReturnValue({
    data: {
      itens: itens.map((i) => ({
        ml_item_id: i.mlItemId, canal: 'mercado_livre', preco: 24.1, estoque: 5, motivo: null, listingType: null,
        status: i.mlItemId === 'MLBM' ? 'moderado' : 'ativo',
      })),
    },
    isFetching: false,
    refetch: vi.fn(),
  });
}

function renderPagina() {
  return render(<MemoryRouter><Publicados /></MemoryRouter>);
}
const caixa = (titulo: string) => screen.getByRole('checkbox', { name: `Selecionar ${titulo}` });
const caixaTitulo = (n: string) => caixa(`PRODUTO ${n}`);

describe('Publicados — seleção em massa', () => {
  beforeEach(() => {
    sessionStorage.clear();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    mockHooksPadrao();
    lote();
  });

  it('moderado tem checkbox desabilitado e Kit Virtual não oferece checkbox', () => {
    renderPagina();
    // sem ordenação o Kit e o moderado vêm no fim (página 2).
    fireEvent.click(screen.getByLabelText('Próxima página'));
    expect(screen.queryByRole('checkbox', { name: 'Selecionar KIT VIRTUAL X' })).not.toBeInTheDocument();
    expect(caixa('PRODUTO MODERADO')).toBeDisabled();
    expect(caixaTitulo('11')).toBeEnabled();
  });

  it('a seleção sobrevive a paginar e ordenar', () => {
    renderPagina();
    fireEvent.click(caixaTitulo('01'));
    expect(screen.getByText('1 selecionado')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Próxima página'));
    expect(screen.getByText('1 selecionado')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Página anterior'));
    expect(caixaTitulo('01')).toBeChecked();
    fireEvent.click(screen.getByLabelText('Ordenar por Estoque atual'));
    expect(screen.getByText('1 selecionado')).toBeInTheDocument();
  });

  it('mudar o filtro de fornecedor zera a seleção', async () => {
    renderPagina();
    fireEvent.click(caixaTitulo('01'));
    expect(screen.getByText('1 selecionado')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('combobox')[0]);
    fireEvent.click(await screen.findByRole('option', { name: 'ACME' }));
    expect(screen.queryByText('1 selecionado')).not.toBeInTheDocument();
  });

  it('o checkbox do cabeçalho seleciona todos os selecionáveis do filtro, não só da página', () => {
    renderPagina();
    // 11 selecionáveis (13 menos Kit Virtual e moderado), embora a página mostre 10 linhas.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar todos do filtro (11)' }));
    expect(screen.getByText('11 selecionados')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pausar 11' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reativar 0' })).toBeDisabled();
  });

  it('Reajustar preço: UP manda a família, Legacy manda o MLB', async () => {
    const { data } = usePublicadosMock() as { data: PublicadoItem[] };
    usePublicadosMock.mockReturnValue({
      data: data.map((i) => (i.mlItemId === 'MLB1' ? { ...i, userProducts: true } : i)), isLoading: false, error: null, refetch: vi.fn(),
    });
    renderPagina();
    fireEvent.click(caixaTitulo('01'));
    fireEvent.click(caixaTitulo('02'));
    fireEvent.click(screen.getByRole('button', { name: 'Reajustar preço (2)' }));
    fireEvent.change(await screen.findByLabelText('Valor do ajuste'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ver preview' }));
    expect(JSON.parse((await screen.findByTestId('preview-reajuste')).textContent!)).toEqual({
      familias: ['f1'], ml_item_ids: ['MLB2'], ajuste: { tipo: 'pct', sentido: '+', valor: 5 },
    });
  });

  it('Reajustar preço: partição Legacy de produto UP vai pelo MLB, sem mandar a família', async () => {
    const { data } = usePublicadosMock() as { data: PublicadoItem[] };
    // MLB1 = linha da família (UP); MLB2 = partição do mesmo produto (fetchPublicados marca userProducts:false).
    usePublicadosMock.mockReturnValue({
      data: data.map((i) => (i.mlItemId === 'MLB1' ? { ...i, userProducts: true } : i.mlItemId === 'MLB2' ? { ...i, familiaId: 'f1', userProducts: false } : i)),
      isLoading: false, error: null, refetch: vi.fn(),
    });
    renderPagina();
    fireEvent.click(caixaTitulo('02'));
    fireEvent.click(screen.getByRole('button', { name: 'Reajustar preço (1)' }));
    fireEvent.change(await screen.findByLabelText('Valor do ajuste'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ver preview' }));
    expect(JSON.parse((await screen.findByTestId('preview-reajuste')).textContent!)).toEqual({
      familias: [], ml_item_ids: ['MLB2'], ajuste: { tipo: 'pct', sentido: '+', valor: 5 },
    });
  });
});

function Local() {
  return <div data-testid="location-search">{useLocation().search}</div>;
}

describe('Publicados — aba Operações', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockHooksPadrao();
    lote();
  });

  it('abre em Anúncios por padrão, sem a lista de operações', () => {
    renderPagina();
    expect(screen.getByRole('tab', { name: 'Anúncios' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('lista-operacoes')).not.toBeInTheDocument();
  });

  it('?aba=operacoes mostra só as operações de Publicados (filtro publicados)', () => {
    render(<MemoryRouter initialEntries={['/publicados?aba=operacoes']}><Publicados /></MemoryRouter>);
    expect(screen.getByRole('tab', { name: 'Operações' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('lista-operacoes')).toHaveTextContent('publicados');
    expect(screen.queryByRole('checkbox', { name: 'Selecionar PRODUTO 01' })).not.toBeInTheDocument();
  });

  it('clicar nas abas grava e limpa ?aba=operacoes na URL', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    render(<MemoryRouter initialEntries={['/publicados']}><Publicados /><Local /></MemoryRouter>);
    await user.click(screen.getByRole('tab', { name: 'Operações' }));
    expect(screen.getByTestId('location-search')).toHaveTextContent('?aba=operacoes');
    expect(screen.getByTestId('lista-operacoes')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Anúncios' }));
    expect(screen.getByTestId('location-search')).toBeEmptyDOMElement();
    expect(screen.queryByTestId('lista-operacoes')).not.toBeInTheDocument();
  });
});
