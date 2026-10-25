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
});

// Fix rounds 1–3 (Codex): sair()/entrar() reais e troca de org no meio da chamada. A decisão é a época em memória
// (abas.ts: epocaAtual), que sobe síncrona em sair, entrar, troca de identidade e limpeza das abas.
describe('sair/entrar e troca de org durante a chamada', () => {
  const EDGE = '/functions/v1/extensao';
  const comTokAntigo = () => fetchFalso.mock.calls.filter(([u, i]) => String(u).endsWith(EDGE) && i.headers.Authorization === 'Bearer tok-abc');
  // Auth real (credenciais.ts) com fetch controlado: logout ok; login devolve outro par do mesmo usuário.
  const auth = (edge: () => unknown) => fetchFalso.mockImplementation(async (u: string) => {
    if (String(u).includes('/auth/v1/logout')) return new Response(null, { status: 204 });
    if (String(u).includes('grant_type=password')) {
      return resposta(200, { access_token: 'tok-novo', refresh_token: 'ref-novo', expires_in: 3600, user: { id: 'u1' } });
    }
    return edge();
  });
  const entrarDeNovo = async () => { expect(await entrar('d@x.com', 'senha')).toEqual({ ok: true }); };
  const TROCAS: Record<string, () => Promise<unknown>> = {
    // sessão nova com a MESMA identidade: só a época distingue
    'sair/entrar (mesma identidade)': async () => { await sair(); await entrarDeNovo(); await definirIdentidade('u1:org1:', PERFIL2); },
    'troca de org': () => definirIdentidade('u1:org2:', PERFIL2),
  };

  describe.each(Object.keys(TROCAS))('%s', (nome) => {
    const troca = TROCAS[nome];

    it('com a ação em voo → resposta descartada', async () => {
      await conectar();
      auth(async () => { await troca(); return envelope({ custo: 'org1' }); });
      expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'sem_sessao' });
    });

    it('enquanto o corpo da resposta é lido → descartada', async () => {
      await conectar();
      auth(() => ({ ok: true, status: 200, json: async () => { await troca(); return { identidade: 'u1:org1:', dados: { custo: 'org1' } }; } }));
      expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'sem_sessao' });
    });
  });

  it('troca de org: época sobe antes de a identidade nova ficar visível (resposta aceita entre o set e a limpeza)', async () => {
    await conectar();
    const set = chrome.storage.local.set;
    let liberar!: () => void;
    const gravouOrg2 = new Promise<void>((ok) => { liberar = ok; });
    chrome.storage.local.set = vi.fn(async (o: Record<string, unknown>) => {
      await set(o);
      if ((o.credenciais as { identidade?: string } | undefined)?.identidade === 'u1:org2:') {
        liberar();
        await new Promise((ok) => setTimeout(ok, 0)); // definirIdentidade fica parada depois do set
      }
    }) as never;
    auth(async () => {
      void definirIdentidade('u1:org2:', PERFIL2);
      await gravouOrg2;
      return envelope({ custo: 'org1' });
    });
    expect(await chamarExtensao({ acao: 'x' })).toEqual({ ok: false, erro: 'sem_sessao' });
  });

  it('sair/entrar durante a leitura do token: nada sai com o token antigo', async () => {
    await conectar();
    auth(() => envelope({ ok: 1 }));
    const getLocal = chrome.storage.local.get;
    let pendente: Promise<unknown> | undefined;
    chrome.storage.local.get = vi.fn(async (k: string | string[] | null) => {
      const v = await getLocal(k); // credenciais de antes da troca
      if (!pendente) {
        // Dentro da fila (tokenValido): sair roda fora dela; o login entra na fila depois.
        pendente = (async () => { await sair(); await entrarDeNovo(); await definirIdentidade('u1:org1:', PERFIL2); })();
      }
      return v;
    }) as never;
    expect(await chamarExtensao({ acao: 'salvar_vinculo' })).toEqual({ ok: false, erro: 'sem_sessao' });
    await pendente;
    expect(comTokAntigo()).toEqual([]);
  });

  // RED no código do fix round 2 (2ª leitura = GERACAO_SESSAO): org trocada com a leitura em andamento.
  it.each([1, 2, 3])('troca de org durante a %iª leitura de storage depois da resposta: dado da org anterior nunca sai como ok', async (n) => {
    await conectar();
    let respondeu = false;
    let leituras = 0;
    let terminou = false;
    fetchFalso.mockImplementation(async () => { respondeu = true; return envelope({ custo: 'org1' }); });
    const r = { armado: true };
    for (const area of [chrome.storage.local, chrome.storage.session]) {
      const get = area.get;
      area.get = vi.fn(async (k: string | string[] | null) => {
        const v = await get(k); // valor de antes da troca
        if (r.armado && respondeu && !terminou && ++leituras === n) {
          r.armado = false;
          expect(await definirIdentidade('u1:org2:', PERFIL2)).toBe(true);
        }
        return v;
      }) as never;
    }
    const res = await chamarExtensao({ acao: 'x' });
    terminou = true;
    const identidadeNoRetorno = (local.credenciais as { identidade: string }).identidade;
    if (res.ok) expect(identidadeNoRetorno).toBe('u1:org1:');
    else expect(res).toEqual({ ok: false, erro: 'sem_sessao' });
  });

  it('atualizarSessao: sair/entrar com a sessao em voo → false; credenciais novas sem identidade', async () => {
    logar({ accessToken: 'tok-abc', identidade: null, perfil: null });
    auth(async () => { await sair(); await entrarDeNovo(); return envelope(PERFIL2, 'u1:org1:'); });
    expect(await atualizarSessao()).toBe(false);
    expect(local.credenciais).toMatchObject({ accessToken: 'tok-novo', identidade: null, perfil: null });
  });

  it('atualizarSessao: saída entre a aceitação da resposta e a gravação → identidade/perfil antigos não vão para as credenciais novas', async () => {
    logar({ accessToken: 'tok-abc', identidade: null, perfil: null });
    let respondeu = false;
    auth(() => { respondeu = true; return envelope(PERFIL2, 'u1:org1:'); });
    // 1ª leitura das credenciais depois da resposta = a de definirIdentidade (na fila): sair (fora da fila) ali.
    const getLocal = chrome.storage.local.get;
    let pendente: Promise<unknown> | undefined;
    chrome.storage.local.get = vi.fn(async (k: string | string[] | null) => {
      const v = await getLocal(k);
      if (respondeu && !pendente) pendente = (async () => { await sair(); await entrarDeNovo(); })();
      return v;
    }) as never;
    expect(await atualizarSessao()).toBe(false);
    await pendente;
    expect(local.credenciais).toMatchObject({ accessToken: 'tok-novo', identidade: null, perfil: null });
  });
});
