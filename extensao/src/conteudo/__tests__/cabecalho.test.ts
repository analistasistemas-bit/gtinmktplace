// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { iniciar, inserirIcone, localizarEncaixe } from '../cabecalho';

const FIXTURE = readFileSync(resolve(process.cwd(), 'src/conteudo/__fixtures__/cabecalho-ml.html'), 'utf8');

type Est = { ativa: boolean; logado: boolean; perfil: { nome: string | null; orgNome: string | null } | null; versao: string; geracao: number };
const LOGADO: Est = { ativa: true, logado: true, perfil: { nome: 'Diego Souza', orgNome: 'DSA' }, versao: '0.3.0', geracao: 7 };
const DESLOGADO: Est = { ativa: true, logado: false, perfil: null, versao: '0.3.0', geracao: 7 };
const DESATIVADA: Est = { ...LOGADO, ativa: false };

let estado: Est;
let ouvinte: (m: unknown) => void = () => {};
const padrao = async (m: { tipo: string }): Promise<unknown> => (m.tipo === 'publiai:estado-extensao' ? estado : { ok: true, ...estado });
const enviar = vi.fn(padrao);
let parar: () => void = () => {};

const tick = () => new Promise((r) => setTimeout(r, 0));
const host = () => document.getElementById('publiai-cabecalho');
const raiz = () => host()!.shadowRoot!;
const icone = () => raiz().querySelector<HTMLButtonElement>('button.icone')!;
const menu = () => raiz().querySelector<HTMLElement>('[role="menu"]')!;
const item = (texto: string) => [...raiz().querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((e) => e.textContent?.includes(texto))!;
const abrir = async () => { icone().click(); await tick(); };
const montar = async (e: Est) => {
  estado = e;
  parar();
  document.body.innerHTML = FIXTURE;
  parar = iniciar(document, 'open');
  await tick();
};

beforeEach(() => {
  enviar.mockClear();
  enviar.mockImplementation(padrao);
  history.pushState({}, '', '/');
  document.body.innerHTML = '';
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: { id: 'x', sendMessage: enviar, onMessage: { addListener: (f: (m: unknown) => void) => { ouvinte = f; } } },
  };
});
afterEach(() => { parar(); parar = () => {}; });

describe('encaixe', () => {
  it('insere um ícone ao lado do carrinho na fixture; segunda chamada não duplica', () => {
    document.body.innerHTML = FIXTURE;
    const a = inserirIcone(document, 'open');
    expect(a).not.toBeNull();
    expect(document.querySelector('#nav-cart')!.nextElementSibling).toBe(a);
    expect(inserirIcone(document, 'open')).toBe(a);
    expect(document.querySelectorAll('#publiai-cabecalho')).toHaveLength(1);
  });

  it('sem encaixe → null e nenhum nó criado (sem cabeçalho e página /captcha/)', () => {
    document.body.innerHTML = '<main>nada</main>';
    expect(localizarEncaixe(document)).toBeNull();
    expect(inserirIcone(document, 'open')).toBeNull();
    expect(host()).toBeNull();
    document.body.innerHTML = FIXTURE;
    history.pushState({}, '', '/captcha/abc');
    expect(inserirIcone(document, 'open')).toBeNull();
    expect(host()).toBeNull();
  });

  it('com o ícone do Avant presente → insere o nosso sem mover nem esconder o dele', () => {
    document.body.innerHTML = FIXTURE;
    const cart = document.querySelector('#nav-cart')!;
    const avant = document.createElement('div');
    avant.className = 'avantpro-icon';
    cart.after(avant);
    const nosso = inserirIcone(document, 'open')!;
    expect(nosso).not.toBeNull();
    expect(avant.parentElement).toBe(cart.parentElement);
    expect(avant.hidden).toBe(false);
    expect(avant.getAttribute('style')).toBeNull();
    expect(cart.nextElementSibling === avant || cart.nextElementSibling === nosso).toBe(true);
    expect(document.querySelectorAll('.avantpro-icon')).toHaveLength(1);
  });

  it('shadow root é fechado por padrão', () => {
    document.body.innerHTML = FIXTURE;
    expect(inserirIcone(document)!.shadowRoot).toBeNull();
  });

  it('navegação sem recarga (cabeçalho reconstruído) → reinsere uma vez', async () => {
    await montar(LOGADO);
    expect(host()).not.toBeNull();
    document.body.innerHTML = FIXTURE;
    expect(host()).toBeNull();
    await tick();
    await tick();
    expect(document.querySelectorAll('#publiai-cabecalho')).toHaveLength(1);
  });
});

