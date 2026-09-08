import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Publicados from '@/pages/Publicados';
import type { PublicadoItem } from '@/lib/publicados';
import type { Familia } from '@/lib/tipos-dominio';
import type { MovimentoEstoque } from '@/lib/movimentos-estoque';

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
    isPending: false,
    error: null,
  });
  usePrepararRepublicacaoMock.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  });
  usePausarReativarPublicadoMock.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  });
  useMigrarPrecoPorVariacaoMock.mockReturnValue({
    mutate: vi.fn(),
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
  useEncerrarKitVirtualMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
  carregarKitVirtualParaRefazerMock.mockClear();
  carregarKitVirtualParaRefazerMock.mockResolvedValue({ ok: false, motivo: 'sem_componentes_suficientes' });
}

describe('Publicados', () => {
  beforeEach(() => {
    sessionStorage.clear(); // expansão da linha agora persiste em sessionStorage; isolar entre casos
    HTMLElement.prototype.scrollIntoView = vi.fn();
    mockHooksPadrao();
  });

  it('oferece Cola no filtro de tipos', () => {
    render(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByRole('combobox')[2]);

    expect(screen.getByRole('option', { name: 'Cola' })).toBeInTheDocument();
  });

  it('mostra a ponte de líquido linkando para o Financeiro quando há dados', () => {
    // A ponte deriva de calcularResumo(vendas) (ADR-0038): líquido = soma de ml_vendas.liquido.
    useVendasMock.mockReturnValue({
      data: [{
        id: 'v1', order_id: 1, status: 'paid', total_amount: 606.8, liquido: 364.46,
        estorno: null, pack_id: null, shipping_id: null, frete_vendedor: null, itens: [],
      }],
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    render(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );
    const ponte = screen.getByRole('link', { name: /Líquido das vendas/i });
    expect(ponte).toHaveAttribute('href', '/financeiro');
    expect(ponte).toHaveTextContent('R$ 364,46');
  });

  // Regressão (incidente 2026-08-07): o protetor solar mostrava 38 unidades aqui e 59 no
  // Faturamento. Causa: a tela chamava calcularResumo direto, sem o mapa canônico — as vendas que
  // entram pelo anúncio de CATÁLOGO (MLB próprio, ADR-0021) ficavam presas naquele MLB, que
  // Publicados não lista. Ver src/lib/anuncio-canonico.ts.
  it('soma na linha do anúncio dono as vendas que entraram pelo anúncio de catálogo', () => {
    const item = (mlItemId: string, quantity: number) => ({
      id: `i-${mlItemId}`, ml_item_id: mlItemId, variation_id: null, titulo: 'COLA LIQUIDA SILICONE 250ML',
      codigo: '01829149', cor: null, ean: null, quantity, unit_price: 24.1, sale_fee: 0, is_publiai: true,
    });
    useVendasMock.mockReturnValue({
      data: [
        { id: 'v1', order_id: 1, status: 'paid', total_amount: 916.7, liquido: 916.7, estorno: null, pack_id: null, shipping_id: null, frete_vendedor: null, itens: [item('MLB1', 38)] },
        { id: 'v2', order_id: 2, status: 'paid', total_amount: 506.1, liquido: 506.1, estorno: null, pack_id: null, shipping_id: null, frete_vendedor: null, itens: [item('MLB-CATALOGO', 21)] },
      ],
      isFetching: false, error: null, refetch: vi.fn(),
    });
    useAnuncioCanonicoMock.mockReturnValue({ data: { listings: { 'MLB-CATALOGO': 'MLB1' } }, isSuccess: true, isError: false });

    render(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );

    const linha = screen.getAllByText('COLA LIQUIDA SILICONE 250ML')
      .map((el) => el.closest('tr'))
      .find((tr): tr is HTMLTableRowElement => tr != null)!;
    // getByText (não toHaveTextContent): a célula tem que ser exatamente 59, senão qualquer valor
    // da linha que contenha "59" — um R$ 1.590,00 futuro — passaria por acidente.
    expect(within(linha).getByText('59')).toBeInTheDocument();
  });

  // Regressão (incidente 2026-08-17): o mesmo produto vendia no ML por VÁRIOS anúncios (um MLB por
  // cor, padrão legado) e só um deles estava vinculado no app. Sem vínculo de catálogo, o critério
  // é o GTIN — o mesmo que o backend já usa no ingest (ADR-0045). A tela mostrava 7 un onde o
  // produto vendera 49 em 90 dias.
  it('soma na linha do anúncio dono as vendas que entraram por anúncio irmão (GTIN)', () => {
    const item = (mlItemId: string, quantity: number, ean: string) => ({
      id: `i-${mlItemId}`, ml_item_id: mlItemId, variation_id: null, titulo: 'COLA LIQUIDA SILICONE 250ML',
      codigo: '01829149', cor: null, ean, quantity, unit_price: 24.1, sale_fee: 0, is_publiai: true,
    });
    useVendasMock.mockReturnValue({
      data: [
        { id: 'v1', order_id: 1, status: 'paid', total_amount: 168.7, liquido: 168.7, estorno: null, pack_id: null, shipping_id: null, frete_vendedor: null, itens: [item('MLB1', 7, '111')] },
        { id: 'v2', order_id: 2, status: 'paid', total_amount: 1012.2, liquido: 1012.2, estorno: null, pack_id: null, shipping_id: null, frete_vendedor: null, itens: [item('MLB-IRMAO', 42, '222')] },
      ],
      isFetching: false, error: null, refetch: vi.fn(),
    });
    useAnuncioCanonicoMock.mockReturnValue({
      data: { listings: {}, gtins: { '111': 'MLB1', '222': 'MLB1' }, conhecidos: new Set(['MLB1']) },
      isSuccess: true, isError: false,
    });

    render(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );

    const linha = screen.getAllByText('COLA LIQUIDA SILICONE 250ML')
      .map((el) => el.closest('tr'))
      .find((tr): tr is HTMLTableRowElement => tr != null)!;
    expect(within(linha).getByText('49')).toBeInTheDocument();
  });

  // O mapa canônico chega numa query separada das vendas. Se a coluna renderizar antes dele, mostra
  // a fatia própria (38) e depois salta para 59 — foi o que o operador viu como "a coluna demora só
  // nesse produto". Enquanto o mapa não assenta, a linha fica em "—" e vai direto ao número final.
  it('mapa canônico ainda carregando: não mostra o parcial na coluna de vendas', () => {
    const item = (mlItemId: string, quantity: number) => ({
      id: `i-${mlItemId}`, ml_item_id: mlItemId, variation_id: null, titulo: 'COLA LIQUIDA SILICONE 250ML',
      codigo: '01829149', cor: null, ean: null, quantity, unit_price: 24.1, sale_fee: 0, is_publiai: true,
    });
    useVendasMock.mockReturnValue({
      data: [
        { id: 'v1', order_id: 1, status: 'paid', total_amount: 916.7, liquido: 916.7, estorno: null, pack_id: null, shipping_id: null, frete_vendedor: null, itens: [item('MLB1', 38)] },
        { id: 'v2', order_id: 2, status: 'paid', total_amount: 506.1, liquido: 506.1, estorno: null, pack_id: null, shipping_id: null, frete_vendedor: null, itens: [item('MLB-CATALOGO', 21)] },
      ],
      isFetching: false, error: null, refetch: vi.fn(),
    });
    useAnuncioCanonicoMock.mockReturnValue({ data: undefined, isSuccess: false, isError: false });

    render(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );

    const linha = screen.getAllByText('COLA LIQUIDA SILICONE 250ML')
      .map((el) => el.closest('tr'))
      .find((tr): tr is HTMLTableRowElement => tr != null)!;
    expect(within(linha).queryByText('38')).not.toBeInTheDocument();
    // A ponte de líquido no topo (KPI agregado) NÃO depende do mapa: segue exibindo.
    expect(screen.getByRole('link', { name: /Líquido das vendas/i })).toHaveTextContent('R$ 1.422,80');
  });

  it('exibe o selo do modo (Premium) vindo do status ao vivo', () => {
    useStatusPublicadosMock.mockReturnValue({
      data: { itens: [{ ml_item_id: 'MLB1', status: 'ativo', motivo: null, estoque: 87, preco: 24.1, listingType: 'premium' }] },
      isFetching: false,
      refetch: vi.fn(),
    });
    render(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );
    expect(screen.getByText('Premium')).toBeInTheDocument();
  });

  it('expandir a linha abre a área de análise (aria-expanded)', () => {
    render(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );
    const toggle = screen.getByRole('button', { name: 'Expandir análise' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Recolher análise' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('clicar em qualquer lugar da linha também expande', () => {
    render(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );
    // clica no título do produto (fora da seta) → a linha inteira é clicável
    fireEvent.click(screen.getByText('COLA LIQUIDA SILICONE 250ML'));
    expect(screen.getByRole('button', { name: 'Recolher análise' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('recorta a lista pelo canal ativo (?canal=): ML aparece, Shopee some; "todos" mostra os dois', () => {
    // parseCanalAtivo só aceita canal operável (habilitado E ativo no registry) — hoje só
    // 'mercado_livre' é 'ativo', então o item shopee nunca vira canal ativo válido, apenas
    // o que deve sumir do recorte quando o filtro é 'mercado_livre'.
    usePublicadosMock.mockReturnValue({
      data: [
        itemBase(),
        itemBase({
          familiaId: 'f2',
          codigoPai: '02000000',
          titulo: 'TESOURA INOX SHOPEE',
          mlItemId: 'MLB2',
          canal: 'shopee',
        }),
      ],
      isLoading: false,
      error: null,
    });

    const comFiltro = render(
      <MemoryRouter initialEntries={['/publicados?canal=mercado_livre']}>
        <Publicados />
      </MemoryRouter>,
    );
    expect(screen.getByText('COLA LIQUIDA SILICONE 250ML')).toBeInTheDocument();
    expect(screen.queryByText('TESOURA INOX SHOPEE')).not.toBeInTheDocument();
    comFiltro.unmount();

    render(
      <MemoryRouter initialEntries={['/publicados']}>
        <Publicados />
      </MemoryRouter>,
    );
    expect(screen.getByText('COLA LIQUIDA SILICONE 250ML')).toBeInTheDocument();
    expect(screen.getByText('TESOURA INOX SHOPEE')).toBeInTheDocument();
  });

  it('admin + catalogRetentavel: botão retentar catálogo visível e dispara mutation', () => {
    const mutate = vi.fn();
    useRetentarCatalogoMock.mockReturnValue({ mutate, isPending: false, error: null });
    usePublicadosMock.mockReturnValue({
      data: [itemBase({ catalogRetentavel: true })],
      isLoading: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );

    const btn = screen.getByRole('button', { name: 'Tentar catálogo de novo' });
    fireEvent.click(btn);
    expect(mutate).toHaveBeenCalledWith('f1', expect.any(Object));
  });

  it('catalogRetentavel false: botão retentar catálogo ausente', () => {
    usePublicadosMock.mockReturnValue({
      data: [itemBase({ catalogRetentavel: false })],
      isLoading: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: 'Tentar catálogo de novo' })).not.toBeInTheDocument();
  });

  // ADR-0151 D-2/D-10/D-12: gatilho "Criar kit" — desabilitado + tooltip, nunca escondido.
  describe('botão Criar kit (ADR-0151)', () => {
    it('habilitado: admin, módulo Estoque, produto sem variação de cor e ainda não é kit', () => {
      useModulosHabilitadosMock.mockReturnValue({ data: ['estoque'] });
      usePublicadosMock.mockReturnValue({
        data: [itemBase({ qtdVariacoesFamilia: 1, kitBaseCodigoPai: null })],
        isLoading: false,
        error: null,
      });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );
      expect(screen.getByRole('button', { name: 'Criar kit' })).toBeEnabled();
    });

    it('desabilitado sem o módulo Estoque', () => {
      useModulosHabilitadosMock.mockReturnValue({ data: [] });
      usePublicadosMock.mockReturnValue({
        data: [itemBase({ qtdVariacoesFamilia: 1, kitBaseCodigoPai: null })],
        isLoading: false,
        error: null,
      });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );
      const btn = screen.getByRole('button', { name: 'Criar kit' });
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute('title', 'Kit vinculado exige o módulo Estoque habilitado.');
    });

    it('desabilitado para produto com mais de uma variação (cor)', () => {
      useModulosHabilitadosMock.mockReturnValue({ data: ['estoque'] });
      usePublicadosMock.mockReturnValue({
        data: [itemBase({ qtdVariacoesFamilia: 2, kitBaseCodigoPai: null })],
        isLoading: false,
        error: null,
      });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );
      const btn = screen.getByRole('button', { name: 'Criar kit' });
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute('title', 'Kit vinculado só existe para produto sem variação de cor.');
    });

    // A edge (`criar-kit-vinculado/processar.ts`) conta TODAS as linhas de `variacoes` da
    // família, sem filtrar `excluida_da_publicacao` — o gating tem que usar o mesmo sinal
    // (`qtdVariacoesFamilia`), não `qtdVariacoes` (só as publicadas no ML). Regressão: uma
    // variação excluída da publicação não pode "esconder" a multi-variação do gating.
    it('desabilitado quando há variação excluída da publicação (ML mostra 1, família tem 2)', () => {
      useModulosHabilitadosMock.mockReturnValue({ data: ['estoque'] });
      usePublicadosMock.mockReturnValue({
        data: [itemBase({ qtdVariacoes: 1, qtdVariacoesFamilia: 2, kitBaseCodigoPai: null })],
        isLoading: false,
        error: null,
      });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );
      const btn = screen.getByRole('button', { name: 'Criar kit' });
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute('title', 'Kit vinculado só existe para produto sem variação de cor.');
    });

    it('desabilitado quando o próprio anúncio já é um kit vinculado', () => {
      useModulosHabilitadosMock.mockReturnValue({ data: ['estoque'] });
      usePublicadosMock.mockReturnValue({
        data: [itemBase({ qtdVariacoesFamilia: 1, kitBaseCodigoPai: '01829149' })],
        isLoading: false,
        error: null,
      });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );
      const btn = screen.getByRole('button', { name: 'Criar kit' });
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute('title', 'Este anúncio já é um kit vinculado.');
    });
  });

  // ADR-0135 D-10: badge de prontidão fiscal — só existe pra org com o módulo.
  describe('coluna Fiscal (ADR-0135 D-10)', () => {
    it('sem o módulo fiscal: a coluna nem aparece', () => {
      useModulosHabilitadosMock.mockReturnValue({ data: [] });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );
      expect(screen.queryByText('Fiscal')).not.toBeInTheDocument();
      expect(screen.queryByText('Fiscal OK')).not.toBeInTheDocument();
    });

    it('canInvoice=true: pill "Fiscal OK"', () => {
      useModulosHabilitadosMock.mockReturnValue({ data: ['fiscal'] });
      usePublicadosMock.mockReturnValue({
        data: [itemBase({ canInvoice: true })],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );
      expect(screen.getByText('Fiscal')).toBeInTheDocument(); // header
      expect(screen.getByText('Fiscal OK')).toBeInTheDocument();
    });

    it('canInvoice=null: pill neutra "Fiscal —"', () => {
      useModulosHabilitadosMock.mockReturnValue({ data: ['fiscal'] });
      usePublicadosMock.mockReturnValue({
        data: [itemBase({ canInvoice: null })],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );
      expect(screen.getByText('Fiscal —')).toBeInTheDocument();
    });

    it('canInvoice=false: pill "Fiscal pendente" e o clique abre o dialog sem expandir a linha', () => {
      useModulosHabilitadosMock.mockReturnValue({ data: ['fiscal'] });
      usePublicadosMock.mockReturnValue({
        data: [itemBase({ canInvoice: false })],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );
      const pill = screen.getByText('Fiscal pendente');
      expect(pill.closest('[data-tone="danger"]')).toBeInTheDocument();

      fireEvent.click(pill);

      expect(screen.getByTestId('dialog-fiscal-produto')).toHaveTextContent('f1');
      // O clique não deve também expandir a linha (stopPropagation) — sem isso, além do
      // dialog, useFamilia('f1') dispararia à toa.
      expect(screen.getByRole('button', { name: 'Expandir análise' })).toHaveAttribute('aria-expanded', 'false');
    });

    // ADR-0135 D-10: "nunca somem em silêncio". `fetchPublicados` ainda descarta anúncios externos
    // sem família representativa (`if (!rep) continue`), então este caso não é alcançável hoje por
    // nenhum dado real — o teste garante só que, se um dia chegar um item assim, a UI não finge que
    // ele tem cadastro fiscal.
    it('item sem familiaId: pill neutra "Sem cadastro fiscal"', () => {
      useModulosHabilitadosMock.mockReturnValue({ data: ['fiscal'] });
      usePublicadosMock.mockReturnValue({
        data: [itemBase({ familiaId: '', canInvoice: null })],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );
      expect(screen.getByText('Sem cadastro fiscal — vincular a produto')).toBeInTheDocument();
    });
  });

  // ADR-0154: kit virtual na tela Publicados — linha própria, sem os botões de produto.
  describe('Kit Virtual (ADR-0154)', () => {
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

    it('renderiza badge, título, link do ML e "Refazer kit" — sem Pausar/Reativar/Remover/Republicar', () => {
      usePublicadosMock.mockReturnValue({ data: [kitItemBase()], isLoading: false, error: null });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );
      expect(screen.getByText('Kit Virtual')).toBeInTheDocument();
      expect(screen.getByText('Kit Aventura: 1 Motosserra + 1 Canivete')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /ML/ })).toHaveAttribute('href', 'https://example.com/kit1');
      expect(screen.getByRole('button', { name: 'Refazer kit' })).toBeInTheDocument();

      expect(screen.queryByRole('button', { name: 'Pausar' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reativar' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Remover' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Corrigir e republicar' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Criar kit' })).not.toBeInTheDocument();
    });

    it('produtos comuns continuam idênticos quando misturados com um kit (armadilha do codigoPai)', () => {
      usePublicadosMock.mockReturnValue({
        data: [itemBase(), kitItemBase()],
        isLoading: false,
        error: null,
      });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );
      // Produto normal: continua com todos os botões de sempre (Pausar/Republicar/Remover) e
      // sem nada herdado do kit (fornecedor/codigoPai não colidem).
      expect(screen.getByText('COLA LIQUIDA SILICONE 250ML')).toBeInTheDocument();
      expect(screen.getByText('01829149')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Pausar' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Remover' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Corrigir e republicar' })).toBeInTheDocument();
      // Kit: linha própria, badge presente.
      expect(screen.getByText('Kit Virtual')).toBeInTheDocument();
    });

    it('botão "Criar kit virtual" visível só para admin', () => {
      const comAdmin = render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );
      expect(screen.getByRole('button', { name: 'Criar kit virtual' })).toBeInTheDocument();
      comAdmin.unmount();

      useProfileMock.mockReturnValue({ isAdmin: false });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );
      expect(screen.queryByRole('button', { name: 'Criar kit virtual' })).not.toBeInTheDocument();
    });

    it('clicar em "Criar kit virtual" abre o diálogo', () => {
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );
      expect(screen.queryByTestId('dialog-criar-kit-virtual')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Criar kit virtual' }));
      expect(screen.getByTestId('dialog-criar-kit-virtual')).toBeInTheDocument();
    });

    it('"Refazer kit": confirma no alert dialog, chama a mutation com o kitId e reabre o diálogo ao suceder', async () => {
      const mutate = vi.fn((_kitId: string, opts?: { onSuccess?: (r: unknown) => void }) => {
        opts?.onSuccess?.({ ok: true, kitId: 'k1', jaEncerrado: false });
      });
      useEncerrarKitVirtualMock.mockReturnValue({ mutate, isPending: false });
      usePublicadosMock.mockReturnValue({ data: [kitItemBase()], isLoading: false, error: null });

      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Refazer kit' }));
      fireEvent.click(screen.getByRole('button', { name: 'Encerrar e refazer' }));

      expect(mutate).toHaveBeenCalledWith('k1', expect.any(Object));
      // O diálogo só reabre DEPOIS do carregamento do prefill (prefillAposEncerrarKitVirtual
      // aguarda `carregarKitVirtualParaRefazer` — ADR-0154 "cuide da ordem").
      expect(carregarKitVirtualParaRefazerMock).toHaveBeenCalledWith('k1');
      await waitFor(() => expect(screen.getByTestId('dialog-criar-kit-virtual')).toBeInTheDocument());
    });

    it('"Refazer kit": encerrar SEM sucesso nunca chama carregarKitVirtualParaRefazer nem reabre o diálogo', async () => {
      const mutate = vi.fn((_kitId: string, opts?: { onSuccess?: (r: unknown) => void }) => {
        opts?.onSuccess?.({ ok: false, motivo: 'ml_recusou', mensagem: 'ML recusou' });
      });
      useEncerrarKitVirtualMock.mockReturnValue({ mutate, isPending: false });
      usePublicadosMock.mockReturnValue({ data: [kitItemBase()], isLoading: false, error: null });

      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Refazer kit' }));
      fireEvent.click(screen.getByRole('button', { name: 'Encerrar e refazer' }));

      expect(mutate).toHaveBeenCalledWith('k1', expect.any(Object));
      expect(carregarKitVirtualParaRefazerMock).not.toHaveBeenCalled();
      expect(screen.queryByTestId('dialog-criar-kit-virtual')).not.toBeInTheDocument();
    });
  });

  describe('botão Migrar para preço por variação', () => {
    const BOTAO = 'Migrar para preço por variação';

    // O status exibido na linha vem do merge com o status ao vivo (useStatusPublicados), não de
    // `item.status` puro — sem uma entrada casando por ml_item_id o merge força 'indisponivel'
    // (Publicados.tsx ~L947), o que esconderia o botão em qualquer teste que precise de
    // ativo/pausado. `itemBase().status` continua útil só para os testes de status "recusado".
    function comStatusAoVivo(mlItemId: string, status: 'ativo' | 'pausado') {
      useStatusPublicadosMock.mockReturnValue({
        data: { itens: [{ ml_item_id: mlItemId, status, motivo: null, estoque: 87, preco: 24.1 }] },
        isFetching: false,
        refetch: vi.fn(),
      });
    }

    it('não aparece para não-admin', () => {
      useProfileMock.mockReturnValue({ isAdmin: false });
      comStatusAoVivo('MLB1', 'ativo');
      usePublicadosMock.mockReturnValue({
        data: [itemBase({ qtdVariacoesFamilia: 2 })],
        isLoading: false,
        error: null,
      });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );
      expect(screen.queryByRole('button', { name: BOTAO })).not.toBeInTheDocument();
    });

    it('não aparece com uma variação só', () => {
      comStatusAoVivo('MLB1', 'ativo');
      usePublicadosMock.mockReturnValue({
        data: [itemBase({ qtdVariacoesFamilia: 1 })],
        isLoading: false,
        error: null,
      });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );
      expect(screen.queryByRole('button', { name: BOTAO })).not.toBeInTheDocument();
    });

    // ADR-0161 (J10): produto publicado como VÁRIOS anúncios (split por faixa de preço) não pode
    // migrar — a adoção zeraria o vínculo das cores que vivem nas outras partições, e o UPDATE
    // seguinte duplicaria variações num anúncio real. A edge function recusa; a tela nem oferece.
    it('não aparece em produto dividido em vários anúncios', () => {
      comStatusAoVivo('MLB1', 'ativo');
      usePublicadosMock.mockReturnValue({
        data: [itemBase({ qtdVariacoesFamilia: 2, produtoDividido: true })],
        isLoading: false,
        error: null,
      });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );
      expect(screen.queryByRole('button', { name: BOTAO })).not.toBeInTheDocument();
    });

    it.each(['encerrado', 'moderado'] as const)('não aparece com status %s', (status) => {
      // Sem entrada em statusData p/ este ml_item_id o merge cai em 'indisponivel' de qualquer
      // forma — o que já cobre o gating. Não precisa de comStatusAoVivo aqui.
      usePublicadosMock.mockReturnValue({
        data: [itemBase({ qtdVariacoesFamilia: 2, status })],
        isLoading: false,
        error: null,
      });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );
      expect(screen.queryByRole('button', { name: BOTAO })).not.toBeInTheDocument();
    });

    it('aparece para admin com mais de uma variação e status ativo/pausado', () => {
      comStatusAoVivo('MLB1', 'ativo');
      usePublicadosMock.mockReturnValue({
        data: [itemBase({ qtdVariacoesFamilia: 2 })],
        isLoading: false,
        error: null,
      });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );
      expect(screen.getByRole('button', { name: BOTAO })).toBeEnabled();
    });

    it('migracaoEmAndamento desabilita Migrar, Pausar e Remover', () => {
      comStatusAoVivo('MLB1', 'ativo');
      usePublicadosMock.mockReturnValue({
        data: [itemBase({ qtdVariacoesFamilia: 2, migracaoEmAndamento: true })],
        isLoading: false,
        error: null,
      });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );
      const btnMigrar = screen.getByRole('button', { name: BOTAO });
      expect(btnMigrar).toBeDisabled();
      expect(btnMigrar).toHaveAttribute('title', 'Migração em andamento');
      expect(screen.getByRole('button', { name: 'Pausar' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Remover' })).toBeDisabled();
    });

    it('migracaoEmAndamento desabilita Reativar (status pausado)', () => {
      comStatusAoVivo('MLB1', 'pausado');
      usePublicadosMock.mockReturnValue({
        data: [itemBase({ qtdVariacoesFamilia: 2, migracaoEmAndamento: true })],
        isLoading: false,
        error: null,
      });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );
      expect(screen.getByRole('button', { name: 'Reativar' })).toBeDisabled();
    });

    it('confirmar chama a mutation com o familia_id certo', () => {
      const mutate = vi.fn();
      useMigrarPrecoPorVariacaoMock.mockReturnValue({ mutate, isPending: false, error: null });
      comStatusAoVivo('MLB1', 'ativo');
      usePublicadosMock.mockReturnValue({
        data: [itemBase({ qtdVariacoesFamilia: 2, familiaId: 'f-migrar' })],
        isLoading: false,
        error: null,
      });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );

      fireEvent.click(screen.getByRole('button', { name: BOTAO }));
      fireEvent.click(screen.getByRole('button', { name: 'Migrar anúncio' }));

      expect(mutate).toHaveBeenCalledWith('f-migrar', expect.any(Object));
    });

    it('cancelar não chama a mutation', () => {
      const mutate = vi.fn();
      useMigrarPrecoPorVariacaoMock.mockReturnValue({ mutate, isPending: false, error: null });
      comStatusAoVivo('MLB1', 'ativo');
      usePublicadosMock.mockReturnValue({
        data: [itemBase({ qtdVariacoesFamilia: 2 })],
        isLoading: false,
        error: null,
      });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );

      fireEvent.click(screen.getByRole('button', { name: BOTAO }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

      expect(mutate).not.toHaveBeenCalled();
    });

    it('o texto do diálogo avisa que não pode ser desfeito e que os pedidos ficam no anúncio antigo', () => {
      comStatusAoVivo('MLB1', 'ativo');
      usePublicadosMock.mockReturnValue({
        data: [itemBase({ qtdVariacoesFamilia: 2 })],
        isLoading: false,
        error: null,
      });
      render(
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>,
      );

      fireEvent.click(screen.getByRole('button', { name: BOTAO }));

      expect(screen.getByText(/não pode ser desfeita/i)).toBeInTheDocument();
      expect(screen.getByText(/pedidos já feitos continuam no anúncio encerrado/i)).toBeInTheDocument();
      expect(screen.getByText(/% OFF/)).toBeInTheDocument();
    });
  });
});

