import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Estoque from '../Estoque';
import type { ProdutoEstoqueResumo, ResumoEstoqueRpc } from '@/lib/produtos-saldo';

// `typeof import(...)` em vez de `import type { filtrarProdutos as X }`: importar um VALOR sob
// `import type` não produz um tipo utilizável em `Parameters<X>`/`ReturnType<X>` — TS recusa com
// "refers to a value, but is being used as a type" (pedindo `typeof X`, que aqui já nasce certo).
type FiltrarProdutosFn = (typeof import('@/lib/produtos-saldo-filtro'))['filtrarProdutos'];

const produto: ProdutoEstoqueResumo = {
  codigoPai: '00000004', nomePai: 'Protetor Solar', descricaoPai: null,
  capaStoragePath: null, capaMlPictureId: null, fornecedor: 'Eucerin', unidade: 'UN', origem: 'nacional',
  mlItemId: null, criadoEm: '2026-08-01T10:00:00Z', saldoTotal: 20, qtdSkus: 1, skuUnico: '00000005',
  gtins: ['4005800241901'], codigos: ['00000005'], cores: ['incolor'],
};

const resumoMock: ResumoEstoqueRpc = {
  kpis: { produtos: 1, skus: 1, unidades: 20, skusSemEstoque: 0, valorEmEstoque: 240, skusSemCusto: 0 },
  produtos: [produto],
};

// vi.fn() (não Promise inline): o teste de canais em erro precisa rejeitar só nesse caso,
// sem afetar os demais testes deste arquivo.
const fetchCanaisPorProdutoMock = vi.fn(() => Promise.resolve(new Map<string, string[]>()));

vi.mock('@/hooks/useModulosHabilitados', () => ({
  useModulosHabilitados: () => ({ data: ['estoque'], isLoading: false }),
}));
vi.mock('@/hooks/useImageUrl', () => ({ useImageUrl: () => ({ data: null, isError: false }) }));
vi.mock('@/lib/produtos-saldo', async (orig) => ({
  ...(await orig<typeof import('@/lib/produtos-saldo')>()),
  fetchProdutosEstoqueResumo: () => Promise.resolve(resumoMock),
  fetchCanaisPorProduto: () => fetchCanaisPorProdutoMock(),
}));

// Achado 3 (revisão de baixas): spy que delega pro real `filtrarProdutos`, mas grava os
// argumentos de CADA chamada — inclusive a do render que acontece ANTES do useEffect de reset
// rodar. É essa história de chamadas, não o DOM num instante específico, que prova
// deterministicamente se o `filtro` usado nesse render já veio corrigido (sem depender de
// vencer a corrida contra o efeito, que o React já roda em lote nos testes).
// `vi.hoisted` guarda o mock isolado da variável interna do módulo mockado: o factory pega o
// `filtrarProdutos` ORIGINAL de `orig()` (não do módulo já mockado, senão a implementação
// chamaria a si mesma e estouraria a pilha).
const { filtrarProdutosMock } = vi.hoisted(() => ({
  filtrarProdutosMock: vi.fn<FiltrarProdutosFn>(),
}));
vi.mock('@/lib/produtos-saldo-filtro', async (orig) => {
  const mod = await orig<typeof import('@/lib/produtos-saldo-filtro')>();
  filtrarProdutosMock.mockImplementation((...args: Parameters<typeof mod.filtrarProdutos>) => mod.filtrarProdutos(...args));
  return { ...mod, filtrarProdutos: filtrarProdutosMock };
});