describe('observação do encaixe (fix round 1)', () => {
  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
  it('sem encaixe → desiste após o prazo, sem erro', async () => {
    estado = LOGADO;
    document.body.innerHTML = '<main>sem cabeçalho</main>';
    parar = iniciar(document, 'open', 30);
    await espera(80);
    document.body.innerHTML = FIXTURE;
    await espera(20);
    expect(host()).toBeNull();
  });
  it('sem encaixe dentro do prazo → insere quando o cabeçalho aparece', async () => {
    estado = LOGADO;
    document.body.innerHTML = '<main>sem cabeçalho</main>';
    parar = iniciar(document, 'open', 500);
    document.body.innerHTML = FIXTURE;
    await espera(20);
    expect(host()).not.toBeNull();
  });
  it('inserido → mutações fora do cabeçalho não chamam a busca', async () => {
    await montar(LOGADO);
    const busca = vi.spyOn(document, 'querySelector');
    const main = document.createElement('main');
    document.body.append(main);
    await tick();
    for (let i = 0; i < 5; i++) main.append(document.createElement('div'));
    await tick();
    expect(busca).not.toHaveBeenCalled();
    busca.mockRestore();
  });
  it('página de bloqueio não observa nem insere', async () => {
    history.pushState({}, '', '/gz/account-verification');
    estado = LOGADO;
    parar = iniciar(document, 'open', 500);
    const busca = vi.spyOn(document, 'querySelector');
    document.body.innerHTML = FIXTURE;
    await tick();
    expect(host()).toBeNull();
    expect(busca).not.toHaveBeenCalled();
    busca.mockRestore();
  });
  it('ícone criado por inserirIcone antes do iniciar também é ligado', async () => {
    estado = LOGADO;
    document.body.innerHTML = FIXTURE;
    inserirIcone(document, 'open');
    parar = iniciar(document, 'open');
    await tick();
    await abrir();
    expect(icone().getAttribute('aria-expanded')).toBe('true');
    expect(host()!.dataset.estado).toBe('ativo');
  });
  it('antes da 1ª resposta do SW o menu diz Verificando… e o ponto é neutro', () => {
    document.body.innerHTML = FIXTURE;
    inserirIcone(document, 'open');
    expect(menu().textContent).toContain('Verificando');
    expect(raiz().querySelector('.ponto')!.className).toContain('neutro');
  });
});

describe('ponto e ícone', () => {
  it('verde logado e ativa', async () => {
    await montar(LOGADO);
    expect(host()!.dataset.estado).toBe('ativo');
    expect(raiz().querySelector('.ponto')!.className).toContain('verde');
  });
  it('laranja deslogado', async () => {
    await montar(DESLOGADO);
    expect(host()!.dataset.estado).toBe('deslogado');
    expect(raiz().querySelector('.ponto')!.className).toContain('laranja');
  });
  it('ícone cinza quando desativada', async () => {
    await montar(DESATIVADA);
    expect(host()!.dataset.estado).toBe('desativado');
    expect(raiz().querySelector('.ponto')!.className).toContain('cinza');
  });
  it('conta-mudou / ativacao refazem a leitura sem recarregar', async () => {
    await montar(LOGADO);
    estado = DESLOGADO;
    ouvinte({ tipo: 'publiai:conta-mudou', logado: false, ativa: true, geracao: 8 });
    await tick();
    expect(host()!.dataset.estado).toBe('deslogado');
    estado = DESATIVADA;
    ouvinte({ tipo: 'publiai:ativacao', ativa: false, logado: true, geracao: 9 });
    await tick();
    expect(host()!.dataset.estado).toBe('desativado');
  });
  it('leitura inicial não pede conferência de sessão; abrir o menu pede (abrindo:true) a cada abertura', async () => {
    await montar(LOGADO);
    expect(enviar).toHaveBeenCalledWith({ tipo: 'publiai:estado-extensao', abrindo: false });
    enviar.mockClear();
    await abrir();
    expect(enviar).toHaveBeenCalledWith({ tipo: 'publiai:estado-extensao', abrindo: true });
    await abrir();
    await abrir();
    expect(enviar.mock.calls.filter(([m]) => (m as { abrindo?: boolean }).abrindo === true)).toHaveLength(2);
  });
});

