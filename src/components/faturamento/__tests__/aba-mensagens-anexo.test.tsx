import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { AbaMensagens } from '../aba-mensagens';

const responderMock = vi.fn();
const verificarMock = vi.fn();
const liberarMock = vi.fn();
const enviarAnexoMock = vi.fn();
const baixarMock = vi.fn();
const buscarPendenteMock = vi.fn();

vi.mock('@/lib/mensagens', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mensagens')>()),
  responderMensagem: (...a: unknown[]) => responderMock(...a),
  verificarEnvio: (...a: unknown[]) => verificarMock(...a),
  liberarEnvio: (...a: unknown[]) => liberarMock(...a),
  enviarAnexoMensagem: (...a: unknown[]) => enviarAnexoMock(...a),
  baixarAnexoMensagem: (...a: unknown[]) => baixarMock(...a),
  buscarEnvioPendente: (...a: unknown[]) => buscarPendenteMock(...a),
  marcarMensagensLidasML: async () => ({ ok: true }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const OP = '11111111-1111-4111-8111-111111111111';
const PENDENTE = { operacao_id: OP, estado: 'enviada' };

const anexoImg = { filename: 'f1', original_filename: 'foto-defeito.png', type: 'image/png', size: 2048, potential_security_threat: false };

function conversa(extra: Record<string, unknown> = {}, texto = 'Olá', anexos: unknown[] = []) {
  return {
    pack_id: 'pack-2', order_id: 'order-2', item_titulo: 'Produto 2', item_id: 'MLB2',
    comprador_nome: null, comprador_nick: 'NICK_2', order_status: 'paid', aguardando: true,
    ultima: '2026-07-10T10:00:00Z', shipping_status: 'handling', idsNaoLidosML: [] as string[], reclamacaoAberta: false,
    envioPendente: null,
    mensagens: [{
      id: 'message-2', pack_id: 'pack-2', order_id: 'order-2', message_id: 'm2', direcao: 'recebida', texto,
      item_titulo: 'Produto 2', item_id: 'MLB2', comprador_nome: null, comprador_nick: 'NICK_2',
      order_status: 'paid', data_ml: '2026-07-10T10:00:00Z', lida: false, lida_ml_em: '2026-07-10T11:00:00Z', anexos,
    }],
    ...extra,
  };
}

let CONVERSAS: ReturnType<typeof conversa>[] = [];
vi.mock('@/hooks/useMensagens', () => ({
  useListaMensagens: () => ({ data: CONVERSAS, isFetching: false }),
  useResumoMensagens: () => ({ data: undefined, isError: false }),
}));

const card = () => screen.getByText('Produto 2').closest('div.rounded-lg') as HTMLElement;
const caixa = () => within(card()).getByRole('textbox', { name: 'Mensagem ao comprador' }) as HTMLTextAreaElement;
const enviar = () => within(card()).getByRole('button', { name: 'Responder' });
const arquivoInput = () => card().querySelector('input[type="file"]') as HTMLInputElement;
const arquivo = (nome = 'foto.png', tipo = 'image/png') => new File(['x'], nome, { type: tipo });

function renderAba() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AbaMensagens /></QueryClientProvider>);
}
async function abrir() {
  await userEvent.click(within(card()).getByRole('button', { name: 'Conferir mensagem' }));
}
const anexar = (f: File) => fireEvent.change(arquivoInput(), { target: { files: [f] } });
const resp = (estado: string, pendenteConfirmacao = false) => ({ ok: true, estado, operacao_id: OP, pendenteConfirmacao });
const erroEdge = (extra: Record<string, unknown>) => Object.assign(new Error('falhou'), extra);

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:teste');
  URL.revokeObjectURL = vi.fn();
});
beforeEach(() => {
  vi.clearAllMocks();
  CONVERSAS = [conversa()];
  buscarPendenteMock.mockResolvedValue(null);
  baixarMock.mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
});

