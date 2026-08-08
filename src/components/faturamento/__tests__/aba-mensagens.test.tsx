import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AbaMensagens } from '../aba-mensagens';

vi.mock('@/hooks/useMensagens', () => ({
  useListaMensagens: () => ({
    data: [{
      pack_id: 'pack-1', order_id: 'order-1', item_titulo: 'Produto X', item_id: 'MLB123', comprador_nome: null,
      comprador_nick: 'MARIA_01', order_status: 'cancelled', aguardando: false, ultima: '2026-07-10T10:00:00Z',
      mensagens: [{
        id: 'message-1', pack_id: 'pack-1', order_id: 'order-1', message_id: 'm1', direcao: 'recebida', texto: 'Olá',
        item_titulo: 'Produto X', item_id: 'MLB123', comprador_nome: null, comprador_nick: 'MARIA_01',
        order_status: 'cancelled', data_ml: '2026-07-10T10:00:00Z',
      }],
    }],
    isFetching: false,
  }),
}));

function renderAba() {
  render(<QueryClientProvider client={new QueryClient()}><AbaMensagens /></QueryClientProvider>);
}

describe('AbaMensagens', () => {
  it('abre na aba Aguardando; a conversa cancelada (não aguardando) fica fora até trocar para Todas', async () => {
    renderAba();
    expect(screen.getByText('Nenhuma conversa aguardando resposta.')).toBeInTheDocument();
    expect(screen.queryByText(/MARIA_01/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Todas' }));

    expect(screen.getByText(/MARIA_01/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir anúncio no Mercado Livre' }))
      .toHaveAttribute('href', 'https://produto.mercadolivre.com.br/MLB-123');
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: /sugerir resposta/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /responder/i })).toBeDisabled();
    expect(screen.getByText('Pedido cancelado')).toBeInTheDocument();
  });

  it('mostra o total no rodapé de paginação', async () => {
    renderAba();
    await userEvent.click(screen.getByRole('tab', { name: 'Todas' }));
    expect(screen.getByText(/de 1 conversa/i)).toBeInTheDocument();
  });
});