describe('menu', () => {
  it('logado e ativa: nome, org conectado, chave, Abrir painel, Abrir o PubliAI, Sair, versão', async () => {
    await montar(LOGADO);
    await abrir();
    const t = menu().textContent!;
    expect(t).toContain('Diego Souza');
    expect(t).toContain('DSA · conectado');
    expect(item('Extensão ativa').getAttribute('aria-checked')).toBe('true');
    expect(t).toContain('Abrir painel de análise');
    expect(t).toContain('Abrir o PubliAI');
    expect(t).toContain('Sair');
    expect(t).toContain('Versão 0.3.0');
    expect(t).not.toMatch(/R\$|margem|lucro/i);
  });
  it('deslogado: só Entrar no PubliAI + Entrar', async () => {
    await montar(DESLOGADO);
    await abrir();
    const t = menu().textContent!;
    expect(t).toContain('Entrar no PubliAI');
    expect(t).toContain('Use o mesmo e-mail e senha do app');
    expect(raiz().querySelectorAll('button[data-acao="entrar"]')).toHaveLength(1);
    expect(t).not.toContain('Sair');
    expect(t).not.toContain('Extensão ativa');
    expect(t).toContain('Versão 0.3.0');
    expect(raiz().querySelector('input')).toBeNull();
  });
  it('desativada: nome, org desativada, chave off, pausado, Sair', async () => {
    await montar(DESATIVADA);
    await abrir();
    const t = menu().textContent!;
    expect(t).toContain('DSA · extensão desativada');
    expect(item('Extensão ativa').getAttribute('aria-checked')).toBe('false');
    expect(t).toContain('Selos e análises pausados');
    expect(t).toContain('Sair');
    expect(t).not.toContain('Abrir painel de análise');
  });
  it('nome vindo do SW é texto, nunca HTML', async () => {
    await montar({ ...LOGADO, perfil: { nome: '<img src=x onerror=alert(1)>', orgNome: null } });
    await abrir();
    expect(raiz().querySelector('img')).toBeNull();
    expect(menu().textContent).toContain('<img src=x');
  });
  it('aria-haspopup/aria-expanded no ícone', async () => {
    await montar(LOGADO);
    expect(icone().getAttribute('aria-haspopup')).toBe('menu');
    expect(icone().getAttribute('aria-expanded')).toBe('false');
    await abrir();
    expect(icone().getAttribute('aria-expanded')).toBe('true');
  });
});

describe('ações', () => {
  it('Entrar e Abrir painel enviam publiai:abrir-painel no próprio clique (síncrono)', async () => {
    await montar(DESLOGADO);
    await abrir();
    enviar.mockClear();
    raiz().querySelector<HTMLButtonElement>('button[data-acao="entrar"]')!.click();
    expect(enviar).toHaveBeenCalledWith({ tipo: 'publiai:abrir-painel' });
    await tick();
    await montar(LOGADO);
    await abrir();
    enviar.mockClear();
    item('Abrir painel de análise').click();
    expect(enviar).toHaveBeenCalledWith({ tipo: 'publiai:abrir-painel' });
  });
  it('Abrir o PubliAI → abrir-app', async () => {
    await montar(LOGADO);
    await abrir();
    item('Abrir o PubliAI').click();
    expect(enviar).toHaveBeenCalledWith({ tipo: 'publiai:abrir-app' });
  });
  it('chave envia definir-ativa com a geração e atualiza o ícone', async () => {
    await montar(LOGADO);
    await abrir();
    estado = DESATIVADA;
    item('Extensão ativa').click();
    await tick();
    expect(enviar).toHaveBeenCalledWith({ tipo: 'publiai:definir-ativa', ativa: false, geracao: 7 });
    expect(host()!.dataset.estado).toBe('desativado');
  });
  it('Sair envia sair com a geração e vira deslogado', async () => {
    await montar(LOGADO);
    await abrir();
    estado = DESLOGADO;
    item('Sair').click();
    await tick();
    expect(enviar).toHaveBeenCalledWith({ tipo: 'publiai:sair', geracao: 7 });
    expect(host()!.dataset.estado).toBe('deslogado');
  });
  it('geracao_antiga relê o estado', async () => {
    await montar(LOGADO);
    await abrir();
    enviar.mockImplementation(async (m: { tipo: string }) => (m.tipo === 'publiai:definir-ativa' ? { ok: false, erro: 'geracao_antiga', geracao: 9 } : estado));
    estado = { ...DESATIVADA, geracao: 9 };
    item('Extensão ativa').click();
    await tick();
    await tick();
    expect(host()!.dataset.estado).toBe('desativado');
    enviar.mockImplementation(async (m: { tipo: string }) => (m.tipo === 'publiai:estado-extensao' ? estado : { ok: true, ...estado }));
  });
  it('Escape fecha e devolve o foco ao ícone; clique fora também fecha', async () => {
    await montar(LOGADO);
    await abrir();
    expect(menu().hidden).toBe(false);
    item('Sair').focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu().hidden).toBe(true);
    expect(icone().getAttribute('aria-expanded')).toBe('false');
    expect(raiz().activeElement).toBe(icone());
    await abrir();
    document.body.click();
    expect(menu().hidden).toBe(true);
  });
  it('SW indisponível (contexto invalidado) não quebra o clique', async () => {
    await montar(LOGADO);
    enviar.mockImplementation(async () => { throw new Error('Extension context invalidated.'); });
    await expect(abrir()).resolves.not.toThrow();
  });
});
