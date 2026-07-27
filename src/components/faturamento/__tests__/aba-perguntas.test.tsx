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
  it('expõe o link do anúncio com nome acessível', () => {
    render(<QueryClientProvider client={new QueryClient()}><AbaPerguntas /></QueryClientProvider>);

    expect(screen.getByRole('link', { name: 'Abrir anúncio no Mercado Livre' }))
      .toHaveAttribute('href', 'https://produto.mercadolivre.com.br/MLB-123');
  });
});