// Fixture mínima, mesma forma usada em tests/components/painel-analise.test.tsx.
function familiaCarregada(over: Partial<Familia> = {}): Familia {
  return {
    id: 'f1', loteId: 'l1', codigoPai: '01829149',
    titulo: 'COLA LIQUIDA SILICONE 250ML', descricao: '', operacao: 'CREATE',
    estrategiaPreco: 'PROPRIO', estrategiaMotivo: 'nosso preço já é mais competitivo que o mercado',
    precoReancoradoLider: false,
    concorrencia: 'sem', concorrenciaVendedores: 0, concorrenciaPrecoMin: null,
    tipoAviamento: null, categoriaMlId: null,
    precoMin: 24.1, precoMax: 24.1, precoAbaixo20pc: false,
    capaStoragePath: null, variacoes: [], status: 'pronto',
    tokensInput: null, tokensOutput: null, custoCentavos: null,
    tituloEditadoPeloOperador: false, descricaoEditadaPeloOperador: false,
    variacoesSemCor: 0,
    analiseMercado: null,
    concorrenciaCategoriaId: null,
    ...over,
  } as Familia;
}

function movimentoBase(over: Partial<MovimentoEstoque> = {}): MovimentoEstoque {
  return {
    id: 'm1', codigo: '00000005', motivo: 'entrada', quantidade: 10,
    quantidade_pedida: null, estoque_resultante: 10, estoque_anterior: 0,
    criado_em: '2026-08-01T05:11:00Z', canal_origem: null, documento: 'NF 1234',
    ...over,
  };
}

describe('Publicados — trilha de movimentos no painel expandido', () => {
  beforeEach(() => {
    // Publicados consome ~8 hooks incondicionalmente (useStatusPublicados, useVendas, etc.) —
    // mockHooksPadrao() garante que este describe não dependa do describe irmão ter rodado antes
    // para deixá-los num estado utilizável (a suíte deve passar mesmo isolada com `-t`).
    mockHooksPadrao();
    useFamiliaMock.mockReturnValue({ data: familiaCarregada(), isLoading: false, isError: false });
    fetchMovimentosEstoqueMock.mockResolvedValue({ itens: [movimentoBase()], total: 1 });
  });

  function renderPublicados() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Publicados />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('exibe os movimentos sem usar <table>', async () => {
    renderPublicados();
    fireEvent.click(screen.getByRole('button', { name: 'Expandir análise' }));

    expect(await screen.findByText('00000005')).toBeInTheDocument();
    expect(screen.getByText(/NF 1234/)).toBeInTheDocument();
    const painel = screen.getByText('Movimentos de estoque').closest('div')!;
    expect(painel.querySelector('table')).toBeNull();
  });
});
