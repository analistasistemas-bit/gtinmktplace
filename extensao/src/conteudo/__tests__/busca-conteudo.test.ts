// @vitest-environment jsdom
import { beforeAll, expect, it, vi } from 'vitest';

let ouvinte: (m: unknown) => void = () => {};
const enviar = vi.fn(async (m: { tipo?: string }) => (m.tipo === 'publiai:estado-extensao' ? { ativa: true, logado: true } : undefined));
const cardsEnviados = () => enviar.mock.calls.flatMap(([m]) => (m as { cards?: { itemId: string; preco: number | null; userProductId?: string | null }[] }).cards ?? []);

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

it('/up/ que aparece depois, sozinho, reenvia o card (assinatura inclui userProductId)', async () => {
  document.body.insertAdjacentHTML('beforeend', `<div class="poly-card" id="up-tardio">
    <a class="poly-component__title" href="https://www.mercadolivre.com.br/x#wid=MLB5321956999">Outro</a></div>`);
  const dele = () => cardsEnviados().filter((c) => c.itemId === 'MLB5321956999') as { userProductId: string | null }[];
  await vi.waitFor(() => expect(dele().length).toBeGreaterThan(0), { timeout: 3000 });
  const antes = dele().length;
  document.querySelector('#up-tardio')!.innerHTML =
    '<a class="poly-component__title" href="https://www.mercadolivre.com.br/x/up/MLBU1959450397#wid=MLB5321956999">Outro</a>';
  await vi.waitFor(() => expect(dele().at(-1)!.userProductId).toBe('MLBU1959450397'), { timeout: 3000 });
  expect(dele().length).toBe(antes + 1);
});

it('conflito de catálogo (só identidadeConflitante muda) reenvia o card, e a resolução também', async () => {
  const ID = 'MLB5321956888';
  const cardHtml = (cat: string | null) =>
    `<a class="poly-component__title" href="https://www.mercadolivre.com.br/x${cat ? `/p/${cat}` : ''}#wid=${ID}&position=1">Dup</a>`;
  document.body.insertAdjacentHTML('beforeend', `<div class="poly-card" id="dup1">${cardHtml(null)}</div><div class="poly-card" id="dup2">${cardHtml(null)}</div>`);
  const dele = () => cardsEnviados().filter((c) => c.itemId === ID) as { identidadeConflitante?: boolean }[];
  await vi.waitFor(() => expect(dele().length).toBeGreaterThan(0), { timeout: 3000 });
  expect(dele().at(-1)!.identidadeConflitante).toBe(false);
  const n0 = dele().length;
  document.querySelector('#dup1')!.innerHTML = cardHtml('MLB11111111');
  document.querySelector('#dup2')!.innerHTML = cardHtml('MLB22222222');
  await vi.waitFor(() => expect(dele().at(-1)!.identidadeConflitante).toBe(true), { timeout: 3000 });
  expect(dele().length).toBe(n0 + 1);
  document.querySelector('#dup1')!.innerHTML = cardHtml(null);
  document.querySelector('#dup2')!.innerHTML = cardHtml(null);
  await vi.waitFor(() => expect(dele().at(-1)!.identidadeConflitante).toBe(false), { timeout: 3000 });
  expect(dele().length).toBe(n0 + 2);
});
