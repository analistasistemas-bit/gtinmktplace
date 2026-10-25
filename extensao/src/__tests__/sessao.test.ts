import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eanDaAba, registrarEanDaAba } from '../abas';
import { definirIdentidade, identidadeAtual, limparSessao, obterSessaoValida, perfilAtual, receberMensagemExterna } from '../sessao';
import { sair } from '../credenciais';
import { instalarChromeFalso, local, logar } from './chrome-falso';

const APP = { origin: 'https://app.publiai.daludi.com.br' } as chrome.runtime.MessageSender;
const PERFIL = { nome: 'Diego', email: 'd@x.com', orgNome: 'Avil' };
const fetchFalso = vi.fn();

let dados: Record<string, unknown>;
beforeEach(() => {
  dados = instalarChromeFalso();
  vi.stubGlobal('fetch', fetchFalso);
  fetchFalso.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('receberMensagemExterna (0.3.0: o app deixou de ser fonte de sessão)', () => {
  it('publiai:ping responde versão e protocolo 2', async () => {
    expect(await receberMensagemExterna({ tipo: 'publiai:ping' }, APP)).toEqual({ ok: true, versao: chrome.runtime.getManifest().version, protocolo: 2 });
  });

  it('publiai:sessao é ignorado: nada gravado, nada revogado', async () => {
    const msg = { tipo: 'publiai:sessao', accessToken: 'tok-do-app', expiresAt: Math.floor(Date.now() / 1000) + 3600, orgNome: 'Avil', identidade: 'u1:org1:' };
    expect(await receberMensagemExterna(msg, APP)).toEqual({ ok: false });
    expect(await obterSessaoValida()).toEqual({ erro: 'sem_sessao' });
    expect(JSON.stringify(local) + JSON.stringify(dados)).not.toContain('tok-do-app');
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('publiai:desconectar do app não desloga a sessão própria', async () => {
    logar();
    expect(await receberMensagemExterna({ tipo: 'publiai:desconectar' }, APP)).toEqual({ ok: false });
    expect(await obterSessaoValida()).toEqual({ accessToken: 'tok', identidade: 'u1:org1:' });
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});

describe('identidade e perfil', () => {
  it('logado sem identidade ainda (antes da ação sessao): token válido, identidade e perfil null', async () => {
    logar({ identidade: null, perfil: null });
    expect(await obterSessaoValida()).toEqual({ accessToken: 'tok', identidade: null });
    expect(await identidadeAtual()).toBeNull();
    expect(await perfilAtual()).toBeNull();
  });

  it('definirIdentidade grava identidade e perfil; a 1ª não limpa as abas', async () => {
    logar({ identidade: null, perfil: null });
    await registrarEanDaAba(7, '7899941205918');
    expect(await definirIdentidade('u1:org1:', PERFIL)).toBe(true);
    expect(await identidadeAtual()).toBe('u1:org1:');
    expect(await perfilAtual()).toEqual(PERFIL);
    expect(await eanDaAba(7)).toBe('7899941205918');
    expect(local.credenciais).toMatchObject({ accessToken: 'tok', refreshToken: 'ref' });
  });

  it('identidade conhecida que muda (org ou suporte) limpa as abas; a mesma não', async () => {
    logar();
    await registrarEanDaAba(7, '7899941205918');
    await definirIdentidade('u1:org1:', PERFIL);
    expect(await eanDaAba(7)).toBe('7899941205918');
    await definirIdentidade('u1:org1:req9', PERFIL);
    expect(await eanDaAba(7)).toBeNull();
  });

  it('ignorada sem credenciais, malformada ou de outro usuário', async () => {
    expect(await definirIdentidade('u1:org1:', PERFIL)).toBe(false);
    expect(local.credenciais).toBeUndefined();
    logar();
    for (const id of ['u2:org1:', '', ':org1:', 'u1:org 1:', 1 as never]) expect(await definirIdentidade(id, PERFIL)).toBe(false);
    expect(await identidadeAtual()).toBe('u1:org1:');
  });

  it('sair entre a resposta da ação sessao e a gravação → identidade não ressuscita as credenciais', async () => {
    logar({ identidade: null });
    fetchFalso.mockResolvedValue(new Response(null, { status: 204 }));
    let soltar!: () => void;
    const get = chrome.storage.local.get;
    let armado = true;
    chrome.storage.local.get = vi.fn(async (k: string | string[] | null) => {
      const v = await get(k);
      if (armado) { armado = false; await new Promise<void>((r) => { soltar = r; }); }
      return v;
    }) as never;
    const definicao = definirIdentidade('u1:org1:', PERFIL);
    await vi.waitFor(() => expect(soltar).toBeDefined());
    await sair();
    soltar();
    expect(await definicao).toBe(false);
    expect(local.credenciais).toBeUndefined();
  });
});

describe('limparSessao (401 da edge)', () => {
  it('apaga credenciais e abas', async () => {
    logar();
    await registrarEanDaAba(7, '7899941205918');
    await limparSessao('tok');
    expect(local.credenciais).toBeUndefined();
    expect(await eanDaAba(7)).toBeNull();
  });

  it('seAinda de outro token (renovado durante a chamada) → mantém', async () => {
    logar({ accessToken: 'tok-renovado' });
    await limparSessao('tok');
    expect(await obterSessaoValida()).toEqual({ accessToken: 'tok-renovado', identidade: 'u1:org1:' });
  });
});

describe('EAN por aba', () => {
  it('registra e lê por tabId', async () => {
    await registrarEanDaAba(7, '7899941205918');
    expect(await eanDaAba(7)).toBe('7899941205918');
    expect(await eanDaAba(8)).toBeNull();
  });
});

describe('refresh token só em credenciais.ts', () => {
  it('nenhum outro fonte referencia o endpoint de token do Supabase; supabase-js em nenhum', () => {
    const proibidos = ['refresh' + '_token', '/auth/v1/' + 'token', '@supabase/' + 'supabase-js'];
    const raiz = path.resolve(__dirname, '..');
    const arquivos: string[] = [];
    const andar = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        if (statSync(p).isDirectory()) andar(p);
        else arquivos.push(p);
      }
    };
    andar(raiz); // o que vem de _shared e entra no bundle é coberto pelo scripts/checar-dist.mjs
    expect(arquivos.length).toBeGreaterThan(3);
    // Só o SW importa credenciais.ts; scripts/checar-dist.mjs garante que o código só chega ao sw.js.
    const permitido = (a: string, p: string) => !p.includes('supabase') && (a === path.join(raiz, 'credenciais.ts') || a.includes(`${path.sep}__tests__${path.sep}`));
    for (const a of arquivos) {
      const t = readFileSync(a, 'utf8');
      for (const p of proibidos) if (!permitido(a, p)) expect(t.includes(p), `${a} contém ${p}`).toBe(false);
    }
    expect(readFileSync(path.join(raiz, 'credenciais.ts'), 'utf8')).toContain('/auth/v1/' + 'token');
  });
});
