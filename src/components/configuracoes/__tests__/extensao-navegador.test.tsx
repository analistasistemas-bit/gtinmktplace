import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  enviar: vi.fn(async (): Promise<'ok' | 'nao_instalada' | 'desconectada'> => 'ok'),
  ping: vi.fn(async (): Promise<{ versao: string; protocolo: number } | null> => null),
  sessao: { access_token: 'a' } as unknown,
}));
vi.mock('@/lib/extensao-ponte', () => ({ enviarSessaoParaExtensao: h.enviar, pingExtensao: h.ping }));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ session: h.sessao }),
}));

import { ExtensaoNavegador } from '../extensao-navegador';

beforeEach(() => {
  h.enviar.mockReset();
  h.enviar.mockResolvedValue('ok');
  h.ping.mockReset();
  h.ping.mockResolvedValue(null);
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

  it('extensão responde → "Conectada" e a instalação vira "Instalada", sem botão de instalar', async () => {
    render(<ExtensaoNavegador />);
    expect(await screen.findByText('Conectada')).toBeInTheDocument();
    expect(screen.getByText('Instalada')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /instalar extensão/i })).not.toBeInTheDocument();
  });

  it('extensão ausente → "Não instalada" e o link de instalação da Chrome Web Store', async () => {
    h.enviar.mockResolvedValue('nao_instalada');
    render(<ExtensaoNavegador />);
    expect(await screen.findByText('Não instalada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /instalar extensão/i }))
      .toHaveAttribute('href', 'https://chromewebstore.google.com/detail/publiai/ext-id');
  });

  it('já conectada → botão "Reconectar" (não "Conectar") e ele reenvia a sessão atual', async () => {
    render(<ExtensaoNavegador />);
    await screen.findByText('Conectada');
    expect(screen.queryByRole('button', { name: /conectar extensão/i })).not.toBeInTheDocument();
    h.enviar.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^reconectar$/i }));
    await waitFor(() => expect(h.enviar).toHaveBeenCalledWith(h.sessao));
  });

  it('não instalada → "Conectar extensão"', async () => {
    h.enviar.mockResolvedValue('nao_instalada');
    render(<ExtensaoNavegador />);
    await screen.findByText('Não instalada');
    expect(screen.getByRole('button', { name: /conectar extensão/i })).toBeInTheDocument();
  });

  it('protocolo 2 → "Instalada neste Chrome (versão X)" + login pela extensão, sem Reconectar nem envio de sessão', async () => {
    h.ping.mockResolvedValue({ versao: '0.3.0', protocolo: 2 });
    render(<ExtensaoNavegador />);
    expect(await screen.findByText('Instalada neste Chrome (versão 0.3.0).')).toBeInTheDocument();
    expect(screen.getByText('Entre pela extensão, no ícone do PubliAI no Mercado Livre, com o seu e-mail e senha.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reconectar|conectar extensão/i })).not.toBeInTheDocument();
    expect(h.enviar).not.toHaveBeenCalled();
  });
});
