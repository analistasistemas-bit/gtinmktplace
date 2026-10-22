import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  enviar: vi.fn(async (): Promise<'ok' | 'nao_instalada' | 'desconectada'> => 'ok'),
  sessao: { access_token: 'a' } as unknown,
}));
vi.mock('@/lib/extensao-ponte', () => ({ enviarSessaoParaExtensao: h.enviar }));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ session: h.sessao }),
}));

import { ExtensaoNavegador } from '../extensao-navegador';

beforeEach(() => {
  h.enviar.mockReset();
  h.enviar.mockResolvedValue('ok');
  vi.stubEnv('VITE_EXTENSAO_ID', 'ext-id');
  vi.stubEnv('VITE_EXTENSAO_URL', 'https://chromewebstore.google.com/detail/publiai/ext-id');
});
afterEach(() => vi.unstubAllEnvs());

describe('ExtensaoNavegador', () => {
  it('sem id/URL configurados avisa que não está disponível e não envia nada', () => {
    vi.stubEnv('VITE_EXTENSAO_ID', '');
    vi.stubEnv('VITE_EXTENSAO_URL', '');
    render(<ExtensaoNavegador />);
    expect(screen.getByText('A extensão ainda não está disponível para instalação.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /conectar extensão/i })).not.toBeInTheDocument();
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it('mostra o link de instalação e "Conectada" quando a extensão responde', async () => {
    render(<ExtensaoNavegador />);
    expect(screen.getByRole('link', { name: /instalar extensão/i }))
      .toHaveAttribute('href', 'https://chromewebstore.google.com/detail/publiai/ext-id');
    expect(await screen.findByText('Conectada')).toBeInTheDocument();
  });

  it('extensão ausente → "Não instalada"', async () => {
    h.enviar.mockResolvedValue('nao_instalada');
    render(<ExtensaoNavegador />);
    expect(await screen.findByText('Não instalada')).toBeInTheDocument();
  });

  it('"Conectar extensão" envia a sessão atual', async () => {
    render(<ExtensaoNavegador />);
    await screen.findByText('Conectada');
    h.enviar.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /conectar extensão/i }));
    await waitFor(() => expect(h.enviar).toHaveBeenCalledWith(h.sessao));
  });
});
