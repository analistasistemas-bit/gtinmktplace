import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { NotificacoesBell } from '../notificacoes-bell';

vi.mock('@/hooks/useNotificacoes', () => ({
  useNotificacoesNaoLidas: () => ({ count: 1, isError: false }),
  useMarcarNotificacoesLidas: () => vi.fn(),
  useListaNotificacoes: () => ({
    data: [{
      id: 'notification-1',
      categoria: 'integracao',
      texto: 'Nova solicitação de suporte aguardando decisão.',
      lida: false,
      criada_em: '2026-07-26T14:11:00Z',
    }],
  }),
}));

describe('NotificacoesBell', () => {
  it('abre a tela de suporte ao selecionar uma notificação de integração', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <NotificacoesBell />
        <Routes>
          <Route path="/" element={null} />
          <Route path="/suporte" element={<span>Solicitações de suporte</span>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /notificações/i }));
    await user.click(screen.getByText('Nova solicitação de suporte aguardando decisão.'));

    expect(screen.getByText('Solicitações de suporte')).toBeInTheDocument();
  });
});
