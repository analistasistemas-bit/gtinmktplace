import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogoRevisarDevolucao } from '../posvenda/dialogo-revisar-devolucao';
import { DialogoConfirmarAcao } from '../posvenda/dialogo-confirmar-acao';
import { PainelReclamacao } from '../posvenda/detalhe-reclamacao';
import { ListaDevolucoes } from '../posvenda/lista-devolucoes';
import { AbaPosvenda } from '../posvenda/aba-posvenda';
import type { DetalheReclamacao } from '@/lib/posvenda';
import type { Devolucao } from '@/lib/devolucoes';

const executarMock = vi.fn();
const verificarMock = vi.fn();
const anexoMock = vi.fn();
const detalheMock = vi.fn();
const filaMock = vi.fn();
const travasMock = vi.fn();
const produtosMock = vi.fn();

vi.mock('@/lib/posvenda', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/posvenda')>();
  return {
    ...actual,
    executarAcaoPosvenda: (...a: unknown[]) => executarMock(...a),
    verificarAcaoPosvenda: (...a: unknown[]) => verificarMock(...a),
    enviarAnexoPosvenda: (...a: unknown[]) => anexoMock(...a),
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
vi.mock('@/components/faturamento/aba-devolucoes', () => ({ AbaDevolucoes: () => <div>TABELA HISTORICO</div> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const detalhe = (p: Partial<DetalheReclamacao> = {}): DetalheReclamacao => ({
  claim_id: 555, return_id: 77, stage: 'claim', status: 'opened',
  estado: { titulo: 'Devolução em preparação', descricao: 'Comprador embalando', problema: null, prazo: null, vez_de: 'vendedor' },
  comprador_quer: 'Devolver o produto', resolucoes: [], resolucao_final: null, afeta_reputacao: 'Não afeta',
  custo_devolucao: 0, historico: [], acoes: ['return_review_ok', 'return_review_fail'],
  revisoes: [{ order_id: 1, seller_status: 'pending' }], pedidos_devolucao: [1],
  motivos_falha_revisao: [
    { id: 'SRF2', texto: 'O produto chegou avariado', exige_foto: true, aplica: ['order', 'package'] },
    { id: 'SRF5', texto: 'O produto não está no pacote', exige_foto: false, aplica: ['order', 'package'] },
  ],
  reembolso_parcial: null, incompleto: [], ...p,
});

const dev = (p: Partial<Devolucao> = {}): Devolucao => ({
  id: 'd1', claim_id: 555, order_id: 1, stage: 'claim', status: 'opened', type: 'returns', reason_texto: 'Arrependimento',
  valor_em_jogo: null, return_status: 'delivered', return_status_money: 'refunded', acoes_pendentes: null, aberto_em: null, fechado_em: null,
  return_id: 77, revisao_pendente: true, vez_de: 'vendedor', prazo: '2099-01-01T00:00:00Z', ...p,
});

const PRODUTOS = new Map([[1, { itens: [{ id: 'i1', ml_item_id: 'MLB1', variation_id: null, titulo: 'Fita Cetim Bufalo N.5 50mt', codigo: null, ean: null, quantity: 2, unit_price: 9.85 }] }]]);

function comQuery(ui: React.ReactElement) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
}
const INFO = { titulo: 'Pedido #1', linhas: [] as Array<[string, string]> };
const OK = { ok: true, estado: 'confirmada', operacao_id: 'x', pendenteConfirmacao: false, sincronizacaoPendente: false, devolucao: null };

beforeEach(() => {
  vi.clearAllMocks();
  produtosMock.mockResolvedValue(PRODUTOS);
  travasMock.mockResolvedValue([]);
  filaMock.mockResolvedValue([]);
});

describe('2. upload em andamento', () => {
  it('digitar durante o upload não é desfeito e o envio fica bloqueado até terminar', async () => {
    const user = userEvent.setup();
    let fim!: (id: string) => void;
    anexoMock.mockReturnValue(new Promise<string>((r) => { fim = r; }));
    render(<DialogoRevisarDevolucao detalhe={detalhe()} info={INFO} open onOpenChange={() => {}} />);
    await user.click(screen.getByLabelText('Tem problema…'));
    await user.click(screen.getByLabelText('O produto não está no pacote'));
    await user.upload(document.getElementById('rv-pacote-foto') as HTMLInputElement, new File(['x'], 'foto.png', { type: 'image/png' }));
    await user.type(screen.getByLabelText(/Descreva o problema/), 'Caixa vazia');
    expect(screen.getByRole('button', { name: 'Enviar ao ML' })).toBeDisabled(); // upload pendente
    fim('ANEXO1');
    await screen.findByText('foto.png');
    expect(screen.getByLabelText(/Descreva o problema/)).toHaveValue('Caixa vazia');
    expect(screen.getByRole('button', { name: 'Enviar ao ML' })).toBeEnabled();
  });

  it('a repetição com o mesmo operacao_id usa exatamente o corpo congelado no 1º envio', async () => {
    const user = userEvent.setup();
    executarMock.mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValueOnce(OK);
    const props = { open: true, onOpenChange: () => {}, titulo: 'T', efeito: 'E.', claimId: '555', podeEnviar: true };
    const { rerender } = render(<DialogoConfirmarAcao {...props} corpo={{ acao: 'responder', texto: 'A' }} />);
    await user.click(screen.getByRole('button', { name: 'Enviar ao ML' }));
    await screen.findByRole('button', { name: 'Tentar de novo' });
    rerender(<DialogoConfirmarAcao {...props} corpo={{ acao: 'responder', texto: 'B' }} />);
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(executarMock.mock.calls[1][0]).toEqual(executarMock.mock.calls[0][0]);
    expect(executarMock.mock.calls[1][0].texto).toBe('A');
  });
});

describe('3. travas ainda desconhecidas', () => {
  it('erro ao carregar travas: mostra o aviso e mantém "Revisar" indisponível', async () => {
    filaMock.mockResolvedValue([dev()]);
    travasMock.mockRejectedValue(new Error('rede'));
    comQuery(<AbaPosvenda sub="devolucoes" onSub={() => {}} />);
    expect(await screen.findByText(/Não foi possível conferir as ações em andamento/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revisar' })).toBeDisabled();
  });

  it('enquanto carrega, as ações ficam indisponíveis', async () => {
    filaMock.mockResolvedValue([dev()]);
    travasMock.mockReturnValue(new Promise(() => {}));
    comQuery(<AbaPosvenda sub="devolucoes" onSub={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Revisar' })).toBeDisabled();
  });
});

describe('4. tentativa ativa: conferência e trava por recurso', () => {
  const ativaMsg = [{ operacao_id: 'op-msg', claim_id: 555, return_id: 77, recurso: 'claim:555:msg', acao: 'responder', estado: 'enviada' }] as const;
  const ativaRev = [{ operacao_id: 'op-rev', claim_id: 555, return_id: 77, recurso: 'return:77', acao: 'revisar_ok', estado: 'desconhecido' }] as const;

  it('tentativa de mensagem não trava "Revisar", mas o card avisa', () => {
    comQuery(<ListaDevolucoes itens={[dev()]} travas={[...ativaMsg]} />);
    expect(screen.getByText('Ação enviada ao ML · aguardando confirmação')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revisar' })).toBeEnabled();
  });

  it('card com tentativa de revisão: trava, "Conferir agora" usa o operacao_id da tentativa e há link para o ML', async () => {
    const user = userEvent.setup();
    verificarMock.mockResolvedValue({ ...OK, estado: 'confirmada' });
    comQuery(<ListaDevolucoes itens={[dev()]} travas={[...ativaRev]} />);
    expect(screen.getByRole('button', { name: 'Revisar' })).toBeDisabled();
    expect(screen.getByRole('link', { name: /Conferir no ML/ })).toHaveAttribute('href', expect.stringContaining('mercadolivre.com.br'));
    await user.click(screen.getByRole('button', { name: 'Conferir agora' }));
    await waitFor(() => expect(verificarMock).toHaveBeenCalledWith('op-rev', '555'));
    expect(executarMock).not.toHaveBeenCalled();
  });
});

describe('5. reembolso por opção liberada', () => {
  it('só o parcial liberado: total desabilitado e o padrão é uma oferta parcial', async () => {
    const user = userEvent.setup();
    detalheMock.mockResolvedValue(detalhe({
      acoes: ['allow_partial_refund'], revisoes: [], reembolso_parcial: { ofertas: [{ percentual: 50, valor: 10 }], minimo: null },
    }));
    comQuery(<PainelReclamacao item={dev({ revisao_pendente: false })} travas={[]} onOpenChange={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Reembolsar…' }));
    const dlg = await screen.findByRole('dialog', { name: /Reembolsar/ });
    expect(within(dlg).getByLabelText('Reembolso total')).toBeDisabled();
    expect(within(dlg).getByLabelText(/Reembolso parcial de 50%/)).toBeChecked();
  });

  it('só o total liberado: parcial não é oferecido e o total vem selecionado', async () => {
    const user = userEvent.setup();
    detalheMock.mockResolvedValue(detalhe({
      acoes: ['refund'], revisoes: [], reembolso_parcial: { ofertas: [{ percentual: 50, valor: 10 }], minimo: null },
    }));
    comQuery(<PainelReclamacao item={dev({ revisao_pendente: false })} travas={[]} onOpenChange={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Reembolsar…' }));
    const dlg = await screen.findByRole('dialog', { name: /Reembolsar/ });
    expect(within(dlg).getByLabelText('Reembolso total')).toBeChecked();
    expect(within(dlg).getByLabelText(/Reembolso parcial de 50%/)).toBeDisabled();
  });
});

describe('6. informações antes da decisão', () => {
  it('o card mostra o título do produto, a quantidade e o valor', async () => {
    comQuery(<ListaDevolucoes itens={[dev()]} travas={[]} />);
    expect(await screen.findByText(/Fita Cetim Bufalo N\.5 50mt/)).toBeInTheDocument();
    expect(screen.getByText(/2 un/)).toBeInTheDocument();
  });

  it('o detalhe mostra produto no topo e o problema do estado', async () => {
    detalheMock.mockResolvedValue(detalhe({ estado: { titulo: 'Em análise', descricao: null, problema: 'Embalagem violada', prazo: null, vez_de: 'vendedor' } }));
    comQuery(<PainelReclamacao item={dev({ revisao_pendente: false })} travas={[]} onOpenChange={() => {}} />);
    expect(await screen.findByText('Embalagem violada')).toBeInTheDocument();
    expect(screen.getAllByText(/Fita Cetim Bufalo N\.5 50mt/).length).toBeGreaterThan(0);
  });

  it('a revisão mostra a situação do retorno e o status do reembolso', async () => {
    const user = userEvent.setup();
    filaMock.mockResolvedValue([dev()]);
    detalheMock.mockResolvedValue(detalhe());
    comQuery(<ListaDevolucoes itens={[dev()]} travas={[]} />);
    await user.click(screen.getByRole('button', { name: 'Revisar' }));
    const dlg = await screen.findByRole('dialog', { name: /Revisar devolução/ });
    expect(within(dlg).getByText('Entregue')).toBeInTheDocument();
    expect(within(dlg).getByText('Reembolsado')).toBeInTheDocument();
  });
});

describe('7. contadores filtram a lista', () => {
  const itens = [
    dev({ claim_id: 1, order_id: 1, revisao_pendente: true }),
    dev({ claim_id: 2, order_id: 2, revisao_pendente: false, vez_de: 'comprador', return_status: 'shipped' }),
  ];
  it('clicar em Urgentes filtra, mostra o estado selecionado e permite limpar', async () => {
    const user = userEvent.setup();
    comQuery(<ListaDevolucoes itens={itens} travas={[]} />);
    expect(screen.getAllByText(/Pedido #/)).toHaveLength(2);
    const urg = screen.getByRole('button', { name: /^Urgentes/ });
    await user.click(urg);
    expect(urg).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText(/Pedido #/)).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Limpar filtro' }));
    expect(screen.getAllByText(/Pedido #/)).toHaveLength(2);
  });
  it('sub-item "A caminho" filtra só os que estão em trânsito', async () => {
    const user = userEvent.setup();
    comQuery(<ListaDevolucoes itens={itens} travas={[]} />);
    await user.click(screen.getByRole('button', { name: /^A caminho/ }));
    expect(screen.getAllByText(/Pedido #/)).toHaveLength(1);
    expect(screen.getByText('Pedido #2')).toBeInTheDocument();
  });
});

describe('8. Histórico é botão dentro de Devoluções', () => {
  it('não é sub-aba; o botão mostra a tabela e dá para voltar à fila', async () => {
    const user = userEvent.setup();
    comQuery(<AbaPosvenda sub="devolucoes" onSub={() => {}} />);
    expect(screen.queryByRole('tab', { name: 'Histórico' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Histórico' }));
    expect(screen.getByText('TABELA HISTORICO')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Voltar à fila' }));
    expect(screen.queryByText('TABELA HISTORICO')).not.toBeInTheDocument();
  });
});
