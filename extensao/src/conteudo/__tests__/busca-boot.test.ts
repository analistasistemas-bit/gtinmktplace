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
const folga = (ms = 1200) => new Promise((r) => setTimeout(r, ms)); // > ESPERA_MS (800)

async function carregar() {
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
  });
  it('estado-extensao logado:false → nenhum busca-cards', async () => {
    resposta = { ativa: true, logado: false };
    await carregar();
    await folga();
    expect(cardsEnviados()).toBe(0);
  });
  it('estado-extensao falhando → nenhum busca-cards', async () => {
    resposta = new Error('contexto invalidado');
    await carregar();
    await folga();
    expect(cardsEnviados()).toBe(0);
  });
  it('estado ativa e logado → envia os cards', async () => {
    await carregar();
    await vi.waitFor(() => expect(cardsEnviados()).toBe(1), { timeout: 3000 });
  });
  it('corrida: ativacao false chega antes da resposta atrasada do boot (ligada) → continua desligada', async () => {
    adiar = true;
    await carregar();
    ouvinte({ tipo: 'publiai:ativacao', ativa: false, logado: true, geracao: 2 });
    responder({ ativa: true, logado: true });
    await folga();
    expect(cardsEnviados()).toBe(0);
  });
  it('corrida: ativacao true chega antes do boot desligado atrasado → continua ligada', async () => {
    adiar = true;
    await carregar();
    ouvinte({ tipo: 'publiai:ativacao', ativa: true, logado: true, geracao: 2 });
    responder({ ativa: false, logado: true });
    await vi.waitFor(() => expect(cardsEnviados()).toBeGreaterThanOrEqual(1), { timeout: 3000 });
  });
});
