import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AbaPosvenda } from '../posvenda/aba-posvenda';
import type { DetalheReclamacao } from '@/lib/posvenda';
import type { Devolucao } from '@/lib/devolucoes';

const executarMock = vi.fn();
const detalheMock = vi.fn();
const filaMock = vi.fn();
const travasMock = vi.fn();
const produtosMock = vi.fn();

vi.mock('@/lib/posvenda', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/posvenda')>();
  return {
    ...actual,
    executarAcaoPosvenda: (...a: unknown[]) => executarMock(...a),
    buscarDetalheReclamacao: (...a: unknown[]) => detalheMock(...a),
    buscarFilaPosvenda: (...a: unknown[]) => filaMock(...a),
    buscarTentativasAtivas: (...a: unknown[]) => travasMock(...a),
    buscarProdutosPedidos: (...a: unknown[]) => produtosMock(...a),
  };
});
vi.mock('@/hooks/useFotosProduto', () => ({ useFotosProduto: () => ({ data: undefined }) }));
vi.mock('@/hooks/useAnuncioCanonico', () => ({ useAnuncioCanonico: () => ({ data: undefined }) }));
vi.mock('@/hooks/useMensagens', () => ({ useResumoMensagens: () => ({ data: { naoLidas: { total: 0 } } }) }));
vi.mock('@/components/faturamento/aba-mensagens', () => ({ AbaMensagens: () => <div>MENSAGENS</div> }));
vi.mock('@/components/faturamento/aba-devolucoes', () => ({ AbaDevolucoes: () => <div>HIST</div> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const detalhe = (): DetalheReclamacao => ({
  claim_id: 555, return_id: 77, stage: 'claim', status: 'opened',
  estado: { titulo: 'X', descricao: null, problema: null, prazo: null, vez_de: 'vendedor' },
  comprador_quer: null, resolucoes: [], resolucao_final: null, afeta_reputacao: null, custo_devolucao: null,
  historico: [], acoes: ['return_review_ok'], revisoes: [{ order_id: 1, seller_status: 'pending' }], pedidos_devolucao: [1],
  motivos_falha_revisao: [], reembolso_parcial: null, incompleto: [],
});
const dev = (): Devolucao => ({
  id: 'd1', claim_id: 555, order_id: 1, stage: 'claim', status: 'opened', type: 'returns', reason_texto: 'Arrependimento',
  valor_em_jogo: null, return_status: 'delivered', return_status_money: 'refunded', acoes_pendentes: null, aberto_em: null, fechado_em: null,
  return_id: 77, revisao_pendente: true, vez_de: 'vendedor', prazo: '2099-01-01T00:00:00Z',
});
const PROD = new Map([[1, { itens: [{ id: 'i1', ml_item_id: 'MLB1', variation_id: null, titulo: 'Fita Cetim Bufalo', codigo: null, ean: null, quantity: 2, unit_price: 9.85 }] }]]);
const ATIVA = { operacao_id: 'op-1', claim_id: 555, return_id: 77, recurso: 'return:77', acao: 'revisar_ok', estado: 'desconhecido' };

function montar(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(<QueryClientProvider client={qc}><AbaPosvenda sub="devolucoes" onSub={() => {}} /></QueryClientProvider>);
  return qc;
}

beforeEach(() => {
  vi.clearAllMocks();
  produtosMock.mockResolvedValue(PROD);
  filaMock.mockResolvedValue([dev()]);
  detalheMock.mockResolvedValue(detalhe());
});

describe('3. releitura das travas falha com cache antigo', () => {
  it('cache [] + releitura com erro: ações ficam indisponíveis', async () => {
    travasMock.mockResolvedValueOnce([]);
    const qc = montar();
    expect(await screen.findByRole('button', { name: 'Revisar' })).toBeEnabled();
    travasMock.mockRejectedValue(new Error('rede'));
    await act(async () => { await qc.refetchQueries({ queryKey: ['posvenda', 'acoes'] }); });
    expect(await screen.findByText(/Não foi possível conferir as ações em andamento/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revisar' })).toBeDisabled();
  });
});

describe('4. resultado pendente atualiza as tentativas', () => {
  it('enviar -> desconhecido -> fechar: o card passa a mostrar "Conferir agora" e trava Revisar', async () => {
    const user = userEvent.setup();
    travasMock.mockResolvedValueOnce([]).mockResolvedValue([ATIVA]);
    executarMock.mockResolvedValue({ ok: true, estado: 'desconhecido', operacao_id: 'op-1', pendenteConfirmacao: true, sincronizacaoPendente: false, devolucao: null });
    montar();
    await user.click(await screen.findByRole('button', { name: 'Revisar' }));
    await user.click(await screen.findByRole('button', { name: 'Confirmar no ML' }));
    await screen.findByText(/Não sabemos se o ML recebeu/);
    const dlg = screen.getByRole('dialog');
    await user.click(within(dlg).getByRole('button', { name: 'Fechar', hidden: false }));
    expect(await screen.findByRole('button', { name: 'Conferir agora' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revisar' })).toBeDisabled();
  });
});

describe('6. produto carrega depois de abrir a revisão', () => {
  it('o diálogo mostra o produto quando a consulta resolve', async () => {
    const user = userEvent.setup();
    travasMock.mockResolvedValue([]);
    let resolve!: (v: typeof PROD) => void;
    produtosMock.mockReturnValue(new Promise<typeof PROD>((r) => { resolve = r; }));
    montar();
    await user.click(await screen.findByRole('button', { name: 'Revisar' }));
    const dlg = await screen.findByRole('dialog', { name: /Revisar devolução/ });
    expect(within(dlg).queryByText(/Fita Cetim Bufalo/)).not.toBeInTheDocument();
    await act(async () => { resolve(PROD); });
    expect(await within(dlg).findByText(/Fita Cetim Bufalo/)).toBeInTheDocument();
  });
});
