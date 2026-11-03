// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

let ouvinte: (m: unknown) => void = () => {};
let responder: (v: unknown) => void = () => {};
let resposta: unknown;
let adiar = false;
const enviar = vi.fn(async (m: { tipo?: string }) => {
  if (m.tipo !== 'publiai:estado-extensao') return undefined;
  if (adiar) return new Promise((r) => { responder = r; });
  if (resposta instanceof Error) throw resposta;
  return resposta;
});
const cardsEnviados = () => enviar.mock.calls.filter(([m]) => m.tipo === 'publiai:busca-cards').length;
const blocos = () => document.querySelectorAll('.publiai-mini-bloco-busca').length;
const folga = (ms = 1200) => new Promise((r) => setTimeout(r, ms)); // > ESPERA_MS (800)

async function carregar() {
  ouvinte({ tipo: 'publiai:ativacao', ativa: false, logado: false }); // desliga a instância do teste anterior (observer vivo)
  vi.resetModules();
  document.body.innerHTML = `<div class="poly-card">
    <a class="poly-component__title" href="https://www.mercadolivre.com.br/p/MLB100#wid=MLB5321956667">Sabonete</a>
    <div><div class="poly-component__price"></div></div></div>`;
  vi.stubGlobal('chrome', { runtime: { sendMessage: enviar, onMessage: { addListener: (f: typeof ouvinte) => { ouvinte = f; } } } });
  await import('../busca');
}

beforeEach(() => { enviar.mockClear(); adiar = false; resposta = { ativa: true, logado: true }; });

describe('busca: boot fail-closed', () => {
  it('estado-extensao ativa:false → nenhum busca-cards', async () => {
    resposta = { ativa: false, logado: true };
    await carregar();
    await folga();
    expect(cardsEnviados()).toBe(0);
    expect(blocos()).toBe(0);
  });
  it('estado-extensao logado:false → nenhum busca-cards', async () => {
    resposta = { ativa: true, logado: false };
    await carregar();
    await folga();
    expect(cardsEnviados()).toBe(0);
    expect(blocos()).toBe(0);
  });
  it('estado-extensao falhando → nenhum busca-cards', async () => {
    resposta = new Error('contexto invalidado');
    await carregar();
    await folga();
    expect(cardsEnviados()).toBe(0);
    expect(blocos()).toBe(0);
  });
  it('estado ativa e logado → envia os cards', async () => {
    await carregar();
    await vi.waitFor(() => expect(cardsEnviados()).toBe(1), { timeout: 3000 });
    await vi.waitFor(() => expect(blocos()).toBe(1), { timeout: 3000 });
  });
  it('corrida: ativacao false chega antes da resposta atrasada do boot (ligada) → continua desligada', async () => {
    adiar = true;
    await carregar();
    ouvinte({ tipo: 'publiai:ativacao', ativa: false, logado: true, geracao: 2 });
    responder({ ativa: true, logado: true });
    await folga();
    expect(cardsEnviados()).toBe(0);
    expect(blocos()).toBe(0);
  });
  it('corrida: ativacao true chega antes do boot desligado atrasado → continua ligada', async () => {
    adiar = true;
    await carregar();
    ouvinte({ tipo: 'publiai:ativacao', ativa: true, logado: true, geracao: 2 });
    responder({ ativa: false, logado: true });
    await vi.waitFor(() => expect(cardsEnviados()).toBeGreaterThanOrEqual(1), { timeout: 3000 });
  });
});

describe('Task 11.4: dados locais primeiro', () => {
  it('rede pendurada: o bloco local sai em ≤ 300 ms após a ativação confirmada, antes do envio ao SW (debounce 800 ms)', async () => {
    const padrao = enviar.getMockImplementation()!;
    // SW nunca responde aos cards (rede pendurada).
    enviar.mockImplementation(async (m: { tipo?: string }) => (m.tipo === 'publiai:busca-cards' ? new Promise(() => {}) : padrao(m)));
    vi.useFakeTimers();
    try {
      await carregar();
      document.querySelector('.poly-component__price')!.innerHTML =
        '<div class="poly-price__current"><span class="andes-money-amount__fraction">19</span><span class="andes-money-amount__cents">90</span></div>';
      await vi.advanceTimersByTimeAsync(300);
      expect(blocos()).toBe(1);
      expect(cardsEnviados()).toBe(0); // o bloco não esperou a rede
      await vi.advanceTimersByTimeAsync(1000);
      expect(cardsEnviados()).toBe(1);
      expect(blocos()).toBe(1);
    } finally {
      vi.useRealTimers();
      enviar.mockImplementation(padrao);
    }
  });

  it('URL muda por script (filtro): o desenho local rápido não reaproveita a margem da página anterior', async () => {
    const raizes = new WeakMap<Element, ShadowRoot>();
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) { const r = orig.call(this, init); raizes.set(this, r); return r; };
    const padrao = enviar.getMockImplementation()!;
    let G = 'G1';
    enviar.mockImplementation(async (m: { tipo?: string; geracao?: unknown }) =>
      (m.tipo === 'publiai:busca-cards' && m.geracao !== G ? { ok: false, erro: 'geracao_antiga', geracao: G } : padrao(m)));
    vi.useFakeTimers();
    const texto = () => [...document.querySelectorAll('.publiai-mini-bloco-busca')].map((h) => raizes.get(h)?.textContent ?? '').join('|');
    try {
      await carregar();
      document.querySelector('.poly-component__price')!.innerHTML =
        '<div class="poly-price__current"><span class="andes-money-amount__fraction">19</span><span class="andes-money-amount__cents">90</span></div>';
      await vi.advanceTimersByTimeAsync(1500);
      const aqui = location.href.split('#')[0];
      ouvinte({ tipo: 'publiai:busca-resultados', url: aqui, geracao: G, resultados: { MLB5321956667: { itemId: 'MLB5321956667', estado: 'ok', codigo: '81', margem: { preco: 19.9, classico: { estado: 'ok', valor: { margemPct: 10.9 } } } } } });
      expect(texto()).toContain('Minha margem');
      const antes = cardsEnviados();
      history.pushState({}, '', '/outra');
      G = 'G2';
      document.querySelector('.poly-card')!.append(document.createElement('span')); // ML mexe no card: observer agenda
      await vi.advanceTimersByTimeAsync(300);
      expect(cardsEnviados()).toBe(antes); // o envio ainda não saiu
      expect(texto()).not.toContain('Minha margem');
    } finally {
      vi.useRealTimers();
      enviar.mockImplementation(padrao);
      Element.prototype.attachShadow = orig;
      history.pushState({}, '', '/');
    }
  });
});
