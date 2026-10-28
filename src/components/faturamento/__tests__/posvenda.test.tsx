import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogoRevisarDevolucao } from '../posvenda/dialogo-revisar-devolucao';
import { ListaDevolucoes } from '../posvenda/lista-devolucoes';
import { PainelReclamacao } from '../posvenda/detalhe-reclamacao';
import type { DetalheReclamacao } from '@/lib/posvenda';
import type { Devolucao } from '@/lib/devolucoes';

const executarMock = vi.fn();
const verificarMock = vi.fn();
const anexoMock = vi.fn();
const detalheMock = vi.fn();

vi.mock('@/lib/posvenda', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/posvenda')>();
  return {
    ...actual,
    executarAcaoPosvenda: (...a: unknown[]) => executarMock(...a),
    verificarAcaoPosvenda: (...a: unknown[]) => verificarMock(...a),
    enviarAnexoPosvenda: (...a: unknown[]) => anexoMock(...a),
    buscarDetalheReclamacao: (...a: unknown[]) => detalheMock(...a),
    buscarProdutosPedidos: async () => new Map(),
  };
});
vi.mock('@/hooks/useFotosProduto', () => ({ useFotosProduto: () => ({ data: undefined }) }));
vi.mock('@/hooks/useAnuncioCanonico', () => ({ useAnuncioCanonico: () => ({ data: undefined }) }));
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

const INFO = { titulo: 'Pedido #1', linhas: [['Motivo', 'Arrependimento']] as Array<[string, string]> };

function abrirRevisao(d = detalhe()) {
  return render(<DialogoRevisarDevolucao detalhe={d} info={INFO} open onOpenChange={() => {}} />);
}

async function escolherProblema(user: ReturnType<typeof userEvent.setup>, motivo: string, texto = 'Veio quebrado') {
  await user.click(screen.getByLabelText('Tem problema…'));
  await user.click(screen.getByLabelText(motivo));
  await user.type(screen.getByLabelText(/Descreva o problema/), texto);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DialogoRevisarDevolucao', () => {
  it('motivo que exige foto (SRF2): sem foto o envio fica desabilitado', async () => {
    const user = userEvent.setup();
    abrirRevisao();
    await escolherProblema(user, 'O produto chegou avariado');
    expect(screen.getByRole('button', { name: 'Enviar ao ML' })).toBeDisabled();
  });

  it('motivo sem foto obrigatória (SRF5): com mensagem habilita; sem mensagem não', async () => {
    const user = userEvent.setup();
    abrirRevisao();
    await user.click(screen.getByLabelText('Tem problema…'));
    await user.click(screen.getByLabelText('O produto não está no pacote'));
    expect(screen.getByRole('button', { name: 'Enviar ao ML' })).toBeDisabled(); // mensagem é obrigatória
    await user.type(screen.getByLabelText(/Descreva o problema/), 'Caixa vazia');
    expect(screen.getByRole('button', { name: 'Enviar ao ML' })).toBeEnabled();
  });

  it('carrinho: pedido a pedido pede motivo para cada pedido', async () => {
    const user = userEvent.setup();
    abrirRevisao(detalhe({ pedidos_devolucao: [1, 2], revisoes: [{ order_id: 1, seller_status: 'pending' }, { order_id: 2, seller_status: 'pending' }] }));
    await user.click(screen.getByLabelText('Tem problema…'));
    await user.click(screen.getByLabelText('Revisar pedido a pedido'));
    expect(screen.getAllByText('Pedido #1')).toHaveLength(2); // cabeçalho do diálogo + bloco do pedido
    expect(screen.getAllByText('Pedido #2')).toHaveLength(1);
    expect(screen.getAllByLabelText('O produto chegou avariado')).toHaveLength(2); // motivo próprio por pedido
  });

  it('duplo clique envia uma vez só, com operacao_id', async () => {
    const user = userEvent.setup();
    executarMock.mockReturnValue(new Promise(() => {})); // nunca resolve
    abrirRevisao();
    await user.dblClick(screen.getByRole('button', { name: 'Confirmar no ML' }));
    expect(executarMock).toHaveBeenCalledTimes(1);
    expect(executarMock.mock.calls[0][0]).toMatchObject({ claim_id: '555', acao: 'revisar_ok' });
    expect(typeof executarMock.mock.calls[0][0].operacao_id).toBe('string');
  });

  it('repetir após erro de rede reusa o mesmo operacao_id', async () => {
    const user = userEvent.setup();
    executarMock.mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValueOnce({
      ok: true, estado: 'confirmada', operacao_id: 'x', pendenteConfirmacao: false, sincronizacaoPendente: false, devolucao: null,
    });
    abrirRevisao();
    await user.click(screen.getByRole('button', { name: 'Confirmar no ML' }));
    await user.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    await screen.findByText(/Confirmado pelo Mercado Livre/);
    expect(executarMock).toHaveBeenCalledTimes(2);
    expect(executarMock.mock.calls[1][0].operacao_id).toBe(executarMock.mock.calls[0][0].operacao_id);
  });

  it('desconhecido não oferece enviar de novo; só "Conferir agora" (verificar, sem reenviar)', async () => {
    const user = userEvent.setup();
    executarMock.mockResolvedValue({
      ok: true, estado: 'desconhecido', operacao_id: 'x', pendenteConfirmacao: true, sincronizacaoPendente: false, devolucao: null,
    });
    verificarMock.mockResolvedValue({
      ok: true, estado: 'confirmada', operacao_id: 'x', pendenteConfirmacao: false, sincronizacaoPendente: false, devolucao: null,
    });
    abrirRevisao();
    await user.click(screen.getByRole('button', { name: 'Confirmar no ML' }));
    expect(await screen.findByText(/Não sabemos se o ML recebeu\. Não vamos reenviar; estamos conferindo\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirmar no ML|Enviar ao ML|Tentar de novo/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Conferir agora' }));
    await waitFor(() => expect(verificarMock).toHaveBeenCalledTimes(1));
    expect(verificarMock.mock.calls[0][0]).toBe(executarMock.mock.calls[0][0].operacao_id);
    expect(executarMock).toHaveBeenCalledTimes(1);
  });
});

const dev = (p: Partial<Devolucao> = {}): Devolucao => ({
  id: 'd1', claim_id: 555, order_id: 1, stage: 'claim', status: 'opened', type: 'returns', reason_texto: 'Arrependimento',
  valor_em_jogo: null, return_status: null, return_status_money: null, acoes_pendentes: null, aberto_em: null, fechado_em: null,
  return_id: 77, revisao_pendente: true, vez_de: 'vendedor', prazo: '2099-01-01T00:00:00Z', ...p,
});

function comQuery(ui: React.ReactElement) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
}

