import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { toast } from 'sonner';
import { AbaMensagens } from '../aba-mensagens';

const responderMensagemMock = vi.fn();
const dispensarConversaMock = vi.fn();
const marcarLidasMock = vi.fn();

vi.mock('@/lib/mensagens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mensagens')>();
  return {
    ...actual,
    responderMensagem: (...args: unknown[]) => responderMensagemMock(...args),
    dispensarConversa: (...args: unknown[]) => dispensarConversaMock(...args),
    marcarMensagensLidasML: (...args: unknown[]) => marcarLidasMock(...args),
  };
});

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// pack-1 é a única conversa cancelada (não aguardando) — mantém os dados originais do teste
// para não quebrar as asserções específicas dela (nick, item_id, href). pack-2..13 (12) ficam
// aguardando resposta; pack-14..25 (12) não aguardam — mistura pedida pelo achado 3, e dá 25
// conversas ao todo (>20, exercita a paginação da aba "Todas").
function conversaBase(id: number, aguardando: boolean) {
  const packId = `pack-${id}`;
  return {
    pack_id: packId, order_id: `order-${id}`, item_titulo: `Produto ${id}`, item_id: `MLB${id}`,
    comprador_nome: null, comprador_nick: `NICK_${id}`, order_status: 'paid', aguardando,
    ultima: '2026-07-10T10:00:00Z', shipping_status: 'handling', idsNaoLidosML: [] as string[],
    mensagens: [{
      id: `message-${id}`, pack_id: packId, order_id: `order-${id}`, message_id: `m${id}`, direcao: 'recebida', texto: 'Olá',
      item_titulo: `Produto ${id}`, item_id: `MLB${id}`, comprador_nome: null, comprador_nick: `NICK_${id}`,
      order_status: 'paid', data_ml: '2026-07-10T10:00:00Z', lida: !aguardando, lida_ml_em: '2026-07-10T11:00:00Z',
    }],
  };
}

const PACK_1_CANCELADA = {
  pack_id: 'pack-1', order_id: 'order-1', item_titulo: 'Produto X', item_id: 'MLB123', comprador_nome: null,
  comprador_nick: 'MARIA_01', order_status: 'cancelled', aguardando: false, ultima: '2026-07-10T10:00:00Z', shipping_status: 'handling', idsNaoLidosML: [] as string[],
  mensagens: [{
    id: 'message-1', pack_id: 'pack-1', order_id: 'order-1', message_id: 'm1', direcao: 'recebida', texto: 'Olá',
    item_titulo: 'Produto X', item_id: 'MLB123', comprador_nome: null, comprador_nick: 'MARIA_01',
    order_status: 'cancelled', data_ml: '2026-07-10T10:00:00Z', lida: false, lida_ml_em: '2026-07-10T11:00:00Z',
  }],
};

let CONVERSAS = [
  PACK_1_CANCELADA,
  ...Array.from({ length: 12 }, (_, i) => conversaBase(i + 2, true)),
  ...Array.from({ length: 12 }, (_, i) => conversaBase(i + 14, false)),
];

vi.mock('@/hooks/useMensagens', () => ({
  useListaMensagens: () => ({ data: CONVERSAS, isFetching: false }),
  useResumoMensagens: () => ({ data: RESUMO_ATUAL, isError: RESUMO_ERRO }),
}));

// Números vindos do banco (RPC) — propositalmente diferentes do que a lista mockada daria.
let RESUMO_ERRO = false;
let RESUMO_ATUAL: typeof RESUMO | undefined;
const RESUMO = {
  naoLidas: { aPreparar: 40, aCaminho: 7, entregues: 3, total: 50 },
  lidas: { semResponder: 120, respondidas: 900 },
};

/** Abre o card (o chat só aparece expandido, como no ML). */
async function abrir(card: HTMLElement) {
  await userEvent.click(within(card).getByRole('button', { name: 'Conferir mensagem' }));
}

function renderAba(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AbaMensagens />
    </QueryClientProvider>
  );
  return { ...result, queryClient, invalidateSpy };
}

