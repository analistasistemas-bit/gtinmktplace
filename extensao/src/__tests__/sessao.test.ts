import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eanDaAba, registrarEanDaAba } from '../abas';
import { obterSessaoValida, receberMensagemExterna } from '../sessao';
import { instalarChromeFalso } from './chrome-falso';

const APP = { origin: 'https://app.publiai.daludi.com.br' } as chrome.runtime.MessageSender;
const agoraSeg = () => Math.floor(Date.now() / 1000);
const sessao = (expiresAt = agoraSeg() + 3600) => ({
  tipo: 'publiai:sessao', accessToken: 'tok-abc', expiresAt, orgNome: 'Avil',
});

let dados: Record<string, unknown>;
beforeEach(() => { dados = instalarChromeFalso(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('receberMensagemExterna', () => {
  it('guarda só accessToken, expiresAt e orgNome vindos do app', async () => {
    expect(await receberMensagemExterna({ ...sessao(), refreshToken: 'nunca' }, APP)).toEqual({ ok: true });
    expect(await obterSessaoValida()).toEqual({ accessToken: 'tok-abc' });
    expect(JSON.stringify(dados)).not.toContain('nunca');
  });

  it.each([
    'https://app.publiai.daludi.com.br.evil.com',
    'https://evil.com',
    'http://app.publiai.daludi.com.br',
    'http://localhost:5173',
    undefined,
  ])('origem não autorizada (%s) é ignorada', async (origin) => {
    expect(await receberMensagemExterna(sessao(), { origin } as chrome.runtime.MessageSender)).toEqual({ ok: false });
    expect(await obterSessaoValida()).toBeNull();
  });

  it('localhost só vale quando o manifest (build dev) o lista', async () => {
    instalarChromeFalso(['https://app.publiai.daludi.com.br/*', 'http://localhost:5173/*']);
    const local = { origin: 'http://localhost:5173' } as chrome.runtime.MessageSender;
    expect(await receberMensagemExterna(sessao(), local)).toEqual({ ok: true });
  });

  it('payload malformado é ignorado', async () => {
    expect(await receberMensagemExterna({ ...sessao(), accessToken: '' }, APP)).toEqual({ ok: false });
    expect(await receberMensagemExterna({ ...sessao(), expiresAt: '123' }, APP)).toEqual({ ok: false });
    expect(await receberMensagemExterna({ ...sessao(), expiresAt: Date.now() + 3_600_000 }, APP)).toEqual({ ok: false }); // ms por engano
    expect(await receberMensagemExterna(null, APP)).toEqual({ ok: false });
    expect(await obterSessaoValida()).toBeNull();
  });

  it('desconectar apaga a sessão', async () => {
    await receberMensagemExterna(sessao(), APP);
    expect(await receberMensagemExterna({ tipo: 'publiai:desconectar' }, APP)).toEqual({ ok: true });
    expect(await obterSessaoValida()).toBeNull();
  });
});

describe('obterSessaoValida', () => {
  it('token a 20 s do fim → null (não renova)', async () => {
    await receberMensagemExterna(sessao(agoraSeg() + 20), APP);
    expect(await obterSessaoValida()).toBeNull();
  });

  it('token a 60 s do fim ainda vale', async () => {
    await receberMensagemExterna(sessao(agoraSeg() + 60), APP);
    expect(await obterSessaoValida()).toEqual({ accessToken: 'tok-abc' });
  });
});

describe('EAN por aba', () => {
  it('registra e lê por tabId', async () => {
    await registrarEanDaAba(7, '7899941205918');
    expect(await eanDaAba(7)).toBe('7899941205918');
    expect(await eanDaAba(8)).toBeNull();
  });
});

describe('sem refresh token no pacote', () => {
  it('nenhum fonte referencia o endpoint de token do Supabase', () => {
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
    for (const a of arquivos) {
      const t = readFileSync(a, 'utf8');
      for (const p of proibidos) expect(t.includes(p), `${a} contém ${p}`).toBe(false);
    }
  });
});
