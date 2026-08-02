import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const salvarMutate = vi.fn();
const telegramConfig = { chatId: 'chat-atual', ativo: true, temToken: true };

vi.mock('@/hooks/useConfiguracoes', () => ({
  useTelegramConfig: () => ({
    data: telegramConfig,
  }),
  useSalvarTelegramConfig: () => ({
    mutate: salvarMutate,
    isPending: false,
    isSuccess: false,
  }),
  useEnviarTesteTelegram: () => ({ mutate: vi.fn(), isPending: false }),
  useVerificarModeradosAgora: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ConfigTelegram } from '../config-telegram';

describe('ConfigTelegram', () => {
  beforeEach(() => salvarMutate.mockClear());

  it('só salva os campos editáveis após clique explícito em Salvar configurações', async () => {
    const user = userEvent.setup();
    render(<ConfigTelegram />);

    const chatId = screen.getByLabelText(/chat id para teste/i);
    const token = screen.getByLabelText(/bot token/i);
    const salvar = screen.getByRole('button', { name: /salvar configurações/i });

    expect(salvar).toBeDisabled();

    await user.clear(chatId);
    await user.type(chatId, 'novo-chat');
    await user.tab();
    await user.type(token, 'novo-token');
    await user.tab();

    expect(salvarMutate).not.toHaveBeenCalled();
    expect(salvar).toBeEnabled();

    await user.click(salvar);

    expect(salvarMutate).toHaveBeenCalledOnce();
    expect(salvarMutate.mock.calls[0][0]).toEqual({
      chatId: 'novo-chat',
      ativo: true,
      botToken: 'novo-token',
    });
  });
});
