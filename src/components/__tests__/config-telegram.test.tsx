import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const salvarMutate = vi.fn();
const telegramConfig = { chatId: 'chat-atual', ativo: true, temToken: true };
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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

import { toast } from 'sonner';
import { ConfigTelegram } from '../config-telegram';

describe('ConfigTelegram', () => {
  beforeEach(() => {
    salvarMutate.mockReset();
    mocks.invoke.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
  });

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

  it('ativa os comandos no bot pela edge usuarios (ADR-0190 D-8)', async () => {
    const user = userEvent.setup();
    render(<ConfigTelegram />);
    await user.click(screen.getByRole('button', { name: /ativar comandos no bot/i }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('usuarios', {
      body: { action: 'registrar_webhook_telegram' },
    }));
    expect(toast.success).toHaveBeenCalledWith('Comandos ativados. Mande /ajuda para o bot.');
  });

  it('sem permissão de edição, o botão de ativar comandos não aparece', () => {
    render(<ConfigTelegram podeEditar={false} />);
    expect(screen.queryByRole('button', { name: /ativar comandos no bot/i })).toBeNull();
  });

  it('depois de trocar o token, pede para ativar os comandos de novo', async () => {
    salvarMutate.mockImplementation((_v: unknown, opts: { onSuccess?: () => void }) => opts.onSuccess?.());
    const user = userEvent.setup();
    render(<ConfigTelegram />);
    expect(screen.queryByText('Token alterado: ative os comandos de novo.')).toBeNull();
    await user.type(screen.getByLabelText(/bot token/i), 'token-novo');
    await user.click(screen.getByRole('button', { name: /salvar configurações/i }));
    expect(screen.getByText('Token alterado: ative os comandos de novo.')).toBeInTheDocument();
  });
});
