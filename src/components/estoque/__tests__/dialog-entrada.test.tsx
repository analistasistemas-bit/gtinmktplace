import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DialogEntrada } from '../dialog-entrada';
import type { VariacaoComSaldo } from '@/lib/produtos-saldo';
import type { PedidoDTO } from '../../../../supabase/functions/_shared/reposicao/tipos';
import { escolherNoSelect } from '@/test/select';

const fetchSkusEstoqueOrgMock = vi.fn(() => Promise.resolve([
  { codigo: '00000005', codigoPai: '00000004', nome: 'Protetor Solar', cor: 'incolor', estoque: 5 },
  { codigo: '00000006', codigoPai: '00000004', nome: 'Protetor Solar', cor: 'bege', estoque: 5 },
  { codigo: '00000010', codigoPai: '00000009', nome: 'Outro Produto', cor: 'única', estoque: 5 },
]));

function variacao(codigo: string, cor: string | null, estoque: number): VariacaoComSaldo {
  return {
    codigo, nome: 'Tecido Helanca', cor, gtin: null, estoque, custo: 32.84, preco: 76.9,
    pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null,
    imagemPath: null, mlPictureId: null, mlItemId: 'MLB1', kits: [], tamanho: null,
  };
}

// Já em ordem alfabética de cor: é assim que `fetchVariacoesProduto` entrega (a ordenação
// é dela, testada em lib/__tests__/produtos-saldo.test.ts). O diálogo só preserva a ordem.
const fetchVariacoesProdutoMock = vi.fn(() => Promise.resolve([
  variacao('26706071', 'Branco', 2996),
  variacao('24232511', 'Champagne', 0),
  variacao('18760901', 'Vermelho', 0),
]));
interface ItemEnviado { codigo: string; quantidade: number; custo: number | null }
const registrarEntradaLoteMock = vi.fn(
  (_p: { itens: ItemEnviado[]; documento?: string | null; ref: string }) =>
    Promise.resolve({ resultados: [], pushOk: true }),
);

const registrarEntradaMock = vi.fn((_p: Record<string, unknown>) =>
  Promise.resolve({ estoque: 9, duplicada: false, pushOk: true }));

vi.mock('@/lib/produtos-saldo', async (orig) => ({
  ...(await orig<typeof import('@/lib/produtos-saldo')>()),
  fetchSkusEstoqueOrg: () => fetchSkusEstoqueOrgMock(),
  fetchVariacoesProduto: () => fetchVariacoesProdutoMock(),
  registrarEntrada: (p: Record<string, unknown>) => registrarEntradaMock(p),
  registrarEntradaLote: (p: unknown) => registrarEntradaLoteMock(p as never),
}));

// ADR-0207 §16: "De qual pedido?" só com o módulo `reposicao`.
let modulos: string[] | undefined = ['estoque'];
vi.mock('@/hooks/useModulosHabilitados', () => ({ useModulosHabilitados: () => ({ data: modulos }) }));
function pedidoDe(id: string, nome: string, codigos: string[], recebida = 0): PedidoDTO {
  return {
    id, fornecedor: { id: `f-${id}`, nome, cnpj: null }, status: 'enviado', previstoPara: null, atrasado: false,
    salvoPor: null, salvoEm: null, aprovadoPor: null, enviadoEm: null, alteradoPor: null, alteradoEm: null,
    itens: codigos.map((codigo) => ({ codigo, codigoPai: 'P', quantidade: 10, sugerida: 10, recebida, encerrado: false, codigoFornecedor: null })),
  };
}
let pedidos: PedidoDTO[] = [];
const useReposicaoMock = vi.fn();
const encerrarSaldoMock = vi.fn(() => Promise.resolve({}));
const refetchMock = vi.fn((): Promise<{ data: { pedidos: PedidoDTO[] }; isError?: boolean; error?: Error }> =>
  Promise.resolve({ data: { pedidos } }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/hooks/useReposicao', () => ({
  useReposicao: (o: { enabled?: boolean }) => {
    useReposicaoMock(o);
    return { data: o.enabled ? { pedidos } : undefined, refetch: refetchMock, encerrarSaldo: encerrarSaldoMock, pendente: false };
  },
}));

function renderDialog(props: Partial<Parameters<typeof DialogEntrada>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DialogEntrada aberto onFechar={() => {}} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  modulos = ['estoque'];
  pedidos = [];
  useReposicaoMock.mockClear();
  encerrarSaldoMock.mockClear();
  refetchMock.mockClear();
  registrarEntradaMock.mockClear();
  fetchSkusEstoqueOrgMock.mockClear();
  fetchVariacoesProdutoMock.mockClear();
  registrarEntradaLoteMock.mockClear();
});