function renderEstoque() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Estoque /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Estoque', () => {
  afterEach(() => {
    fetchCanaisPorProdutoMock.mockReset();
    fetchCanaisPorProdutoMock.mockImplementation(() => Promise.resolve(new Map()));
  });

  it('busca por GTIN encontra o produto', async () => {
    const user = userEvent.setup();
    renderEstoque();
    await screen.findByText('Protetor Solar');
    await user.type(screen.getByPlaceholderText(/Buscar por nome/), '4005800241901');
    expect(screen.getByText('Protetor Solar')).toBeInTheDocument();
  });

  it('busca que não casa mostra a mensagem de vazio com o termo', async () => {
    const user = userEvent.setup();
    renderEstoque();
    await screen.findByText('Protetor Solar');
    await user.type(screen.getByPlaceholderText(/Buscar por nome/), 'zzzz');
    expect(screen.getByText(/Nenhum produto bate com/)).toBeInTheDocument();
  });

  // Achado 1 (revisão final): a mensagem antiga citava o termo mesmo quando o vazio veio do
  // filtro, sem busca nenhuma — "Nenhum produto bate com "".", que não diz nada ao operador.
  it('filtro sem resultado (sem busca) mostra mensagem sobre o filtro, não sobre um termo vazio', async () => {
    const user = userEvent.setup();
    renderEstoque();
    await screen.findByText('Protetor Solar');
    // O único produto do mock tem saldo 20 — "Sem estoque" zera a lista sem envolver a busca.
    await user.click(screen.getByRole('button', { name: 'Sem estoque' }));
    expect(screen.getByText('Nenhum produto encontrado com o filtro selecionado.')).toBeInTheDocument();
    expect(screen.queryByText(/bate com/)).not.toBeInTheDocument();
  });

  it('não renderiza nenhuma <table>', async () => {
    renderEstoque();
    await screen.findByText('Protetor Solar');
    expect(document.querySelectorAll('table')).toHaveLength(0);
  });

  // Achado 2 (revisão final, guarda que a spec §7 já exigia): isLoading e isError da query de
  // canais eram colapsados num único booleano — a UI mostrava a mensagem de ERRO durante o
  // estado transitório de loading, o que é factualmente falso.
  it('canais em erro: opção "não publicado" fica desabilitada, o erro aparece, e uma seleção prévia cai para "todos" com aviso', async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Semeia a query já resolvida, para poder selecionar "não publicado" antes de forçar o erro
    // — a opção fica desabilitada durante loading/erro, então só dá pra clicar nela com sucesso.
    qc.setQueryData(['canais-por-produto'], new Map());
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><Estoque /></MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('Protetor Solar');

    await user.click(screen.getByRole('button', { name: 'Não publicado' }));
    expect(screen.getByRole('button', { name: 'Não publicado' })).toHaveAttribute('data-variant', 'secondary');

    fetchCanaisPorProdutoMock.mockRejectedValueOnce(new Error('falhou ao carregar canais'));
    await qc.refetchQueries({ queryKey: ['canais-por-produto'] });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Não publicado' })).toBeDisabled();
    });
    expect(screen.getByText(/não foi possível carregar os canais/i)).toBeInTheDocument();
    // Caiu de volta para "todos" — a seleção anterior não sobrevive a um filtro que a UI sabe
    // que responderia errado.
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('data-variant', 'secondary');
  });

  // Achado 3 (revisão de baixas): o useEffect que reseta `filtro` para 'todos' quando os canais
  // ficam indisponíveis só se aplica no PRÓXIMO render — sem um `filtroEfetivo` calculado no
  // render atual, a MESMA chamada de `filtrarProdutos` que dispara logo que a query de canais
  // erra ainda usaria `filtro: 'nao-publicado'` com `canaisPorProduto: undefined`, e a lista
  // apareceria vazia por um frame (mesmo havendo produtos) até o efeito corrigir o state.
  //
  // Testar Library com act()/waitFor não prova ausência de flash de forma confiável: o React
  // já lida com passive effects em lote nos testes, então checar o DOM depois de um `waitFor`
  // não garante que a checagem aconteceu ANTES do efeito rodar. Em vez de correr essa corrida,
  // o teste inspeciona o HISTÓRICO de chamadas de `filtrarProdutos` (spy que delega pro real) —
  // nenhuma delas, nem a que roda no exato render em que a query vira erro, pode combinar
  // `filtro: 'nao-publicado'` com `canaisPorProduto: undefined`. Essa combinação é precisamente
  // a que produz lista vazia (ver `produtoPublicado`, que assume "publicado" com canais
  // indisponíveis).
  it('canais falham com "não publicado" selecionado: nenhuma chamada de filtrarProdutos combina o filtro velho com canais indisponíveis (sem flash de lista vazia)', async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['canais-por-produto'], new Map());
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><Estoque /></MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('Protetor Solar');
    await user.click(screen.getByRole('button', { name: 'Não publicado' }));

    filtrarProdutosMock.mockClear();
    fetchCanaisPorProdutoMock.mockRejectedValueOnce(new Error('falhou ao carregar canais'));
    await qc.refetchQueries({ queryKey: ['canais-por-produto'] });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Não publicado' })).toBeDisabled();
    });

    const chamadasComCanaisIndisponiveis = filtrarProdutosMock.mock.calls.filter(
      ([, opts]) => opts.canaisPorProduto === undefined,
    );
    expect(chamadasComCanaisIndisponiveis.length).toBeGreaterThan(0);
    for (const [, opts] of chamadasComCanaisIndisponiveis) {
      expect(opts.filtro).not.toBe('nao-publicado');
    }
    // E a lista de fato não fica vazia no estado final.
    expect(screen.getByText('Protetor Solar')).toBeInTheDocument();
  });
});
