import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chamarExtensao } from '../api';
import { obterSessaoValida, receberMensagemExterna } from '../sessao';
import { instalarChromeFalso } from './chrome-falso';

const APP = { origin: 'https://app.publiai.daludi.com.br' } as chrome.runtime.MessageSender;
const fetchFalso = vi.fn();

async function conectar() {
  await receberMensagemExterna(
    { tipo: 'publiai:sessao', accessToken: 'tok-abc', expiresAt: Math.floor(Date.now() / 1000) + 3600, orgNome: 'Avil' },
    APP,
  );
}
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
    expect(await obterSessaoValida()).toBeNull();
  });

  it('401 do gateway (corpo fora do contrato) também é sessao_expirada', async () => {
    await conectar();
    fetchFalso.mockResolvedValue(resposta(401, { code: 401, message: 'Invalid JWT' }));
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'sessao_expirada' });
    expect(await obterSessaoValida()).toBeNull();
  });

  it('401 de um token antigo não apaga a sessão nova empurrada durante a chamada', async () => {
    await conectar();
    fetchFalso.mockImplementation(async () => {
      await receberMensagemExterna(
        { tipo: 'publiai:sessao', accessToken: 'tok-novo', expiresAt: Math.floor(Date.now() / 1000) + 3600, orgNome: 'Avil' },
        APP,
      );
      return resposta(401, { code: 401, message: 'Invalid JWT' });
    });
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'sessao_expirada' });
    expect(await obterSessaoValida()).toEqual({ accessToken: 'tok-novo' });
  });

  it('erros do contrato passam; a sessão fica', async () => {
    await conectar();
    fetchFalso.mockResolvedValue(resposta(429, { erro: 'limite', mensagem: 'Muitas análises em sequência. Aguarde um minuto.' }));
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'limite' });
    fetchFalso.mockResolvedValue(resposta(403, { erro: 'modulo_desligado' }));
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'modulo_desligado' });
    expect(await obterSessaoValida()).toEqual({ accessToken: 'tok-abc' });
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