describe('DialogEntrada — modo lista (aberto pelo card do produto)', () => {
  // Relato do Diego (03/09/2026): o diálogo pedia um SKU e o picker vinha do
  // `skus_estoque_org`, truncado em ~1000 linhas pelo PostgREST — com 8.491 SKUs na org, o
  // produto não aparecia e a tela dizia "Nenhum SKU encontrado". O modo lista não consulta essa
  // lista: usa a RPC por produto.
  it('lista as cores do produto sem tocar na lista de SKUs da org', async () => {
    renderDialog({ codigoPaiInicial: '26705341' });
    expect(await screen.findByText(/18760901 · Vermelho/)).toBeInTheDocument();
    expect(screen.getByText(/24232511 · Champagne/)).toBeInTheDocument();
    expect(screen.getByText(/26706071 · Branco/)).toBeInTheDocument();
    expect(fetchSkusEstoqueOrgMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Nenhum SKU encontrado.')).toBeNull();
  });

  // O diálogo não reordena: exibe na ordem em que `fetchVariacoesProduto` entrega.
  it('preserva a ordem da fonte (alfabética por cor), sem reordenar por código', async () => {
    renderDialog({ codigoPaiInicial: '26705341' });
    await screen.findByText(/18760901 · Vermelho/);
    const rotulos = screen.getAllByLabelText(/^Quantidade para /)
      .map((el) => el.getAttribute('aria-label'));
    expect(rotulos).toEqual([
      'Quantidade para 26706071 · Branco',
      'Quantidade para 24232511 · Champagne',
      'Quantidade para 18760901 · Vermelho',
    ]);
  });

  it('envia só as cores preenchidas, com o custo aplicado a todas elas', async () => {
    renderDialog({ codigoPaiInicial: '26705341' });
    await screen.findByText(/18760901 · Vermelho/);

    await userEvent.type(screen.getByLabelText(/Quantidade para 18760901/), '40');
    await userEvent.type(screen.getByLabelText(/Quantidade para 24232511/), '25');
    await userEvent.type(screen.getByLabelText('Custo unitário (opcional)'), '32,84');
    // A cor Branco fica em branco de propósito: em branco é "não mexi", nunca zero.

    await userEvent.click(screen.getByRole('button', { name: /Registrar entrada \(2\)/ }));

    await waitFor(() => expect(registrarEntradaLoteMock).toHaveBeenCalledTimes(1));
    // Ordem do payload segue a da tela (alfabética por cor); a edge trata item a item.
    expect(registrarEntradaLoteMock.mock.calls[0]![0].itens).toEqual([
      { codigo: '24232511', quantidade: 25, custo: 32.84 },
      { codigo: '18760901', quantidade: 40, custo: 32.84 },
    ]);
  });

  it('sem nenhuma quantidade preenchida, o botão fica desabilitado', async () => {
    renderDialog({ codigoPaiInicial: '26705341' });
    await screen.findByText(/18760901 · Vermelho/);
    expect(screen.getByRole('button', { name: /Registrar entrada/ })).toBeDisabled();
  });

  // ADR-0166 (Task 3): cor com tamanho ganha o sufixo no rótulo da lista.
  it('cor com tamanho aparece como "<codigo> · Preto · M"', async () => {
    fetchVariacoesProdutoMock.mockResolvedValueOnce([
      { ...variacao('09200001', 'Preto', 5), tamanho: 'M' },
    ]);
    renderDialog({ codigoPaiInicial: '26705341' });
    expect(await screen.findByText('09200001 · Preto · M')).toBeInTheDocument();
  });
});

describe('DialogEntrada — modo picker (botão do topo da página)', () => {
  it('sem produto, busca na lista de SKUs da org', async () => {
    renderDialog();
    expect(await screen.findByText(/00000005/)).toBeInTheDocument();
    expect(screen.getByText(/00000010/)).toBeInTheDocument();
    expect(fetchVariacoesProdutoMock).not.toHaveBeenCalled();
  });
});

describe('DialogEntrada — De qual pedido? (ADR-0207 §16)', () => {
  it('org sem o módulo reposicao: nenhum campo novo e nada é buscado', async () => {
    pedidos = [pedidoDe('p1', 'Fornecedor A', ['00000005'])];
    renderDialog();
    await userEvent.click(await screen.findByText(/00000005/));
    expect(screen.queryByRole('combobox', { name: 'De qual pedido?' })).toBeNull();
    expect(useReposicaoMock).toHaveBeenCalled();
    expect(useReposicaoMock.mock.calls.every(([o]) => o.enabled === false)).toBe(true);
  });

  it('manual começa em "Nenhum" e, sem escolher, o envio é o de sempre (sem pedidoCompraId)', async () => {
    modulos = ['estoque', 'reposicao'];
    pedidos = [pedidoDe('p1', 'Fornecedor A', ['00000005'])];
    renderDialog();
    await userEvent.click(await screen.findByText(/00000005/));
    expect(screen.getByRole('combobox', { name: 'De qual pedido?' })).toHaveTextContent('Nenhum');
    await userEvent.type(screen.getByLabelText('Quantidade'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar entrada' }));
    await waitFor(() => expect(registrarEntradaMock).toHaveBeenCalledTimes(1));
    expect('pedidoCompraId' in registrarEntradaMock.mock.calls[0]![0]).toBe(false);
    expect(refetchMock).not.toHaveBeenCalled();
  });

  it('pedido escolhido vai na entrada; sobrando saldo, pergunta e "Não" encerra os itens listados', async () => {
    modulos = ['estoque', 'reposicao'];
    pedidos = [pedidoDe('p1', 'Fornecedor A', ['00000005', '00000006']), pedidoDe('p2', 'OUTRO', ['00000010'])];
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByText(/00000005/));
    await escolherNoSelect(user, 'De qual pedido?', 'Fornecedor A · faltam 20 de 20');
    await user.type(screen.getByLabelText('Quantidade'), '3');
    // Depois da entrada o servidor devolve o pedido com 3 recebidas no 1º item.
    pedidos = [{ ...pedidos[0]!, status: 'parcial', itens: [{ ...pedidos[0]!.itens[0]!, recebida: 3 }, pedidos[0]!.itens[1]!] }];
    await user.click(screen.getByRole('button', { name: 'Registrar entrada' }));
    await waitFor(() => expect(registrarEntradaMock).toHaveBeenCalledTimes(1));
    expect(registrarEntradaMock.mock.calls[0]![0].pedidoCompraId).toBe('p1');
    expect(await screen.findByText('Chegaram 3 de 20 do pedido Fornecedor A. O restante ainda vem?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Não' }));
    await user.click(screen.getByRole('button', { name: 'Encerrar saldo' }));
    await waitFor(() => expect(encerrarSaldoMock).toHaveBeenCalledWith({ pedidoId: 'p1', codigos: ['00000005', '00000006'] }));
  });

  it('modo lista: o pedido vai só nas cores que estão nele', async () => {
    modulos = ['estoque', 'reposicao'];
    pedidos = [pedidoDe('p1', 'Fornecedor A', ['18760901'])];
    const user = userEvent.setup();
    renderDialog({ codigoPaiInicial: '26705341' });
    await screen.findByText(/18760901 · Vermelho/);
    await escolherNoSelect(user, 'De qual pedido?', 'Fornecedor A · faltam 10 de 10');
    await user.type(screen.getByLabelText(/Quantidade para 18760901/), '4');
    await user.type(screen.getByLabelText(/Quantidade para 24232511/), '2');
    await user.click(screen.getByRole('button', { name: /Registrar entrada \(2\)/ }));
    await waitFor(() => expect(registrarEntradaLoteMock).toHaveBeenCalledTimes(1));
    expect(registrarEntradaLoteMock.mock.calls[0]![0].itens).toEqual([
      { codigo: '24232511', quantidade: 2, custo: null },
      { codigo: '18760901', quantidade: 4, custo: null, pedidoCompraId: 'p1' },
    ]);
  });
});

describe('DialogEntrada — conferência do pedido depois da entrada (rodada 1)', () => {
  it('refetch com erro: aviso em pt-BR e NENHUMA pergunta com números antigos', async () => {
    modulos = ['estoque', 'reposicao'];
    pedidos = [pedidoDe('p1', 'Fornecedor A', ['00000005'])];
    // react-query devolve o cache antigo junto do erro.
    refetchMock.mockResolvedValueOnce({ data: { pedidos }, isError: true, error: new Error('rede') });
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByText(/00000005/));
    await escolherNoSelect(user, 'De qual pedido?', 'Fornecedor A · faltam 10 de 10');
    await user.type(screen.getByLabelText('Quantidade'), '3');
    await user.click(screen.getByRole('button', { name: 'Registrar entrada' }));
    await waitFor(() => expect(toastMock.warning).toHaveBeenCalledWith(
      'A entrada foi registrada, mas não foi possível conferir o saldo do pedido agora. Veja em Reposição › Pedidos.'));
    expect(screen.queryByText(/O restante ainda vem\?/)).toBeNull();
  });
});
