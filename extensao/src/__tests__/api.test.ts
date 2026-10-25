import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { geracaoAtual } from '../abas';
import { atualizarSessao, chamarExtensao } from '../api';
import { entrar, sair } from '../credenciais';
import { definirIdentidade, identidadeAtual, obterSessaoValida, perfilAtual } from '../sessao';
import { instalarChromeFalso, local, logar } from './chrome-falso';

const fetchFalso = vi.fn();

const conectar = async () => logar({ accessToken: 'tok-abc' });
const resposta = (status: number, corpo: unknown) =>
  new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status });
const envelope = (dados: unknown, identidade = 'u1:org1:') => resposta(200, { identidade, dados });
const PERFIL2 = { nome: 'Diego', email: 'd@x.com', orgNome: 'Outra' };
const corpoDe = (i: number) => JSON.parse(fetchFalso.mock.calls[i][1].body);
let sessao: Record<string, unknown>;

beforeEach(() => {
  sessao = instalarChromeFalso();
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

  it('envia protocolo 2 e identidadeEsperada; desembrulha dados', async () => {
    await conectar();
    fetchFalso.mockResolvedValue(envelope({ proprio: false }));
    expect(await chamarExtensao({ acao: 'analisar_anuncio', tipoPagina: 'anuncio' })).toEqual({ ok: true, dados: { proprio: false } });
    const [url, init] = fetchFalso.mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/functions/v1/extensao');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok-abc', apikey: 'anon-publica' });
    expect(corpoDe(0)).toEqual({ acao: 'analisar_anuncio', tipoPagina: 'anuncio', protocolo: 2, identidadeEsperada: 'u1:org1:' });
  });

  it('corpo não sobrescreve protocolo nem identidadeEsperada', async () => {
    await conectar();
    fetchFalso.mockResolvedValue(envelope({ ok: 1 }));
    await chamarExtensao({ acao: 'x', protocolo: 1, identidadeEsperada: 'u9:org9:' });
    expect(corpoDe(0)).toMatchObject({ protocolo: 2, identidadeEsperada: 'u1:org1:' });
  });

  it('200 fora do envelope (sem identidade) → interno, dados não entregues', async () => {
    await conectar();
    fetchFalso.mockResolvedValue(resposta(200, { proprio: false }));
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'interno' });
  });

  it('resposta com identidade diferente da guardada → limpa abas, atualiza identidade, devolve identidade_mudou', async () => {
    await conectar();
    const g0 = await geracaoAtual(); // geração sobe = estados das abas invalidados
    fetchFalso
      .mockResolvedValueOnce(envelope({ custo: 'org2' }, 'u1:org2:'))
      .mockResolvedValueOnce(envelope(PERFIL2, 'u1:org2:'));
    const g = await geracaoAtual();
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'identidade_mudou' });
    expect(await geracaoAtual()).toBeGreaterThan(g);
    expect(await geracaoAtual()).toBeGreaterThan(g0);
    expect(await identidadeAtual()).toBe('u1:org2:');
    expect(await perfilAtual()).toEqual(PERFIL2);
  });

  it('identidade diferente no 200 e a sessao falha → abas limpas mesmo assim', async () => {
    await conectar();
    const g0 = await geracaoAtual(); // geração sobe = estados das abas invalidados
    fetchFalso
      .mockResolvedValueOnce(envelope({ custo: 'org2' }, 'u1:org2:'))
      .mockResolvedValueOnce(resposta(500, { erro: 'interno', identidade: 'u1:org2:' }));
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'identidade_mudou' });
    expect(await geracaoAtual()).toBeGreaterThan(g0);
  });

  it('409 identidade_mudou → chama sessao uma vez e limpa abas; não reexecuta a ação', async () => {
    await conectar();
    const g0 = await geracaoAtual(); // geração sobe = estados das abas invalidados
    fetchFalso
      .mockResolvedValueOnce(resposta(409, { erro: 'identidade_mudou', identidade: 'u1:org2:' }))
      .mockResolvedValueOnce(envelope(PERFIL2, 'u1:org2:'));
    const g = await geracaoAtual();
    expect(await chamarExtensao({ acao: 'salvar_vinculo' })).toEqual({ ok: false, erro: 'identidade_mudou' });
    expect(fetchFalso).toHaveBeenCalledTimes(2);
    expect(corpoDe(1)).toEqual({ acao: 'sessao', protocolo: 2 });
    expect(await geracaoAtual()).toBeGreaterThan(g);
    expect(await geracaoAtual()).toBeGreaterThan(g0);
    expect(await identidadeAtual()).toBe('u1:org2:');
  });

  it('identidade ainda desconhecida (recém-logado) → busca sessao antes e manda a identidade dela', async () => {
    logar({ accessToken: 'tok-abc', identidade: null, perfil: null });
    fetchFalso
      .mockResolvedValueOnce(envelope(PERFIL2, 'u1:org2:'))
      .mockResolvedValueOnce(envelope({ ok: 1 }, 'u1:org2:'));
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: true, dados: { ok: 1 } });
    expect(corpoDe(0)).toEqual({ acao: 'sessao', protocolo: 2 });
    expect(corpoDe(1)).toEqual({ acao: 'x', protocolo: 2, identidadeEsperada: 'u1:org2:' });
  });

  it('identidade desconhecida e sessao falha → devolve o erro dela sem chamar a ação', async () => {
    logar({ accessToken: 'tok-abc', identidade: null, perfil: null });
    fetchFalso.mockResolvedValueOnce(resposta(403, { erro: 'modulo_desligado', identidade: 'u1:org2:' }));
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'modulo_desligado' });
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it('resposta que chega depois de sair/entrar (geração mudou) é descartada', async () => {
    await conectar();
    fetchFalso.mockImplementation(async () => {
      sessao['geracao-sessao'] = ((sessao['geracao-sessao'] as number | undefined) ?? 0) + 1; // sair+entrar, mesma conta/org
      return envelope({ custo: 'antigo' });
    });
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'sem_sessao' });
  });

  it('401 → deslogado (sair local) e erro sessao_expirada', async () => {
    await conectar();
    const g0 = await geracaoAtual(); // geração sobe = estados das abas invalidados
    fetchFalso.mockResolvedValue(resposta(401, { code: 401, message: 'Invalid JWT' }));
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'sessao_expirada' });
    expect(await obterSessaoValida()).toEqual({ erro: 'sem_sessao' });
    expect(await geracaoAtual()).toBeGreaterThan(g0);
    expect(fetchFalso).toHaveBeenCalledTimes(1); // sem logout remoto: o token já foi recusado
  });

  it('sessao_expirada limpa a sessão', async () => {
    await conectar();
    fetchFalso.mockResolvedValue(resposta(401, { erro: 'sessao_expirada' }));
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'sessao_expirada' });
    expect(await obterSessaoValida()).toEqual({ erro: 'sem_sessao' });
  });

  it('401 de um token antigo não apaga a sessão nova gravada durante a chamada', async () => {
    await conectar();
    fetchFalso.mockImplementation(async () => {
      logar({ accessToken: 'tok-novo' }); // renovação gravou outro par enquanto a chamada estava em voo
      return resposta(401, { code: 401, message: 'Invalid JWT' });
    });
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'sessao_expirada' });
    expect(await obterSessaoValida()).toEqual({ accessToken: 'tok-novo', identidade: 'u1:org1:' });
  });

  it('sem_acesso de uma ação não desloga (suporte só-leitura tentando escrever)', async () => {
    await conectar();
    fetchFalso.mockResolvedValue(resposta(403, { erro: 'sem_acesso', identidade: 'u1:org1:' }));
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'sem_acesso' });
    expect(await identidadeAtual()).toBe('u1:org1:');
  });

  it('erros do contrato passam; a sessão fica', async () => {
    await conectar();
    fetchFalso.mockResolvedValue(resposta(429, { erro: 'limite', mensagem: 'Muitas análises em sequência. Aguarde um minuto.', identidade: 'u1:org1:' }));
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'limite' });
    fetchFalso.mockResolvedValue(resposta(403, { erro: 'modulo_desligado', identidade: 'u1:org1:' }));
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

