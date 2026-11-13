// ADR-0200 (adendo 08/11): depois de criar/montar/desmontar, Publicados leva à linha da base, expande e destaca o
// bloco "Kits com variação", que mostra o andamento da transferência.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFocoKitStore } from '@/stores/foco-kit-store';
import type { Familia } from '@/lib/tipos-dominio';
import type { KitVariacaoResumo } from '@/lib/kit-variacao-edge';
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
// ADR-0200: kits com variação (só lidos com o módulo `kit_variacao`).
vi.mock('@/hooks/useKitsVinculadosOrg', () => ({
  useKitsVinculadosOrg: () => ({ data: [], isError: false }),
}));
const useKitsVariacaoMock = vi.fn((): { data: KitVariacaoResumo[] } => ({ data: [] }));
vi.mock('@/hooks/useKitsVariacao', () => ({
  useKitsVariacao: () => useKitsVariacaoMock(),
  useDetalheKitVariacao: () => ({ data: undefined, isLoading: true, isError: false }),
  QK_KITS_VARIACAO: ['kits-variacao'],
}));

vi.mock('@/hooks/useGaleriaPendentes', () => ({ useGaleriaPendentes: () => ({ data: [] }) }));
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
vi.mock('@/components/operacoes/preview-status', () => ({
  PreviewStatus: ({ acao, itens }: { acao: string; itens: { ml_item_id: string }[] }) => (
    <div data-testid="preview-status">{JSON.stringify({ acao, ids: itens.map((i) => i.ml_item_id) })}</div>
  ),
}));
vi.mock('@/components/operacoes/lista-operacoes', () => ({
  ListaOperacoes: ({ filtro }: { filtro?: string }) => <div data-testid="lista-operacoes">{filtro}</div>,
}));

// Os diálogos reais têm teste próprio; aqui só importa qual abre.
vi.mock('@/components/kit-variacao/dialog-gerenciar-kit', () => ({
  DialogGerenciarKit: ({ kit }: { kit: { id: string } }) => <div data-testid="gerenciar-kit">{kit.id}</div>,
}));
vi.mock('@/components/kit-variacao/dialog-criar-kit-variacao', () => ({ DialogCriarKitVariacao: () => null }));

function familiaCarregada(): Familia {
  return {
    id: 'f1', loteId: 'l1', codigoPai: '01829149', titulo: 'COLA', descricao: '', operacao: 'CREATE',
    estrategiaPreco: 'PROPRIO', estrategiaMotivo: '', precoReancoradoLider: false,
    concorrencia: 'sem', concorrenciaVendedores: 0, concorrenciaPrecoMin: null, tipoAviamento: null, categoriaMlId: null,
    precoMin: 24.1, precoMax: 24.1, precoAbaixo20pc: false, capaStoragePath: null, variacoes: [], status: 'pronto',
    tokensInput: null, tokensOutput: null, custoCentavos: null, tituloEditadoPeloOperador: false,
    descricaoEditadaPeloOperador: false, variacoesSemCor: 0, analiseMercado: null, concorrenciaCategoriaId: null,
  } as unknown as Familia;
}

const BASE = '00000100';
const kit = (over: Partial<KitVariacaoResumo> = {}): KitVariacaoResumo => ({
  id: 'K1', codigoPaiBase: BASE, codigoPaiKit: '00000223', pecasPorKit: 2, soEmKit: false, reposicaoAuto: false,
  meta: 0, versao: 1, status: 'publicado', transferencia: null, permalink: null, ...over,
});
const transferencia = (over: Record<string, unknown> = {}) => ({
  id: 'T1', tipo: 'montar', estado: 'ativa', passo: 'conciliar', alerta: null, criadoEm: '2026-11-08T10:00:00Z',
  quarentenaAte: null, criacao: false, ...over,
});

/** 12 anúncios (2 páginas de 10); a base é o 11º, só na página 2. */
function lista(baseNaPagina1: boolean) {
  const itens = Array.from({ length: 12 }, (_, i) => itemBase({
    familiaId: `f${i + 1}`, mlItemId: `MLB${i + 1}`, titulo: `PRODUTO ${String(i + 1).padStart(2, '0')}`,
    codigoPai: `0${String(i + 1).padStart(7, '0')}`, fornecedor: 'BUFALO',
  }));
  const alvo = itens[baseNaPagina1 ? 0 : 10];
  alvo.codigoPai = BASE; alvo.fornecedor = 'ACME';
  usePublicadosMock.mockReturnValue({ data: itens, isLoading: false, error: null, refetch: vi.fn() });
  return alvo;
}

function renderPagina(url = '/publicados') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}><Publicados /></MemoryRouter>
    </QueryClientProvider>,
  );
}
const bloco = () => screen.findByLabelText('Kits com variação');

