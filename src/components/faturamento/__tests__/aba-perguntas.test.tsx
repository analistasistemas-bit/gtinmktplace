import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AbaPerguntas } from '../aba-perguntas';

const base = {
  item_id: 'MLB123', item_titulo: 'Produto X', texto: 'Tem estoque?', status: 'ANSWERED',
  resposta: 'Temos.', respondida_em: null, criada_em: '2026-07-10T10:00:00Z',
};

vi.mock('@/hooks/usePerguntas', () => ({
  useListaPerguntas: () => ({
    data: [
      { id: 'q-1', question_id: 1, comprador_id: 10, comprador_nick: 'MARIA_01', comprador_nome: null, ...base },
      { id: 'q-2', question_id: 2, comprador_id: 20, comprador_nick: 'OLCA4176283', comprador_nome: 'CARLA FABIANA DE OLIVEIRA PINTO', ...base },
    ],
    isFetching: false,
  }),
}));

vi.mock('@/components/export/botao-exportar', () => ({ BotaoExportar: () => null }));

describe('AbaPerguntas', () => {
  it('aponta o atalho para as perguntas no ML, não para o anúncio', () => {
    render(<QueryClientProvider client={new QueryClient()}><AbaPerguntas /></QueryClientProvider>);

    expect(screen.getAllByRole('link', { name: 'Abrir perguntas no Mercado Livre' })[0])
      .toHaveAttribute('href', 'https://www.mercadolivre.com.br/perguntas/vendedor');
  });

  it('prefere o nome civil ao apelido do ML, como na aba Vendas', () => {
    render(<QueryClientProvider client={new QueryClient()}><AbaPerguntas /></QueryClientProvider>);

    expect(screen.getByText('· Carla Fabiana')).toBeInTheDocument();
    expect(screen.queryByText('· OLCA4176283')).not.toBeInTheDocument();
  });

  it('cai no apelido quando o comprador nunca comprou', () => {
    render(<QueryClientProvider client={new QueryClient()}><AbaPerguntas /></QueryClientProvider>);

    expect(screen.getByText('· MARIA_01')).toBeInTheDocument();
  });
});
