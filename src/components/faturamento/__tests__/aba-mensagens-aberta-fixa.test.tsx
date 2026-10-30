// Revisão final, item 2: abrir uma conversa pelo filtro "Entregues" marca como lida; o refetch REAL
// (useListaMensagens com react-query) reclassifica a conversa para "Sem responder". Ela não pode
// sumir enquanto a pessoa lê/responde — só depois de recolher.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AbaMensagens } from '../aba-mensagens';

const conversa = (naoLidas: string[], aguardando = true) => ({
  pack_id: 'pack-2', order_id: 'order-2', item_titulo: 'Produto 2', item_id: 'MLB2',
  comprador_nome: null, comprador_nick: 'NICK_2', order_status: 'paid', aguardando,
  ultima: '2026-07-10T10:00:00Z', shipping_status: 'delivered', idsNaoLidosML: naoLidas,
  mensagens: [{
    id: 'message-2', pack_id: 'pack-2', order_id: 'order-2', message_id: 'm2', direcao: 'recebida', texto: 'Olá',
    item_titulo: 'Produto 2', item_id: 'MLB2', comprador_nome: null, comprador_nick: 'NICK_2',
    order_status: 'paid', data_ml: '2026-07-10T10:00:00Z', lida: false, lida_ml_em: naoLidas.length ? null : '2026-07-10T11:00:00Z',
  }],
});

let lidaNoML = false;
let respondida = false;
const buscarConversasMock = vi.fn(async () => [conversa(lidaNoML ? [] : ['m2'], !respondida)]);
const responderMock = vi.fn(async () => { respondida = true; });
const marcarLidasMock = vi.fn(async () => { lidaNoML = true; return { ok: true }; });

vi.mock('@/lib/mensagens', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mensagens')>()),
  buscarConversas: () => buscarConversasMock(),
  buscarResumoMensagens: async () => ({
    naoLidas: { aPreparar: 0, aCaminho: 0, entregues: 1, total: 1 }, lidas: { semResponder: 0, respondidas: 0 },
  }),
  marcarMensagensLidasML: () => marcarLidasMock(),
  responderMensagem: () => responderMock(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

describe('AbaMensagens: conversa aberta fica visível após o refetch que a reclassifica', () => {
  it('Entregues → Conferir mensagem → marca lida → refetch move para Sem responder; o card segue aberto até Recolher', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><AbaMensagens /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole('button', { name: /Entregues/ }));
    const card = () => screen.getByText('Produto 2').closest('div.rounded-lg') as HTMLElement;
    await userEvent.click(within(card()).getByRole('button', { name: 'Conferir mensagem' }));

    await waitFor(() => expect(buscarConversasMock).toHaveBeenCalledTimes(2)); // refetch real pós-marcação
    expect(marcarLidasMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(card()).getByRole('log')).toBeInTheDocument());
    expect(within(card()).getByRole('button', { name: 'Recolher' })).toBeInTheDocument();

    await userEvent.click(within(card()).getByRole('button', { name: 'Recolher' }));
    expect(screen.queryByText('Produto 2')).not.toBeInTheDocument(); // agora sai do filtro Entregues
  });

  it('Aguardando → abre → responde: o card solta a fixação e sai do filtro sem recarregar a página', async () => {
    lidaNoML = true; respondida = false;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><AbaMensagens /></QueryClientProvider>);
    const card = () => screen.getByText('Produto 2').closest('div.rounded-lg') as HTMLElement;
    await userEvent.click(within(await waitFor(card)).getByRole('button', { name: 'Conferir mensagem' }));
    await userEvent.type(within(card()).getByRole('textbox', { name: 'Mensagem ao comprador' }), 'Resposta');
    await userEvent.click(within(card()).getByRole('button', { name: 'Responder' }));

    expect(responderMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Produto 2')).not.toBeInTheDocument());
  });
});