describe('Publicados — foco e andamento do kit com variação', () => {
  let rolou: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    sessionStorage.clear();
    rolou = vi.fn();
    HTMLElement.prototype.scrollIntoView = rolou as never;
    mockHooksPadrao();
    useFamiliaMock.mockReturnValue({ data: familiaCarregada(), isLoading: false, isError: false });
    useModulosHabilitadosMock.mockReturnValue({ data: ['kit_variacao'] });
    useKitsVariacaoMock.mockReturnValue({ data: [kit({ transferencia: transferencia() })] });
    useFocoKitStore.getState().limpar();
  });

  it('criar kit: expande a linha da base, rola até ela e destaca o bloco com a etapa e o efeito', async () => {
    lista(true);
    renderPagina();
    expect(screen.queryByLabelText('Kits com variação')).toBeNull();
    act(() => useFocoKitStore.getState().focar(BASE, 'K1'));
    const b = await bloco();
    expect(rolou).toHaveBeenCalled();
    expect(b).toHaveAttribute('data-destaque', 'true');
    expect(b.querySelector('.glow-effect-sombra')).not.toBeNull();
    expect(b.querySelector('.border-trail__track')).not.toBeNull();
    expect(b).toHaveTextContent('Conferindo vendas · passo 3 de 9');
    expect(useFocoKitStore.getState().alvo).toBeNull();
  });

  it('kit recém-criado que chega depois do foco ainda rola e destaca (achado Codex)', async () => {
    lista(true);
    useKitsVariacaoMock.mockReturnValue({ data: [] });
    const { rerender } = renderPagina();
    act(() => useFocoKitStore.getState().focar(BASE, 'K1'));
    await screen.findAllByText(/Movimentos de estoque|carregando/i).catch(() => null);
    expect(rolou).not.toHaveBeenCalled();
    useKitsVariacaoMock.mockReturnValue({ data: [kit({ transferencia: transferencia() })] });
    rerender(
      <QueryClientProvider client={new QueryClient()}><MemoryRouter><Publicados /></MemoryRouter></QueryClientProvider>,
    );
    const b = await bloco();
    await waitFor(() => expect(rolou).toHaveBeenCalled());
    expect(b).toHaveAttribute('data-destaque', 'true');
  });

  it('análise da linha ainda carregando (ou com erro): o bloco do kit aparece, rola e destaca (revisão Grok)', async () => {
    lista(true);
    useFamiliaMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderPagina();
    act(() => useFocoKitStore.getState().focar(BASE, 'K1'));
    const b = await bloco();
    expect(rolou).toHaveBeenCalled();
    expect(b).toHaveAttribute('data-destaque', 'true');
    expect(b).toHaveTextContent('Conferindo vendas');
  });

  it('base em outra página: vai até a página dela', async () => {
    lista(false);
    renderPagina();
    expect(screen.queryByText(/produto 11/i)).toBeNull();
    act(() => useFocoKitStore.getState().focar(BASE, 'K1'));
    expect(await bloco()).toBeInTheDocument();
    expect(screen.getByText(/produto 11/i)).toBeInTheDocument();
  });

  it('base fora do filtro: busca pelo código dela', async () => {
    lista(false);
    renderPagina('/publicados?fornecedor=BUFALO');
    act(() => useFocoKitStore.getState().focar(BASE, 'K1'));
    expect(await bloco()).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Buscar por título/)).toHaveValue(BASE);
  });

  it('base fora da lista: abre o Gerenciar kit direto', async () => {
    lista(true);
    useKitsVariacaoMock.mockReturnValue({ data: [kit({ codigoPaiBase: 'SUMIU' })] });
    renderPagina();
    act(() => useFocoKitStore.getState().focar('SUMIU', 'K1'));
    expect(await screen.findByTestId('gerenciar-kit')).toHaveTextContent('K1');
  });

  it('travada: vermelho parado, sem raio, com o alerta', async () => {
    lista(true);
    useKitsVariacaoMock.mockReturnValue({ data: [kit({ transferencia: transferencia({ estado: 'travada', passo: 'aumentar', alerta: 'Leitura divergente' }) })] });
    renderPagina();
    act(() => useFocoKitStore.getState().focar(BASE, 'K1'));
    const b = await bloco();
    expect(b.querySelector('[data-estado="travada"]')).not.toBeNull();
    expect(b.querySelector('.border-trail__track')).toBeNull();
    expect(b.querySelector('.glow-effect-sombra')).toBeNull();
    expect(b).toHaveTextContent('Leitura divergente');
  });

  it('concluída: sem efeito e com o link do anúncio no ML', async () => {
    lista(true);
    useKitsVariacaoMock.mockReturnValue({ data: [kit({ permalink: 'https://produto.mercadolivre.com.br/MLB-9' })] });
    renderPagina();
    act(() => useFocoKitStore.getState().focar(BASE, 'K1'));
    const b = await bloco();
    expect(b.querySelector('.glow-effect-sombra')).toBeNull();
    expect(screen.getByRole('link', { name: /Ver anúncio no ML/ })).toHaveAttribute('href', 'https://produto.mercadolivre.com.br/MLB-9');
  });

  it('link do aviso (?kit=) abre o Gerenciar kit', async () => {
    lista(true);
    renderPagina('/publicados?kit=K1');
    await waitFor(() => expect(screen.getByTestId('gerenciar-kit')).toHaveTextContent('K1'));
  });
});
