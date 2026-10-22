import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eanDaAba, registrarEanDaAba } from '../abas';
import { aoAlarme, limparSessao, obterSessaoValida, receberMensagemExterna } from '../sessao';
import { instalarChromeFalso } from './chrome-falso';

const APP = { origin: 'https://app.publiai.daludi.com.br' } as chrome.runtime.MessageSender;
const agoraSeg = () => Math.floor(Date.now() / 1000);
const sessao = (expiresAt = agoraSeg() + 3600) => ({
  tipo: 'publiai:sessao', accessToken: 'tok-abc', expiresAt, orgNome: 'Avil', identidade: 'u1:org1:',
});

let dados: Record<string, unknown>;
beforeEach(() => { dados = instalarChromeFalso(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('receberMensagemExterna', () => {
  it('guarda só accessToken, expiresAt, orgNome e identidade vindos do app', async () => {
    expect(await receberMensagemExterna({ ...sessao(), refreshToken: 'nunca' }, APP)).toEqual({ ok: true });
    expect(await obterSessaoValida()).toEqual({ accessToken: 'tok-abc', identidade: 'u1:org1:' });
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
    expect(await obterSessaoValida()).toEqual({ accessToken: 'tok-abc', identidade: 'u1:org1:' });
  });
});

describe('expiração passiva × fila única (ADR-0189 D-4)', () => {
  const T0 = 1_800_000_000_000; // segundo cheio: expiresAt*1000 bate com o relógio
  const SEG0 = T0 / 1000;
  let alarmes: Map<string, number>;
  let liberar: () => void;
  let portao: Promise<void>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    alarmes = new Map();
    portao = Promise.resolve();
    chrome.alarms.create = vi.fn(async (n: string, i: { when: number }) => { alarmes.set(n, i.when); }) as never;
    chrome.alarms.clear = vi.fn(async (n: string) => { await portao; return alarmes.delete(n); }) as never;
  });
  afterEach(() => { vi.useRealTimers(); });
  const fecharPortao = () => { portao = new Promise((r) => { liberar = r; }); };
  const sess = (tok: string, exp: number) => ({ tipo: 'publiai:sessao', accessToken: tok, expiresAt: exp, orgNome: 'Avil', identidade: 'u1:org1:' });

  it('alarme exatamente no agendado (restam 30 000 ms) → limpa tudo', async () => {
    await receberMensagemExterna(sess('A', SEG0 + 120), APP);
    await registrarEanDaAba(7, '7899941205918');
    expect(alarmes.get('sessao-expira')).toBe(T0 + 90_000);
    vi.setSystemTime(T0 + 90_000);
    await aoAlarme({ name: 'sessao-expira' } as chrome.alarms.Alarm);
    expect(dados.sessao).toBeUndefined();
    expect(await eanDaAba(7)).toBeNull();
    expect(alarmes.size).toBe(0);
  });

  it('alarme adiantado com sessão válida → nada apagado e alarme reagendado', async () => {
    await receberMensagemExterna(sess('A', SEG0 + 120), APP);
    alarmes.clear();
    vi.setSystemTime(T0 + 89_000);
    await aoAlarme({ name: 'sessao-expira' } as chrome.alarms.Alarm);
    expect((dados.sessao as { accessToken: string }).accessToken).toBe('A');
    expect(alarmes.get('sessao-expira')).toBe(T0 + 90_000);
  });

  it('corrida: alarme limpa A e B chega antes do clear → B guardada e com alarme', async () => {
    await receberMensagemExterna(sess('A', SEG0 + 120), APP);
    vi.setSystemTime(T0 + 180_000);
    fecharPortao();
    const limpeza = aoAlarme({ name: 'sessao-expira' } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(chrome.alarms.clear).toHaveBeenCalled());
    const chegada = receberMensagemExterna(sess('B', SEG0 + 180 + 3600), APP);
    await new Promise((r) => setTimeout(r, 0)); // B anda tudo o que puder antes de soltar a limpeza de A
    liberar();
    await Promise.all([limpeza, chegada]);
    expect((dados.sessao as { accessToken: string }).accessToken).toBe('B');
    expect(alarmes.get('sessao-expira')).toBe((SEG0 + 180 + 3600) * 1000 - 30_000);
  });

  it('corrida: limparSessao(seAinda=A) concorrente com chegada de B → B preservada', async () => {
    await receberMensagemExterna(sess('A', SEG0 + 3600), APP);
    let liberarRemove!: () => void;
    const portaoRemove = new Promise<void>((r) => { liberarRemove = r; });
    const removeOriginal = chrome.storage.session.remove;
    chrome.storage.session.remove = vi.fn(async (k: string | string[]) => { await portaoRemove; return removeOriginal(k); }) as never;
    const limpeza = limparSessao('A');
    await vi.waitFor(() => expect(chrome.storage.session.remove).toHaveBeenCalled());
    const chegada = receberMensagemExterna(sess('B', SEG0 + 7200), APP);
    await new Promise((r) => setTimeout(r, 0)); // B anda tudo o que puder antes de soltar a limpeza de A
    liberarRemove();
    await Promise.all([limpeza, chegada]);
    expect((dados.sessao as { accessToken: string }).accessToken).toBe('B');
    expect(alarmes.get('sessao-expira')).toBe((SEG0 + 7200) * 1000 - 30_000);
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
