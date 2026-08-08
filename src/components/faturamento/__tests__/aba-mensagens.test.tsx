import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AbaMensagens } from '../aba-mensagens';

// pack-1 é a única conversa cancelada (não aguardando) — mantém os dados originais do teste
// para não quebrar as asserções específicas dela (nick, item_id, href). pack-2..13 (12) ficam
// aguardando resposta; pack-14..25 (12) não aguardam — mistura pedida pelo achado 3, e dá 25
// conversas ao todo (>20, exercita a paginação da aba "Todas").
function conversaBase(id: number, aguardando: boolean) {
  const packId = `pack-${id}`;
  return {
    pack_id: packId, order_id: `order-${id}`, item_titulo: `Produto ${id}`, item_id: `MLB${id}`,
    comprador_nome: null, comprador_nick: `NICK_${id}`, order_status: 'paid', aguardando,
    ultima: '2026-07-10T10:00:00Z',
    mensagens: [{
      id: `message-${id}`, pack_id: packId, order_id: `order-${id}`, message_id: `m${id}`, direcao: 'recebida', texto: 'Olá',
      item_titulo: `Produto ${id}`, item_id: `MLB${id}`, comprador_nome: null, comprador_nick: `NICK_${id}`,
      order_status: 'paid', data_ml: '2026-07-10T10:00:00Z',
    }],
  };
}

const PACK_1_CANCELADA = {
  pack_id: 'pack-1', order_id: 'order-1', item_titulo: 'Produto X', item_id: 'MLB123', comprador_nome: null,
  comprador_nick: 'MARIA_01', order_status: 'cancelled', aguardando: false, ultima: '2026-07-10T10:00:00Z',
  mensagens: [{
    id: 'message-1', pack_id: 'pack-1', order_id: 'order-1', message_id: 'm1', direcao: 'recebida', texto: 'Olá',
    item_titulo: 'Produto X', item_id: 'MLB123', comprador_nome: null, comprador_nick: 'MARIA_01',
    order_status: 'cancelled', data_ml: '2026-07-10T10:00:00Z',
  }],
};

const CONVERSAS = [
  PACK_1_CANCELADA,
  ...Array.from({ length: 12 }, (_, i) => conversaBase(i + 2, true)),
  ...Array.from({ length: 12 }, (_, i) => conversaBase(i + 14, false)),
];

vi.mock('@/hooks/useMensagens', () => ({
  useListaMensagens: () => ({ data: CONVERSAS, isFetching: false }),
}));

function renderAba() {
  render(<QueryClientProvider client={new QueryClient()}><AbaMensagens /></QueryClientProvider>);
}

describe('AbaMensagens', () => {
  it('abre na aba Aguardando; a conversa cancelada (não aguardando) fica fora até trocar para Todas', async () => {
    renderAba();
    expect(screen.queryByText(/MARIA_01/)).not.toBeInTheDocument();
    expect(screen.queryByText('Pedido cancelado')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Todas' }));

    expect(screen.getByText(/MARIA_01/)).toBeInTheDocument();
    const card = screen.getByText('Pedido cancelado').closest('div.rounded-lg') as HTMLElement;
    expect(within(card).getByRole('link', { name: 'Abrir anúncio no Mercado Livre' }))
      .toHaveAttribute('href', 'https://produto.mercadolivre.com.br/MLB-123');
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
});