describe('AbaMensagens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    RESUMO_ATUAL = RESUMO;
    RESUMO_ERRO = false;
  });
  it('abre na aba Aguardando; a conversa cancelada (não aguardando) fica fora até trocar para Todas', async () => {
    renderAba();
    expect(screen.queryByText(/MARIA_01/)).not.toBeInTheDocument();
    expect(screen.queryByText('Pedido cancelado')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Todas' }));

    expect(screen.getByText('MARIA_01')).toBeInTheDocument();
    const card = screen.getByText('Pedido cancelado').closest('div.rounded-lg') as HTMLElement;
    await abrir(card);
    expect(within(card).getByRole('link', { name: 'Abrir conversa no Mercado Livre' }))
      .toHaveAttribute('href', 'https://www.mercadolivre.com.br/vendas/pack-1/detalhe');
    expect(within(card).getByRole('textbox')).toBeDisabled();
    expect(within(card).getByRole('button', { name: /sugerir resposta/i })).toBeDisabled();
    expect(within(card).getByRole('button', { name: /responder/i })).toBeDisabled();
  });

  it('mostra o total no rodapé de paginação', async () => {
    renderAba();
    await userEvent.click(screen.getByRole('tab', { name: 'Todas' }));
    expect(screen.getByText(/de 25 conversas/i)).toBeInTheDocument();
  });

  it('aba Todas com mais de 20 conversas pagina, e a página 2 mostra outras conversas', async () => {
    renderAba();
    await userEvent.click(screen.getByRole('tab', { name: 'Todas' }));

    // Página 1: pack-1..pack-20 (ordem da lista).
    expect(screen.getByText('Produto X')).toBeInTheDocument();
    expect(screen.getByText('Produto 20')).toBeInTheDocument();
    expect(screen.queryByText('Produto 25')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Página 2' }));

    // Página 2: pack-21..pack-25 — conversas diferentes da página 1.
    expect(screen.getByText('Produto 25')).toBeInTheDocument();
    expect(screen.queryByText('Produto X')).not.toBeInTheDocument();
    expect(screen.queryByText('Produto 20')).not.toBeInTheDocument();
  });

  it('trocar de aba de status volta para a página 1', async () => {
    renderAba();
    await userEvent.click(screen.getByRole('tab', { name: 'Todas' }));
    await userEvent.click(screen.getByRole('button', { name: 'Página 2' }));
    expect(screen.getByText('Produto 25')).toBeInTheDocument();

    // Aguardando tem só 12 conversas (uma página). Sem reset, a leitura ficaria presa no
    // offset da página 2 e mostraria a lista vazia mesmo havendo 12 conversas aguardando.
    await userEvent.click(screen.getByRole('tab', { name: 'Aguardando' }));

    expect(screen.queryByText('Nenhuma conversa aguardando resposta.')).not.toBeInTheDocument();
    expect(screen.getByText('Produto 2')).toBeInTheDocument();
  });

  it('quando responderMensagem falha com erro de pedido cancelado: exibe toast.info, marca cancelada localmente e invalida queries', async () => {
    const erro = Object.assign(new Error('Pedido cancelado no Mercado Livre'), { codigo: 'pedido_cancelado' });
    responderMensagemMock.mockRejectedValueOnce(erro);

    const { invalidateSpy } = renderAba();
    const card = screen.getByText('Produto 2').closest('div.rounded-lg') as HTMLElement;
    await abrir(card);
    const textarea = within(card).getByPlaceholderText(/escreva ao comprador/i);

    await userEvent.type(textarea, 'Mensagem de teste');
    const responderBtn = within(card).getByRole('button', { name: /responder/i });
    expect(responderBtn).not.toBeDisabled();

    await userEvent.click(responderBtn);

    expect(responderMensagemMock).toHaveBeenCalledWith('pack-2', 'Mensagem de teste');
    expect(toast.info).toHaveBeenCalledWith('Este pedido foi cancelado no Mercado Livre. Mensagens desativadas.');
    expect(within(card).getByText('Pedido cancelado')).toBeInTheDocument();
    expect(textarea).toBeDisabled();
    expect(responderBtn).toBeDisabled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['mensagens'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['mensagensAguardando'] });
  });

  it('quando responderMensagem falha com erro genérico: exibe toast.error e não desabilita campos nem marca cancelada', async () => {
    responderMensagemMock.mockRejectedValueOnce(new Error('Falha de conexão com a API'));

    const { invalidateSpy } = renderAba();
    const card = screen.getByText('Produto 2').closest('div.rounded-lg') as HTMLElement;
    await abrir(card);
    const textarea = within(card).getByPlaceholderText(/escreva ao comprador/i);

    await userEvent.type(textarea, 'Outra mensagem');
    const responderBtn = within(card).getByRole('button', { name: /responder/i });
    expect(responderBtn).not.toBeDisabled();

    await userEvent.click(responderBtn);

    expect(responderMensagemMock).toHaveBeenCalledWith('pack-2', 'Outra mensagem');
    expect(toast.error).toHaveBeenCalledWith('Falha ao enviar: Falha de conexão com a API');
    expect(within(card).queryByText('Pedido cancelado')).not.toBeInTheDocument();
    expect(textarea).not.toBeDisabled();
    expect(responderBtn).not.toBeDisabled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('clicar em Dispensar chama dispensarConversa com o pack_id e mostra toast de sucesso', async () => {
    dispensarConversaMock.mockResolvedValueOnce(1);

    const { invalidateSpy } = renderAba();
    const card = screen.getByText('Produto 2').closest('div.rounded-lg') as HTMLElement;
    const dispensarBtn = within(card).getByRole('button', { name: /dispensar/i });

    await userEvent.click(dispensarBtn);

    expect(dispensarConversaMock).toHaveBeenCalledWith('pack-2');
    expect(toast.success).toHaveBeenCalledWith('Conversa dispensada.');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['mensagens'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['mensagensAguardando'] });
  });

  it('Dispensar que nao alcanca nenhuma linha avisa em vez de dizer que dispensou', async () => {
    // A RPC filtra por user_id; a sessao de suporte enxerga a conversa por org_id e recebe 0.
    dispensarConversaMock.mockResolvedValueOnce(0);

    renderAba();
    const card = screen.getByText('Produto 2').closest('div.rounded-lg') as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: /dispensar/i }));

    expect(toast.info).toHaveBeenCalledWith('Nenhuma mensagem para dispensar nesta conversa.');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('Enter envia uma vez só, mesmo apertado de novo com o envio pendente; Shift+Enter não envia', async () => {
    let concluir!: () => void;
    responderMensagemMock.mockImplementationOnce(() => new Promise<void>((r) => { concluir = r; }));
    renderAba();
    const card = screen.getByText('Produto 2').closest('div.rounded-lg') as HTMLElement;
    await abrir(card);
    const textarea = within(card).getByPlaceholderText(/escreva ao comprador/i);

    await userEvent.type(textarea, 'Oi{Shift>}{Enter}{/Shift}tudo bem');
    expect(responderMensagemMock).not.toHaveBeenCalled();
    await userEvent.type(textarea, '{Enter}{Enter}');
    expect(responderMensagemMock).toHaveBeenCalledTimes(1);
    expect(responderMensagemMock).toHaveBeenCalledWith('pack-2', 'Oi\ntudo bem');
    concluir();
  });

  it('cada balão diz ao leitor de tela quem escreveu', async () => {
    renderAba();
    await abrir(screen.getByText('Produto 2').closest('div.rounded-lg') as HTMLElement);
    const log = screen.getByRole('log', { name: 'Conversa com NICK_2' });
    expect(within(log).getByText('NICK_2:')).toHaveClass('sr-only');
  });
  it('card recolhido mostra a venda, o tempo da mensagem e o botão; o chat só aparece ao expandir', async () => {
    renderAba();
    const card = screen.getByText('Produto 2').closest('div.rounded-lg') as HTMLElement;
    expect(within(card).getByText(/Venda para preparar · Mensagem recebida há/)).toBeInTheDocument();
    expect(within(card).queryByRole('log')).not.toBeInTheDocument();
    await abrir(card);
    expect(within(card).getByRole('log')).toBeInTheDocument();
  });

  describe('leitura sincronizada com o ML', () => {
    const comNaoLida = (ids: string[]) => CONVERSAS.map((c) => c.pack_id === 'pack-2' ? { ...c, idsNaoLidosML: ids } : c);
    const ORIGINAL = CONVERSAS;
    const card2 = () => screen.getByText('Produto 2').closest('div.rounded-lg') as HTMLElement;
    beforeEach(() => { marcarLidasMock.mockResolvedValue({ ok: true }); });
    afterEach(() => { CONVERSAS = ORIGINAL; });

    it('abrir com não lida marca 1x; reabrir sem novidade não chama de novo', async () => {
      CONVERSAS = comNaoLida(['m2']);
      renderAba();
      await abrir(card2());
      expect(marcarLidasMock).toHaveBeenCalledTimes(1);
      expect(marcarLidasMock).toHaveBeenCalledWith('pack-2');
      await userEvent.click(within(card2()).getByRole('button', { name: 'Recolher' }));
      await abrir(card2());
      expect(marcarLidasMock).toHaveBeenCalledTimes(1);
    });

    it('chega mensagem nova (id novo) e reabre: chama de novo', async () => {
      CONVERSAS = comNaoLida(['m2']);
      const { rerender, queryClient } = renderAba();
      await abrir(card2());
      await userEvent.click(within(card2()).getByRole('button', { name: 'Recolher' }));
      CONVERSAS = comNaoLida(['m2', 'm2b']);
      rerender(<QueryClientProvider client={queryClient}><AbaMensagens /></QueryClientProvider>);
      await abrir(card2());
      expect(marcarLidasMock).toHaveBeenCalledTimes(2);
    });

    it('paginar/filtrar desmonta o card, mas reabrir sem novidade não chama de novo', async () => {
      CONVERSAS = comNaoLida(['m2']);
      renderAba();
      await abrir(card2());
      expect(marcarLidasMock).toHaveBeenCalledTimes(1);
      await userEvent.click(screen.getByRole('tab', { name: 'Todas' }));
      await userEvent.click(screen.getByRole('button', { name: 'Página 2' }));
      await userEvent.click(screen.getByRole('tab', { name: 'Aguardando' }));
      await abrir(card2());
      expect(marcarLidasMock).toHaveBeenCalledTimes(1);
    });

    it('sem não lidas no ML, abrir não chama a edge', async () => {
      renderAba();
      await abrir(card2());
      expect(marcarLidasMock).not.toHaveBeenCalled();
    });

    it('falha ao marcar: avisa e a próxima abertura tenta de novo', async () => {
      CONVERSAS = comNaoLida(['m2']);
      marcarLidasMock.mockRejectedValueOnce(new Error('ML fora'));
      renderAba();
      await abrir(card2());
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('ML fora'));
      await userEvent.click(within(card2()).getByRole('button', { name: 'Recolher' }));
      await abrir(card2());
      expect(marcarLidasMock).toHaveBeenCalledTimes(2);
    });

    it('abrir não tira a conversa de Sem responder; Dispensar tira (via invalidação)', async () => {
      dispensarConversaMock.mockResolvedValueOnce(1);
      const { invalidateSpy } = renderAba();
      await userEvent.click(screen.getByRole('button', { name: /Sem responder/ }));
      await abrir(card2());
      expect(card2()).toBeInTheDocument(); // continua na lista filtrada depois de aberta
      await userEvent.click(within(card2()).getByRole('button', { name: /dispensar/i }));
      expect(dispensarConversaMock).toHaveBeenCalledWith('pack-2');
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['mensagens'] });
    });
  });

  it('RPC em carregamento: placeholder, nunca a contagem do array limitado', () => {
    RESUMO_ATUAL = undefined;
    renderAba();
    const lidas = screen.getByRole('region', { name: 'Lidas' });
    expect(within(lidas).getByRole('button', { name: /Respondidas/ })).toHaveTextContent('—');
    expect(within(lidas).getByRole('button', { name: /Sem responder/ })).not.toHaveTextContent('12');
  });

  it('RPC com erro: avisa; mantém o último resumo marcado como desatualizado', () => {
    RESUMO_ERRO = true;
    RESUMO_ATUAL = undefined;
    const { unmount } = renderAba();
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar os contadores.');
    unmount();
    RESUMO_ATUAL = RESUMO;
    renderAba();
    expect(screen.getByRole('alert')).toHaveTextContent('desatualizados');
    expect(screen.getByRole('button', { name: /Respondidas/ })).toHaveTextContent('900');
  });

  it('cards de resumo mostram os números do banco e filtram a lista ao clicar', async () => {
    renderAba();
    const naoLidas = screen.getByRole('region', { name: 'Não lidas' });
    expect(within(naoLidas).getByText('50')).toBeInTheDocument();
    expect(within(naoLidas).getByRole('button', { name: /A preparar/ })).toHaveTextContent('40');
    expect(within(screen.getByRole('region', { name: 'Lidas' })).getByRole('button', { name: /Respondidas/ })).toHaveTextContent('900');

    // Nenhuma conversa da lista mockada está "não lida no ML" → filtro vazio.
    await userEvent.click(within(naoLidas).getByRole('button', { name: /A preparar/ }));
    expect(screen.getByText('Nenhuma conversa carregada neste filtro.')).toBeInTheDocument();
    // Sem responder: as 12 aguardando (lida=false, última recebida) — as 12 já lidas não entram.
    await userEvent.click(screen.getByRole('button', { name: /Sem responder/ }));
    expect(screen.getByText('Produto 2')).toBeInTheDocument();
    expect(screen.queryByText('Produto 14')).not.toBeInTheDocument();
  });
});