describe('envio de resposta', () => {
  it('pendente_confirmacao_nao_mostra_sucesso_e_mantem_texto', async () => {
    responderMock.mockResolvedValueOnce(resp('enviada', true));
    liberarMock.mockResolvedValueOnce(resp('inconclusiva'));
    renderAba(); await abrir();
    await userEvent.type(caixa(), 'Oi tudo bem');
    await userEvent.click(enviar());
    expect(toast.success).not.toHaveBeenCalled();
    expect(await within(card()).findByRole('button', { name: 'Conferir no Mercado Livre' })).toBeInTheDocument();
    expect(within(card()).getByRole('log')).toBeInTheDocument(); // card continua aberto
    await userEvent.click(within(card()).getByRole('button', { name: 'Já conferi, liberar envio' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Liberar envio' }));
    await waitFor(() => expect(caixa().value).toBe('Oi tudo bem'));
  });

  it('resposta_409_em_andamento_aplica_pendente_na_hora', async () => {
    responderMock.mockRejectedValueOnce(erroEdge({ codigo: 'em_andamento', pendente: PENDENTE }));
    renderAba(); await abrir();
    await userEvent.type(caixa(), 'Oi');
    await userEvent.click(enviar());
    expect(await within(card()).findByRole('button', { name: 'Conferir no Mercado Livre' })).toBeInTheDocument();
    expect(within(card()).queryByRole('textbox')).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('abrir_conversa_consulta_envio_pendente', async () => {
    buscarPendenteMock.mockResolvedValue({ operacao_id: OP, estado: 'desconhecido' });
    renderAba(); await abrir();
    expect(buscarPendenteMock).toHaveBeenCalledWith('pack-2');
    expect(await within(card()).findByRole('button', { name: 'Conferir no Mercado Livre' })).toBeInTheDocument();
  });

  it('envio_pendente_bloqueia_campo_e_mostra_conferir', async () => {
    CONVERSAS = [conversa({ envioPendente: PENDENTE })];
    buscarPendenteMock.mockResolvedValue(PENDENTE);
    renderAba(); await abrir();
    expect(within(card()).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(card()).getByRole('button', { name: 'Conferir no Mercado Livre' })).toBeInTheDocument();
    expect(within(card()).getByRole('button', { name: 'Já conferi, liberar envio' })).toBeInTheDocument();
  });

  it('pedido_cancelado_tem_precedencia_sobre_a_pendencia', async () => {
    CONVERSAS = [conversa({ envioPendente: PENDENTE, order_status: 'cancelled' })];
    renderAba(); await abrir();
    expect(within(card()).getByText('Pedido cancelado')).toBeInTheDocument();
    expect(within(card()).queryByRole('button', { name: 'Conferir no Mercado Livre' })).not.toBeInTheDocument();
    expect(within(card()).getByRole('textbox')).toBeDisabled();
  });

  it('conferir_confirmada_mostra_sucesso_e_libera_o_campo', async () => {
    CONVERSAS = [conversa({ envioPendente: PENDENTE })];
    buscarPendenteMock.mockResolvedValue(PENDENTE);
    verificarMock.mockResolvedValueOnce(resp('confirmada'));
    renderAba(); await abrir();
    await userEvent.click(within(card()).getByRole('button', { name: 'Conferir no Mercado Livre' }));
    expect(verificarMock).toHaveBeenCalledWith('pack-2', OP);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('liberar_pede_confirmacao', async () => {
    CONVERSAS = [conversa({ envioPendente: PENDENTE })];
    buscarPendenteMock.mockResolvedValue(PENDENTE);
    liberarMock.mockResolvedValueOnce(resp('inconclusiva'));
    renderAba(); await abrir();
    await userEvent.click(within(card()).getByRole('button', { name: 'Já conferi, liberar envio' }));
    expect(await screen.findByText(/vai duplicá-la/)).toBeInTheDocument();
    expect(liberarMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Liberar envio' }));
    expect(liberarMock).toHaveBeenCalledWith('pack-2', OP);
    expect(await within(card()).findByRole('textbox')).toBeInTheDocument();
  });

  it('sem_texto_nao_envia', async () => {
    renderAba(); await abrir();
    anexar(arquivo());
    expect(enviar()).toBeDisabled();
    await userEvent.click(enviar());
    expect(enviarAnexoMock).not.toHaveBeenCalled();
    expect(responderMock).not.toHaveBeenCalled();
  });

  it('envia_upload_e_depois_mensagem_na_ordem', async () => {
    enviarAnexoMock.mockResolvedValueOnce('arq-1');
    responderMock.mockResolvedValueOnce(resp('confirmada'));
    renderAba(); await abrir();
    const f = arquivo('nota.pdf', 'application/pdf');
    anexar(f);
    await userEvent.type(caixa(), 'Segue');
    await userEvent.click(enviar());
    await waitFor(() => expect(responderMock).toHaveBeenCalledTimes(1));
    expect(enviarAnexoMock).toHaveBeenCalledWith('pack-2', f);
    expect(responderMock).toHaveBeenCalledWith('pack-2', 'Segue', { operacao_id: expect.stringMatching(/^[0-9a-f-]{36}$/), anexo: 'arq-1' });
    expect(enviarAnexoMock.mock.invocationCallOrder[0]).toBeLessThan(responderMock.mock.invocationCallOrder[0]);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('falha_de_upload_mantem_texto_e_arquivo', async () => {
    enviarAnexoMock.mockRejectedValueOnce(new Error('rede'));
    renderAba(); await abrir();
    anexar(arquivo('foto.png'));
    await userEvent.type(caixa(), 'Oi');
    await userEvent.click(enviar());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(responderMock).not.toHaveBeenCalled();
    expect(caixa().value).toBe('Oi');
    expect(within(card()).getByText('foto.png')).toBeInTheDocument();
  });

  it('falha_de_envio_reaproveita_operacao_e_id_sem_novo_upload', async () => {
    enviarAnexoMock.mockResolvedValue('arq-1');
    responderMock.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(resp('confirmada'));
    renderAba(); await abrir();
    anexar(arquivo());
    await userEvent.type(caixa(), 'Oi');
    await userEvent.click(enviar());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await userEvent.click(enviar());
    await waitFor(() => expect(responderMock).toHaveBeenCalledTimes(2));
    expect(enviarAnexoMock).toHaveBeenCalledTimes(1);
    expect(responderMock.mock.calls[1][2]).toEqual(responderMock.mock.calls[0][2]);
    expect(responderMock.mock.calls[1][2].anexo).toBe('arq-1');
  });

  it('recusa_definitiva_gera_nova_operacao', async () => {
    responderMock.mockRejectedValueOnce(erroEdge({ estado: 'recusada', codigo: 'recusada' })).mockResolvedValueOnce(resp('confirmada'));
    renderAba(); await abrir();
    await userEvent.type(caixa(), 'Oi');
    await userEvent.click(enviar());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await userEvent.click(enviar());
    await waitFor(() => expect(responderMock).toHaveBeenCalledTimes(2));
    expect(responderMock.mock.calls[1][2].operacao_id).not.toBe(responderMock.mock.calls[0][2].operacao_id);
  });

  it('conferir_nao_confirmada_encerra_a_operacao_e_o_proximo_envio_e_novo', async () => {
    responderMock.mockResolvedValueOnce(resp('enviada', true)).mockResolvedValueOnce(resp('confirmada'));
    verificarMock.mockResolvedValueOnce(resp('inconclusiva'));
    renderAba(); await abrir();
    await userEvent.type(caixa(), 'Oi');
    await userEvent.click(enviar());
    await userEvent.click(await within(card()).findByRole('button', { name: 'Conferir no Mercado Livre' }));
    await waitFor(() => expect(verificarMock).toHaveBeenCalled());
    await userEvent.click(await within(card()).findByRole('button', { name: 'Responder' }));
    await waitFor(() => expect(responderMock).toHaveBeenCalledTimes(2));
    expect(responderMock.mock.calls[1][2].operacao_id).not.toBe(responderMock.mock.calls[0][2].operacao_id);
  });

  it('busca_atrasada_nao_recoloca_pendencia_depois_de_liberar', async () => {
    CONVERSAS = [conversa({ envioPendente: PENDENTE })];
    let resolver: (v: unknown) => void = () => {};
    buscarPendenteMock.mockReturnValue(new Promise((r) => { resolver = r; }));
    liberarMock.mockResolvedValueOnce(resp('inconclusiva'));
    renderAba(); await abrir();
    await userEvent.click(within(card()).getByRole('button', { name: 'Já conferi, liberar envio' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Liberar envio' }));
    expect(await within(card()).findByRole('textbox')).toBeInTheDocument();
    resolver(PENDENTE);
    await new Promise((r) => setTimeout(r, 20));
    expect(within(card()).getByRole('textbox')).toBeInTheDocument();
  });
});

describe('seleção de arquivo', () => {
  it('clipe_escolhe_arquivo_e_mostra_chip', async () => {
    renderAba(); await abrir();
    expect(arquivoInput()).toHaveAttribute('accept', 'image/jpeg,image/png,application/pdf');
    expect(within(card()).getByRole('button', { name: 'Anexar arquivo' })).toBeInTheDocument();
    anexar(arquivo('comprovante-muito-longo.png'));
    expect(within(card()).getByText('comprovante-muito-longo.png')).toBeInTheDocument();
  });

  it('remover_chip_limpa_arquivo', async () => {
    renderAba(); await abrir();
    anexar(arquivo());
    await userEvent.click(within(card()).getByRole('button', { name: 'Remover anexo' }));
    expect(within(card()).queryByText('foto.png')).not.toBeInTheDocument();
  });

  it('arquivo_acima_de_5mb_mostra_erro_e_mantem_texto', async () => {
    renderAba(); await abrir();
    await userEvent.type(caixa(), 'Oi');
    anexar(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.png', { type: 'image/png' }));
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/5 MB/));
    expect(within(card()).queryByText('grande.png')).not.toBeInTheDocument();
    expect(caixa().value).toBe('Oi');
  });

  it('heic_mostra_erro_e_mantem_texto', async () => {
    renderAba(); await abrir();
    await userEvent.type(caixa(), 'Oi');
    anexar(arquivo('foto.heic', 'image/heic'));
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/JPG, PNG ou PDF/));
    expect(within(card()).queryByText('foto.heic')).not.toBeInTheDocument();
    expect(caixa().value).toBe('Oi');
  });
});

describe('anexo recebido no balão', () => {
  it('balao_sem_texto_com_anexo_nao_fica_vazio', async () => {
    CONVERSAS = [conversa({}, '', [anexoImg])];
    renderAba(); await abrir();
    expect(await within(card()).findByRole('img', { name: 'foto-defeito.png' })).toHaveAttribute('src', 'blob:teste');
    expect(baixarMock).toHaveBeenCalledWith('pack-2', 'f1');
  });

  it('anexo_com_ameaca_nao_baixa', async () => {
    CONVERSAS = [conversa({}, 'Olá', [{ ...anexoImg, potential_security_threat: true }])];
    renderAba(); await abrir();
    expect(within(card()).getByText('foto-defeito.png')).toBeInTheDocument();
    expect(baixarMock).not.toHaveBeenCalled();
    expect(within(card()).queryByRole('img')).not.toBeInTheDocument();
  });

  it('anexo_404_mostra_arquivo_indisponivel', async () => {
    CONVERSAS = [conversa({}, 'Olá', [anexoImg])];
    baixarMock.mockRejectedValue(erroEdge({ codigo: 'anexo_indisponivel' }));
    renderAba(); await abrir();
    expect(await within(card()).findByText('Arquivo indisponível')).toBeInTheDocument();
  });

  it('miniatura_so_carrega_com_conversa_aberta', async () => {
    CONVERSAS = [conversa({}, 'Olá', [anexoImg])];
    renderAba();
    expect(baixarMock).not.toHaveBeenCalled();
    await abrir();
    await waitFor(() => expect(baixarMock).toHaveBeenCalledTimes(1));
  });

  it('recolher_a_conversa_revoga_a_miniatura', async () => {
    CONVERSAS = [conversa({}, 'Olá', [anexoImg])];
    renderAba(); await abrir();
    await within(card()).findByRole('img', { name: 'foto-defeito.png' });
    await userEvent.click(within(card()).getByRole('button', { name: 'Recolher' }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:teste'));
  });
});