describe('atualizarSessao', () => {
  it('sem sessão → false sem rede', async () => {
    expect(await atualizarSessao()).toBe(false);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('grava identidade e perfil; null → identidade não limpa as abas', async () => {
    logar({ identidade: null, perfil: null });
    fetchFalso.mockResolvedValue(envelope(PERFIL2, 'u1:org1:'));
    const g = await geracaoAtual();
    expect(await atualizarSessao()).toBe(true);
    expect(await identidadeAtual()).toBe('u1:org1:');
    expect(await perfilAtual()).toEqual(PERFIL2);
    expect(await geracaoAtual()).toBe(g);
    expect(corpoDe(0)).toEqual({ acao: 'sessao', protocolo: 2 });
  });

  it('identidade nova → limpa as abas', async () => {
    logar();
    const g0 = await geracaoAtual(); // geração sobe = estados das abas invalidados
    fetchFalso.mockResolvedValue(envelope(PERFIL2, 'u1:org2:'));
    expect(await atualizarSessao()).toBe(true);
    expect(await geracaoAtual()).toBeGreaterThan(g0);
    expect(await identidadeAtual()).toBe('u1:org2:');
  });

  it('sem_acesso → sai e false', async () => {
    logar();
    fetchFalso.mockResolvedValue(resposta(403, { erro: 'sem_acesso' }));
    expect(await atualizarSessao()).toBe(false);
    expect(await obterSessaoValida()).toEqual({ erro: 'sem_sessao' });
  });

  it('401 → deslogado e false', async () => {
    logar();
    fetchFalso.mockResolvedValue(resposta(401, { erro: 'sessao_expirada' }));
    expect(await atualizarSessao()).toBe(false);
    expect(await obterSessaoValida()).toEqual({ erro: 'sem_sessao' });
  });

  it('erro transitório (500) → false e identidade intacta', async () => {
    logar();
    fetchFalso.mockResolvedValue(resposta(500, { erro: 'interno', identidade: 'u1:org1:' }));
    expect(await atualizarSessao()).toBe(false);
    expect(await identidadeAtual()).toBe('u1:org1:');
  });

  it('resposta de sessao depois de sair/entrar é descartada', async () => {
    logar({ identidade: null, perfil: null });
    fetchFalso.mockImplementation(async () => {
      sessao['geracao-sessao'] = ((sessao['geracao-sessao'] as number | undefined) ?? 0) + 1;
      return envelope(PERFIL2, 'u1:org2:');
    });
    expect(await atualizarSessao()).toBe(false);
    expect(await identidadeAtual()).toBeNull();
  });
});

// Fix round 1 (Codex): sair()/entrar() reais com o mesmo usuário no meio da chamada.
describe('sair/entrar durante a chamada', () => {
  const EDGE = '/functions/v1/extensao';
  const chamadasEdge = () => fetchFalso.mock.calls.filter(([u]) => String(u).endsWith(EDGE));
  // Auth real (credenciais.ts) com fetch controlado: logout ok; login devolve outro par do mesmo usuário.
  const auth = (edge: () => Response) => fetchFalso.mockImplementation(async (u: string) => {
    if (String(u).includes('/auth/v1/logout')) return new Response(null, { status: 204 });
    if (String(u).includes('grant_type=password')) {
      return resposta(200, { access_token: 'tok-novo', refresh_token: 'ref-novo', expires_in: 3600, user: { id: 'u1' } });
    }
    return edge();
  });
  const sairEntrar = async () => {
    await sair();
    expect(await entrar('d@x.com', 'senha')).toEqual({ ok: true });
  };

  it('troca depois de obter o token: a ação não sai com o token antigo nem entrega o resultado', async () => {
    await conectar();
    auth(() => envelope({ ok: 1 }));
    // Arma a troca na 1ª leitura da geração da sessão feita DEPOIS de o token ser lido.
    const getLocal = chrome.storage.local.get;
    const getSessao = chrome.storage.session.get;
    let tokenLido = false;
    let armado = true;
    chrome.storage.local.get = vi.fn(async (k: string | string[] | null) => { tokenLido = true; return getLocal(k); }) as never;
    chrome.storage.session.get = vi.fn(async (k: string | string[] | null) => {
      if (armado && tokenLido && k === 'geracao-sessao') {
        armado = false;
        await sairEntrar();
        await definirIdentidade('u1:org1:', PERFIL2); // nova sessão já com a mesma identidade
      }
      return getSessao(k);
    }) as never;
    expect(await chamarExtensao({ acao: 'salvar_vinculo' })).toEqual({ ok: false, erro: 'sem_sessao' });
    expect(armado).toBe(false);
    expect(chamadasEdge().filter(([, i]) => i.headers.Authorization === 'Bearer tok-abc')).toEqual([]);
  });

  it('troca entre a checagem da resposta da sessao e a gravação: identidade/perfil antigos não vão para as credenciais novas', async () => {
    logar({ accessToken: 'tok-abc', identidade: null, perfil: null });
    let respondeu = false;
    auth(() => { respondeu = true; return envelope(PERFIL2, 'u1:org1:'); });
    // Arma a troca na 1ª leitura das credenciais depois da resposta da edge (checagem final de postar).
    const getLocal = chrome.storage.local.get;
    let armado = true;
    chrome.storage.local.get = vi.fn(async (k: string | string[] | null) => {
      const v = await getLocal(k);
      if (armado && respondeu) { armado = false; await sairEntrar(); }
      return v;
    }) as never;
    expect(await atualizarSessao()).toBe(false);
    expect(armado).toBe(false);
    expect(local.credenciais).toMatchObject({ accessToken: 'tok-novo', identidade: null, perfil: null });
  });
});