describe('tentativa ativa trava o recurso', () => {
  it('card com tentativa em aberto mostra o aviso e desabilita "Revisar"', () => {
    comQuery(<ListaDevolucoes itens={[dev()]} travas={[{ operacao_id: 'op1', return_id: 77, acao: 'revisar_ok', recurso: 'return:77', claim_id: 555, estado: 'enviada' }]} />);
    expect(screen.getByText('Ação enviada ao ML · aguardando confirmação')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revisar' })).toBeDisabled();
  });

  it('sem tentativa, "Revisar" está habilitado', () => {
    comQuery(<ListaDevolucoes itens={[dev()]} travas={[]} />);
    expect(screen.getByRole('button', { name: 'Revisar' })).toBeEnabled();
  });

  it('detalhe: botões seguem available_actions e travam o recurso com tentativa ativa', async () => {
    detalheMock.mockResolvedValue(detalhe({ acoes: ['refund', 'open_dispute', 'send_message_to_complainant'], revisoes: [] }));
    comQuery(
      <PainelReclamacao item={dev({ revisao_pendente: false })} onOpenChange={() => {}}
        travas={[{ operacao_id: 'op2', return_id: 77, acao: 'reembolsar', recurso: 'claim:555:resolucao', claim_id: 555, estado: 'desconhecido' }]} />,
    );
    await screen.findByText('Devolução em preparação');
    // reembolso e disputa dividem o recurso "resolução": travados; autorizar não é liberado pelo ML
    expect(screen.getByRole('button', { name: 'Reembolsar…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pedir mediação do ML' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Autorizar devolução' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Revisar devolução' })).toBeDisabled();
    // mensagem é outro recurso: segue liberado assim que houver texto
    await userEvent.setup().type(screen.getByLabelText('Responder'), 'Olá');
    expect(screen.getByRole('button', { name: 'Responder' })).toBeEnabled();
  });
});
