// @vitest-environment jsdom
import { beforeAll, expect, it, vi } from 'vitest';

let ouvinte: (m: unknown) => void = () => {};
const enviar = vi.fn(async (m: { tipo?: string }) => (m.tipo === 'publiai:estado-extensao' ? { ativa: true, logado: true } : undefined));
const cardsEnviados = () => enviar.mock.calls.flatMap(([m]) => (m as { cards?: { itemId: string; preco: number | null }[] }).cards ?? []);

beforeAll(async () => {
  document.body.innerHTML = `<div class="poly-card">
    <a class="poly-component__title" href="https://www.mercadolivre.com.br/p/MLB100#wid=MLB5321956667">Sabonete</a>
    <div><div class="poly-component__price"></div></div></div>`;
  vi.stubGlobal('chrome', { runtime: { sendMessage: enviar, onMessage: { addListener: (f: typeof ouvinte) => { ouvinte = f; } } } });
  await import('../busca');
});

it('1ª leitura espera o card montar; preço que aparece depois reenvia o card', async () => {
  await vi.waitFor(() => expect(cardsEnviados()).toHaveLength(1), { timeout: 3000 });
  expect(cardsEnviados()[0].preco).toBeNull();
  document.querySelector('.poly-component__price')!.innerHTML =
    '<div class="poly-price__current"><span class="andes-money-amount__fraction">19</span><span class="andes-money-amount__cents">90</span></div>';
  await vi.waitFor(() => expect(cardsEnviados().at(-1)!.preco).toBe(19.9), { timeout: 3000 });
});

it('selo some do card quando o resultado deixa de autorizar (ok → sem vínculo)', () => {
  const ok = { itemId: 'MLB5321956667', estado: 'ok', codigo: '81', margem: { classico: { estado: 'ok', valor: { margemPct: 10.9 } } } };
  ouvinte({ tipo: 'publiai:busca-resultados', resultados: { MLB5321956667: ok } });
  expect(document.querySelectorAll('.publiai-selo-busca')).toHaveLength(1);
  ouvinte({ tipo: 'publiai:busca-resultados', resultados: { MLB5321956667: { itemId: 'MLB5321956667', estado: 'sem_vinculo' } } });
  expect(document.querySelectorAll('.publiai-selo-busca')).toHaveLength(0);
});

it('ativacao false remove selos dos cards; true reenvia os cards sem analisar sozinha', () => {
  const ok = { itemId: 'MLB5321956667', estado: 'ok', codigo: '81', margem: { classico: { estado: 'ok', valor: { margemPct: 10.9 } } } };
  ouvinte({ tipo: 'publiai:busca-resultados', resultados: { MLB5321956667: ok } });
  expect(document.querySelectorAll('.publiai-selo-busca')).toHaveLength(1);
  ouvinte({ tipo: 'publiai:ativacao', ativa: false, logado: true, geracao: 2 });
  expect(document.querySelectorAll('.publiai-selo-busca')).toHaveLength(0);
  const antes = cardsEnviados().length;
  ouvinte({ tipo: 'publiai:ativacao', ativa: true, logado: true, geracao: 3 });
  expect(cardsEnviados().length).toBe(antes + 1);
  expect(enviar.mock.calls.some(([m]) => (m as { tipo: string }).tipo === 'publiai:analisar-busca')).toBe(false);
  expect(document.querySelectorAll('.publiai-selo-busca')).toHaveLength(0);
});
