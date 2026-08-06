import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AbaPerguntas } from '../aba-perguntas';

vi.mock('@/hooks/usePerguntas', () => ({
  useListaPerguntas: () => ({
    data: [{
      id: 'question-1', question_id: 1, item_id: 'MLB123', item_titulo: 'Produto X', comprador_nick: 'MARIA_01',
      texto: 'Tem estoque?', status: 'ANSWERED', resposta: 'Temos.', respondida_em: null, criada_em: '2026-07-10T10:00:00Z',
    }],
    isFetching: false,
  }),
}));

vi.mock('@/components/export/botao-exportar', () => ({ BotaoExportar: () => null }));

describe('AbaPerguntas', () => {
  it('aponta o atalho para as perguntas no ML, não para o anúncio', () => {
    render(<QueryClientProvider client={new QueryClient()}><AbaPerguntas /></QueryClientProvider>);

    expect(screen.getByRole('link', { name: 'Abrir perguntas no Mercado Livre' }))
      .toHaveAttribute('href', 'https://www.mercadolivre.com.br/perguntas/vendedor');
  });

  it('mostra o nick de quem perguntou', () => {
    render(<QueryClientProvider client={new QueryClient()}><AbaPerguntas /></QueryClientProvider>);

    expect(screen.getByText('· MARIA_01')).toBeInTheDocument();
  });
});
