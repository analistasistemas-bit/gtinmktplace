import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { entrar, estaLogado, sair, tokenValido } from '../credenciais';
import { instalarChromeFalso, local, logar } from './chrome-falso';

const fetchFalso = vi.fn();
const agoraSeg = () => Math.floor(Date.now() / 1000);
const par = (access = 'acc-novo', refresh = 'ref-novo') => new Response(JSON.stringify({
  access_token: access, refresh_token: refresh, expires_in: 3600, expires_at: agoraSeg() + 3600, token_type: 'bearer', user: { id: 'u1' },
}), { status: 200 });
const erroAuth = (status: number, code: string) => new Response(JSON.stringify({ code: status, error_code: code, msg: code }), { status });
const urls = () => fetchFalso.mock.calls.map(([u]) => String(u));
const refreshes = () => urls().filter((u) => u.endsWith('/auth/v1/token?grant_type=refresh_token'));

let sessao: Record<string, unknown>;
beforeEach(() => {
  sessao = instalarChromeFalso();
  vi.stubGlobal('fetch', fetchFalso);
  vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-publica');
  fetchFalso.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('entrar', () => {
  it('grava o par num único set, depois do setAccessLevel, e nunca grava a senha', async () => {
    fetchFalso.mockResolvedValue(par('acc-1', 'ref-1'));
    expect(await entrar('d@x.com', 's3nha-secreta')).toEqual({ ok: true });
    const [url, init] = fetchFalso.mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/auth/v1/token?grant_type=password');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ apikey: 'anon-publica' });
    expect(JSON.parse(init.body)).toEqual({ email: 'd@x.com', password: 's3nha-secreta' });
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
    expect(local.credenciais).toEqual({
      accessToken: 'acc-1', refreshToken: 'ref-1', expiresAt: agoraSeg() + 3600, userId: 'u1', identidade: null, perfil: null,
    });
    expect(JSON.stringify(local) + JSON.stringify(sessao)).not.toContain('s3nha-secreta');
    const nivel = vi.mocked(chrome.storage.local.setAccessLevel);
    expect(nivel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    expect(nivel.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(chrome.storage.local.set).mock.invocationCallOrder[0]);
    expect(await estaLogado()).toBe(true);
  });

  it('login sobe a geração da sessão (análises de antes saem das abas)', async () => {
    sessao['geracao-sessao'] = 4;
    fetchFalso.mockResolvedValue(par());
    await entrar('d@x.com', 's');
    expect(sessao['geracao-sessao']).toBe(5);
  });

  it('400 invalid_grant → credenciais_invalidas, nada gravado', async () => {
    fetchFalso.mockResolvedValue(erroAuth(400, 'invalid_credentials'));
    expect(await entrar('d@x.com', 'errada')).toEqual({ ok: false, erro: 'credenciais_invalidas' });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(await estaLogado()).toBe(false);
  });

  it('rede, 429, 5xx ou 200 fora do contrato → rede, nada gravado', async () => {
    fetchFalso.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetchFalso.mockResolvedValueOnce(erroAuth(429, 'over_request_rate_limit'));
    fetchFalso.mockResolvedValueOnce(new Response('<html>', { status: 503 }));
    fetchFalso.mockResolvedValueOnce(new Response('{"access_token":"x"}', { status: 200 }));
    for (let i = 0; i < 4; i++) expect(await entrar('d@x.com', 's')).toEqual({ ok: false, erro: 'rede' });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('setAccessLevel falha → não grava token (fail closed)', async () => {
    vi.mocked(chrome.storage.local.setAccessLevel).mockRejectedValueOnce(new Error('sem suporte'));
    fetchFalso.mockResolvedValue(par());
    expect(await entrar('d@x.com', 's')).toEqual({ ok: false, erro: 'rede' });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('sair durante o login em voo → a resposta do login não loga', async () => {
    let soltar!: (r: Response) => void;
    fetchFalso.mockImplementationOnce(() => new Promise<Response>((r) => { soltar = r; }));
    const login = entrar('d@x.com', 's');
    await vi.waitFor(() => expect(fetchFalso).toHaveBeenCalledTimes(1));
    fetchFalso.mockImplementation(async () => new Response(null, { status: 204 }));
    await sair();
    soltar(par());
    expect((await login).ok).toBe(false);
    expect(await estaLogado()).toBe(false);
  });
});

describe('tokenValido', () => {
  it('token válido → devolve sem chamar o servidor', async () => {
    logar();
    expect(await tokenValido()).toEqual({ accessToken: 'tok', identidade: 'u1:org1:' });
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('sem credenciais → sem_sessao', async () => {
    expect(await tokenValido()).toEqual({ erro: 'sem_sessao' });
  });

  it('token vencendo: duas chamadas simultâneas → um único POST de refresh, ambas recebem o access novo', async () => {
    logar({ expiresAt: agoraSeg() + 20 });
    fetchFalso.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 5)); return par(); });
    const [a, b] = await Promise.all([tokenValido(), tokenValido()]);
    expect(a).toEqual({ accessToken: 'acc-novo', identidade: 'u1:org1:' });
    expect(b).toEqual(a);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFalso.mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/auth/v1/token?grant_type=refresh_token');
    expect(init.headers).toMatchObject({ apikey: 'anon-publica' });
    expect(JSON.parse(init.body)).toEqual({ refresh_token: 'ref' });
    // Par gravado num único set; identidade e perfil preservados.
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
    expect(local.credenciais).toMatchObject({ accessToken: 'acc-novo', refreshToken: 'ref-novo', userId: 'u1', identidade: 'u1:org1:' });
  });

  it('expiração usa o relógio local + expires_in (relógio local atrasado não manda token vencido)', async () => {
    logar({ expiresAt: agoraSeg() - 10 });
    fetchFalso.mockResolvedValue(new Response(JSON.stringify({
      access_token: 'a', refresh_token: 'r', expires_in: 3600, expires_at: agoraSeg() - 100, user: { id: 'u1' },
    }), { status: 200 }));
    await tokenValido();
    expect((local.credenciais as { expiresAt: number }).expiresAt).toBe(agoraSeg() + 3600);
  });

  it.each([
    ['rede', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['429', async () => erroAuth(429, 'over_request_rate_limit')],
    ['503', async () => new Response('<html>', { status: 503 })],
    ['200 fora do contrato', async () => new Response('{"access_token":"x"}', { status: 200 })],
  ])('refresh com %s → transitorio, credenciais e geração intactas; a próxima tenta de novo', async (_n, resp) => {
    logar({ expiresAt: agoraSeg() + 20 });
    sessao['geracao-sessao'] = 3;
    const antes = structuredClone(local.credenciais);
    fetchFalso.mockImplementationOnce(resp);
    expect(await tokenValido()).toEqual({ erro: 'transitorio' });
    expect(local.credenciais).toEqual(antes);
    expect(sessao['geracao-sessao']).toBe(3);
    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
    fetchFalso.mockResolvedValueOnce(par());
    expect(await tokenValido()).toEqual({ accessToken: 'acc-novo', identidade: 'u1:org1:' });
    expect(refreshes()).toHaveLength(2);
  });

  it.each(['refresh_token_not_found', 'refresh_token_already_used', 'invalid_grant'])(
    'refresh 400 %s → deslogado: storage e abas limpos, sem logout remoto',
    async (code) => {
      logar({ expiresAt: agoraSeg() + 20 });
      sessao['geracao-sessao'] = 3;
      fetchFalso.mockResolvedValueOnce(erroAuth(400, code));
      expect(await tokenValido()).toEqual({ erro: 'sem_sessao' });
      expect(local.credenciais).toBeUndefined();
      expect(sessao['geracao-sessao']).toBe(4);
      expect(urls().some((u) => u.includes('/logout'))).toBe(false);
    },
  );

  it('renovação interrompida (SW morreu depois de o servidor rotacionar): refresh antigo recusado → sem_sessao, sem loop', async () => {
    logar({ expiresAt: agoraSeg() - 3600, refreshToken: 'ref-ja-rotacionado' });
    fetchFalso.mockResolvedValue(erroAuth(400, 'refresh_token_already_used'));
    expect(await tokenValido()).toEqual({ erro: 'sem_sessao' });
    expect(await tokenValido()).toEqual({ erro: 'sem_sessao' });
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it('reinício do Chrome com access vencido e refresh válido → renova e continua logado (nenhum alarme apaga)', async () => {
    logar({ expiresAt: agoraSeg() - 7200 });
    fetchFalso.mockResolvedValue(par());
    expect(await tokenValido()).toEqual({ accessToken: 'acc-novo', identidade: 'u1:org1:' });
    expect(await estaLogado()).toBe(true);
    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });
});

describe('sair', () => {
  it('limpa storage e abas antes do logout responder; logout é scope=local com o access atual', async () => {
    logar();
    sessao['geracao-sessao'] = 1;
    fetchFalso.mockImplementation(() => new Promise(() => {})); // rede nunca responde
    await sair();
    expect(local.credenciais).toBeUndefined();
    expect(sessao['geracao-sessao']).toBe(2);
    expect(await estaLogado()).toBe(false);
    const [url, init] = fetchFalso.mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/auth/v1/logout?scope=local');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ apikey: 'anon-publica', Authorization: 'Bearer tok' });
  });

  it('offline: sai localmente sem erro', async () => {
    logar();
    fetchFalso.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(sair()).resolves.toBeUndefined();
    expect(await estaLogado()).toBe(false);
  });

  it('durante uma renovação em voo → a resposta da renovação não restaura credenciais', async () => {
    logar({ expiresAt: agoraSeg() + 20 });
    let soltar!: (r: Response) => void;
    fetchFalso.mockImplementationOnce(() => new Promise<Response>((r) => { soltar = r; }));
    const renovacao = tokenValido();
    await vi.waitFor(() => expect(refreshes()).toHaveLength(1));
    fetchFalso.mockImplementation(async () => new Response(null, { status: 204 }));
    await sair(); // não espera a fila (a renovação está presa nela)
    expect(local.credenciais).toBeUndefined();
    soltar(par());
    expect(await renovacao).toEqual({ erro: 'sem_sessao' });
    expect(local.credenciais).toBeUndefined();
    expect(await estaLogado()).toBe(false);
  });
});

describe('boot do service worker', () => {
  async function bootar() {
    vi.resetModules();
    await import('../sw');
  }

  it('chama setAccessLevel TRUSTED_CONTEXTS antes de qualquer escrita, sem alarme e sem rede', async () => {
    sessao.sessao = { accessToken: 'tok-do-app' }; // garante escritas no boot
    await bootar();
    await vi.waitFor(() => expect(sessao.sessao).toBeUndefined());
    const nivel = vi.mocked(chrome.storage.local.setAccessLevel);
    await vi.waitFor(() => expect(nivel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' }));
    const primeira = nivel.mock.invocationCallOrder[0];
    for (const f of [chrome.storage.local.set, chrome.storage.local.remove, chrome.storage.session.set, chrome.storage.session.remove]) {
      for (const ordem of vi.mocked(f).mock.invocationCallOrder) expect(ordem).toBeGreaterThan(primeira);
    }
    expect(chrome.alarms.onAlarm.addListener).not.toHaveBeenCalled();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("sessão legada da 0.2.1 (chave 'sessao' em storage.session) é apagada; nunca vira credencial nem é revogada", async () => {
    sessao.sessao = { accessToken: 'tok-do-app', expiresAt: agoraSeg() + 3600, orgNome: 'Avil', identidade: 'u1:org1:' };
    sessao['geracao-sessao'] = 2;
    await bootar();
    await vi.waitFor(() => expect(sessao.sessao).toBeUndefined());
    await vi.waitFor(() => expect(sessao['geracao-sessao']).toBe(3)); // análises da sessão do app saem das abas
    expect(local.credenciais).toBeUndefined();
    expect(fetchFalso).not.toHaveBeenCalled();
    expect(await estaLogado()).toBe(false);
  });
});
