import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DialogEntrada } from '../dialog-entrada';
import type { VariacaoComSaldo } from '@/lib/produtos-saldo';

const fetchSkusEstoqueOrgMock = vi.fn(() => Promise.resolve([
  { codigo: '00000005', codigoPai: '00000004', nome: 'Protetor Solar', cor: 'incolor', estoque: 5 },
  { codigo: '00000006', codigoPai: '00000004', nome: 'Protetor Solar', cor: 'bege', estoque: 5 },
  { codigo: '00000010', codigoPai: '00000009', nome: 'Outro Produto', cor: 'única', estoque: 5 },
]));

function variacao(codigo: string, cor: string, estoque: number): VariacaoComSaldo {
  return {
    codigo, nome: 'Tecido Helanca', cor, gtin: null, estoque, custo: 32.84, preco: 76.9,
    pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null,
    imagemPath: null, mlPictureId: null, mlItemId: 'MLB1', kits: [],
  };
}

const fetchVariacoesProdutoMock = vi.fn(() => Promise.resolve([
  variacao('18760901', 'Vermelho', 0),
  variacao('24232511', 'Champagne', 0),
  variacao('26706071', 'Branco', 2996),
]));
interface ItemEnviado { codigo: string; quantidade: number; custo: number | null }
const registrarEntradaLoteMock = vi.fn(
  (_p: { itens: ItemEnviado[]; documento?: string | null; ref: string }) =>
    Promise.resolve({ resultados: [], pushOk: true }),
);

vi.mock('@/lib/produtos-saldo', async (orig) => ({
  ...(await orig<typeof import('@/lib/produtos-saldo')>()),
  fetchSkusEstoqueOrg: () => fetchSkusEstoqueOrgMock(),
  fetchVariacoesProduto: () => fetchVariacoesProdutoMock(),
  registrarEntrada: vi.fn(),
  registrarEntradaLote: (p: unknown) => registrarEntradaLoteMock(p as never),
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

  it('envia só as cores preenchidas, com o custo aplicado a todas elas', async () => {
    renderDialog({ codigoPaiInicial: '26705341' });
    await screen.findByText(/18760901 · Vermelho/);

    await userEvent.type(screen.getByLabelText(/Quantidade para 18760901/), '40');
    await userEvent.type(screen.getByLabelText(/Quantidade para 24232511/), '25');
    await userEvent.type(screen.getByLabelText('Custo unitário (opcional)'), '32,84');
    // A cor Branco fica em branco de propósito: em branco é "não mexi", nunca zero.

    await userEvent.click(screen.getByRole('button', { name: /Registrar entrada \(2\)/ }));

    await waitFor(() => expect(registrarEntradaLoteMock).toHaveBeenCalledTimes(1));
    expect(registrarEntradaLoteMock.mock.calls[0]![0].itens).toEqual([
      { codigo: '18760901', quantidade: 40, custo: 32.84 },
      { codigo: '24232511', quantidade: 25, custo: 32.84 },
    ]);
  });

  it('sem nenhuma quantidade preenchida, o botão fica desabilitado', async () => {
    renderDialog({ codigoPaiInicial: '26705341' });
    await screen.findByText(/18760901 · Vermelho/);
    expect(screen.getByRole('button', { name: /Registrar entrada/ })).toBeDisabled();
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
