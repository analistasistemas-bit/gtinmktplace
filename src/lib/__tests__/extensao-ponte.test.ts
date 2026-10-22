import type { Session } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/support-store', () => ({
  useSupportStore: { getState: () => ({ context: null }) },
}));

import { enviarSessaoParaExtensao } from '../extensao-ponte';

const sessao = {
  access_token: 'access-abc',
  refresh_token: 'refresh-SEGREDO',
  expires_at: 1_800_000_000,
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: 'u1' },
} as unknown as Session;

type Callback = (resp: unknown) => void;
let lastError: { message: string } | undefined;
const sendMessage = vi.fn((_id: string, _msg: unknown, cb: Callback) => cb({ ok: true }));

function instalarChrome() {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      get lastError() { return lastError; },
    },
  });
}

beforeEach(() => {
  sendMessage.mockClear();
  lastError = undefined;
  vi.stubEnv('VITE_EXTENSAO_ID', 'ext-id');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('enviarSessaoParaExtensao', () => {
  it('sem chrome.runtime → nao_instalada, sem lançar', async () => {
    await expect(enviarSessaoParaExtensao(sessao)).resolves.toBe('nao_instalada');
  });

  it('sem VITE_EXTENSAO_ID → no-op nao_instalada', async () => {
    vi.stubEnv('VITE_EXTENSAO_ID', '');
    instalarChrome();
    await expect(enviarSessaoParaExtensao(sessao)).resolves.toBe('nao_instalada');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('com sessão envia só access token, expires_at em segundos e nome da org — nunca o refresh token', async () => {
    instalarChrome();
    await expect(enviarSessaoParaExtensao(sessao)).resolves.toBe('ok');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [id, msg] = sendMessage.mock.calls[0];
    expect(id).toBe('ext-id');
    expect(msg).toEqual({ tipo: 'publiai:sessao', accessToken: 'access-abc', expiresAt: 1_800_000_000, orgNome: '' });
    expect(JSON.stringify(msg)).not.toContain('refresh');
  });

  it('sem sessão envia publiai:desconectar', async () => {
    instalarChrome();
    await expect(enviarSessaoParaExtensao(null)).resolves.toBe('desconectada');
    expect(sendMessage.mock.calls[0][1]).toEqual({ tipo: 'publiai:desconectar' });
  });

  it('lastError (extensão ausente) → nao_instalada', async () => {
    instalarChrome();
    sendMessage.mockImplementationOnce((_id, _msg, cb) => {
      lastError = { message: 'Could not establish connection.' };
      cb(undefined);
      lastError = undefined;
    });
    await expect(enviarSessaoParaExtensao(sessao)).resolves.toBe('nao_instalada');
  });

  it('sendMessage lançando → nao_instalada', async () => {
    instalarChrome();
    sendMessage.mockImplementationOnce(() => { throw new Error('Invalid extension id'); });
    await expect(enviarSessaoParaExtensao(sessao)).resolves.toBe('nao_instalada');
  });

  it('extensão recusa ({ ok: false }) → nao_instalada', async () => {
    instalarChrome();
    sendMessage.mockImplementationOnce((_id, _msg, cb) => cb({ ok: false }));
    await expect(enviarSessaoParaExtensao(sessao)).resolves.toBe('nao_instalada');
  });
});
