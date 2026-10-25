import type { Session } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const suporte = vi.hoisted(() => ({ context: null as null | { requestId: string; orgId: string; orgName: string }, orgPerfil: 'org-1' as string | null }));
vi.mock('@/stores/support-store', () => ({
  useSupportStore: { getState: () => ({ context: suporte.context }) },
  effectiveOrgId: () => suporte.context?.orgId ?? suporte.orgPerfil,
}));

import { enviarSessaoParaExtensao, pingExtensao } from '../extensao-ponte';

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
// Padrão: extensão 0.2.x que não conhece o ping ({ ok:false } sem versão) e aceita sessão/desconectar.
const padrao = (_id: string, msg: unknown, cb: Callback) =>
  cb((msg as { tipo: string }).tipo === 'publiai:ping' ? { ok: false } : { ok: true });
const sendMessage = vi.fn(padrao);
const enviadas = () => sendMessage.mock.calls.map(([, m]) => (m as { tipo: string }).tipo);

function instalarChrome() {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      get lastError() { return lastError; },
    },
  });
}

beforeEach(() => {
  suporte.context = null;
  suporte.orgPerfil = 'org-1';
  sendMessage.mockReset();
  sendMessage.mockImplementation(padrao);
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
    expect(enviadas()).toEqual(['publiai:ping', 'publiai:sessao']);
    const [id, msg] = sendMessage.mock.calls[1];
    expect(id).toBe('ext-id');
    expect(msg).toEqual({ tipo: 'publiai:sessao', accessToken: 'access-abc', expiresAt: 1_800_000_000, orgNome: '', identidade: 'u1:org-1:' });
    expect(JSON.stringify(msg)).not.toContain('refresh');
  });

  it('identidade = usuário:org:suporte; perfil carregando → org vazia; suporte → org e pedido do suporte', async () => {
    instalarChrome();
    suporte.orgPerfil = null;
    await enviarSessaoParaExtensao(sessao);
    expect(sendMessage.mock.calls[1][1]).toMatchObject({ identidade: 'u1::' });
    suporte.context = { requestId: 'req-9', orgId: 'org-s', orgName: 'Avil' };
    await enviarSessaoParaExtensao(sessao);
    expect(sendMessage.mock.calls[3][1]).toMatchObject({ identidade: 'u1:org-s:req-9', orgNome: 'Avil' });
  });

  it('sem sessão envia publiai:desconectar', async () => {
    instalarChrome();
    await expect(enviarSessaoParaExtensao(null)).resolves.toBe('desconectada');
    expect(sendMessage.mock.calls[1][1]).toEqual({ tipo: 'publiai:desconectar' });
  });

  it('lastError (extensão ausente) → nao_instalada', async () => {
    instalarChrome();
    sendMessage.mockImplementation((_id, _msg, cb) => {
      lastError = { message: 'Could not establish connection.' };
      cb(undefined);
      lastError = undefined;
    });
    await expect(enviarSessaoParaExtensao(sessao)).resolves.toBe('nao_instalada');
  });

  it('sendMessage lançando → nao_instalada', async () => {
    instalarChrome();
    sendMessage.mockImplementation(() => { throw new Error('Invalid extension id'); });
    await expect(enviarSessaoParaExtensao(sessao)).resolves.toBe('nao_instalada');
  });

  it('extensão recusa ({ ok: false }) → nao_instalada', async () => {
    instalarChrome();
    sendMessage.mockImplementation((_id, _msg, cb) => cb({ ok: false }));
    await expect(enviarSessaoParaExtensao(sessao)).resolves.toBe('nao_instalada');
  });
});

describe('protocolo da extensão (ping)', () => {
  const ping2 = (_id: string, msg: unknown, cb: Callback) =>
    cb((msg as { tipo: string }).tipo === 'publiai:ping' ? { ok: true, versao: '0.3.0', protocolo: 2 } : { ok: true });

  it('pingExtensao devolve versão e protocolo; 0.2.1 real ({ ok:false }) e ausente → null', async () => {
    instalarChrome();
    sendMessage.mockImplementation(ping2);
    await expect(pingExtensao()).resolves.toEqual({ versao: '0.3.0', protocolo: 2 });
    sendMessage.mockImplementation((_id, _msg, cb) => cb({ ok: false }));
    await expect(pingExtensao()).resolves.toBeNull();
    sendMessage.mockImplementation((_id, _msg, cb) => { lastError = { message: 'x' }; cb(undefined); lastError = undefined; });
    await expect(pingExtensao()).resolves.toBeNull();
  });

  it('protocolo 2 → não envia sessão nem desconectar (o app não manda mais credencial)', async () => {
    instalarChrome();
    sendMessage.mockImplementation(ping2);
    await expect(enviarSessaoParaExtensao(sessao)).resolves.toBe('ok');
    await expect(enviarSessaoParaExtensao(null)).resolves.toBe('desconectada');
    expect(enviadas()).toEqual(['publiai:ping', 'publiai:ping']);
  });

  it('0.2.1 real: ping { ok:false } sem versão → legado: mantém o envio de sessão e de desconectar', async () => {
    instalarChrome();
    await enviarSessaoParaExtensao(sessao);
    await enviarSessaoParaExtensao(null);
    expect(enviadas()).toEqual(['publiai:ping', 'publiai:sessao', 'publiai:ping', 'publiai:desconectar']);
  });

  it('0.2.x que responde ok sem protocolo → comportamento atual', async () => {
    instalarChrome();
    sendMessage.mockImplementation((_id, msg, cb) =>
      cb((msg as { tipo: string }).tipo === 'publiai:ping' ? { ok: true, versao: '0.2.1' } : { ok: true }));
    await expect(enviarSessaoParaExtensao(sessao)).resolves.toBe('ok');
    expect(enviadas()).toEqual(['publiai:ping', 'publiai:sessao']);
  });
});
