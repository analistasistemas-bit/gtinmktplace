import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chamarExtensao } from '../api';
import { obterSessaoValida } from '../sessao';
import { instalarChromeFalso, logar } from './chrome-falso';

const fetchFalso = vi.fn();

const conectar = async () => logar({ accessToken: 'tok-abc' });
const resposta = (status: number, corpo: unknown) =>
  new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status });

beforeEach(() => {
  instalarChromeFalso();
  vi.stubGlobal('fetch', fetchFalso);
  vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-publica');
  fetchFalso.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('chamarExtensao', () => {
  it('sem sessão → sem_sessao, sem chamar o servidor', async () => {
    expect(await chamarExtensao({ acao: 'analisar_anuncio' })).toEqual({ ok: false, erro: 'sem_sessao' });
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('renovação com falha transitória → interno, sem chamar a edge e sem perder a sessão', async () => {
    logar({ accessToken: 'tok-abc', expiresAt: Math.floor(Date.now() / 1000) + 10 });
    fetchFalso.mockResolvedValue(resposta(503, 'indisponível'));
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'interno' });
    expect(fetchFalso.mock.calls.map(([u]) => String(u))).toEqual(['https://proj.supabase.co/auth/v1/token?grant_type=refresh_token']);
    expect(await chrome.storage.local.get('credenciais')).toHaveProperty('credenciais');
  });

  it('POST na edge com Bearer + apikey', async () => {
    await conectar();
    fetchFalso.mockResolvedValue(resposta(200, { proprio: false }));
    expect(await chamarExtensao({ acao: 'analisar_anuncio', tipoPagina: 'anuncio' })).toEqual({ ok: true, dados: { proprio: false } });
    const [url, init] = fetchFalso.mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/functions/v1/extensao');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok-abc', apikey: 'anon-publica' });
    expect(JSON.parse(init.body)).toEqual({ acao: 'analisar_anuncio', tipoPagina: 'anuncio' });
  });

  it('sessao_expirada limpa a sessão', async () => {
    await conectar();
    fetchFalso.mockResolvedValue(resposta(401, { erro: 'sessao_expirada' }));
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'sessao_expirada' });
    expect(await obterSessaoValida()).toEqual({ erro: 'sem_sessao' });
  });

  it('401 do gateway (corpo fora do contrato) também é sessao_expirada', async () => {
    await conectar();
    fetchFalso.mockResolvedValue(resposta(401, { code: 401, message: 'Invalid JWT' }));
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'sessao_expirada' });
    expect(await obterSessaoValida()).toEqual({ erro: 'sem_sessao' });
  });

  it('401 de um token antigo não apaga a sessão nova empurrada durante a chamada', async () => {
    await conectar();
    fetchFalso.mockImplementation(async () => {
      logar({ accessToken: 'tok-novo' }); // renovação gravou outro par enquanto a chamada estava em voo
      return resposta(401, { code: 401, message: 'Invalid JWT' });
    });
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'sessao_expirada' });
    expect(await obterSessaoValida()).toEqual({ accessToken: 'tok-novo', identidade: 'u1:org1:' });
  });

  it('erros do contrato passam; a sessão fica', async () => {
    await conectar();
    fetchFalso.mockResolvedValue(resposta(429, { erro: 'limite', mensagem: 'Muitas análises em sequência. Aguarde um minuto.' }));
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'limite' });
    fetchFalso.mockResolvedValue(resposta(403, { erro: 'modulo_desligado' }));
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'modulo_desligado' });
    expect(await obterSessaoValida()).toEqual({ accessToken: 'tok-abc', identidade: 'u1:org1:' });
  });

  it('corpo fora do contrato, não-JSON ou falha de rede → interno', async () => {
    await conectar();
    fetchFalso.mockResolvedValue(resposta(500, { erro: 'toString' }));
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'interno' });
    fetchFalso.mockResolvedValue(resposta(502, '<html>Bad Gateway</html>'));
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'interno' });
    fetchFalso.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'interno' });
  });
});
