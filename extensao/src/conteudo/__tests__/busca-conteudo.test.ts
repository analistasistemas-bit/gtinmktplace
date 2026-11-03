// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';

let ouvinte: (m: unknown) => void = () => {};
// SW falso: cards sem a geração atual voltam recusados com ela (a página adota e reenvia).
let G = 'G1';
const enviar = vi.fn(async (m: { tipo?: string; geracao?: unknown }) => {
  if (m.tipo === 'publiai:estado-extensao') return { ativa: true, logado: true };
  if (m.tipo === 'publiai:busca-cards' && m.geracao !== G) return { ok: false, erro: 'geracao_antiga', geracao: G };
  return undefined;
});
const aqui = () => location.href.split('#')[0];
const cardsEnviados = () => enviar.mock.calls.filter(([m]) => (m as { geracao?: unknown }).geracao === G).flatMap(([m]) => (m as { cards?: { itemId: string; preco: number | null; userProductId?: string | null }[] }).cards ?? []);

// Shadow fechado: o teste captura a raiz no attachShadow para ler o texto do bloco.
const raizes = new WeakMap<Element, ShadowRoot>();
const blocos = () => [...document.querySelectorAll('.publiai-mini-bloco-busca')];
const textoDosBlocos = () => blocos().map((h) => raizes.get(h)?.textContent ?? '').join('|');
const OK = { itemId: 'MLB5321956667', estado: 'ok', codigo: '81', margem: { preco: 19.9, classico: { estado: 'ok', valor: { margemPct: 10.9 } } } };

beforeAll(async () => {
  const orig = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) { const r = orig.call(this, init); raizes.set(this, r); return r; };
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

it('card sem resultado nenhum recebe o bloco local (um por card)', async () => {
  await vi.waitFor(() => expect(blocos()).toHaveLength(1), { timeout: 3000 });
  expect(textoDosBlocos()).not.toContain('Minha margem');
});

it('margem sai do bloco quando o resultado deixa de autorizar (ok → sem vínculo); o bloco fica', () => {
  ouvinte({ tipo: 'publiai:busca-resultados', url: aqui(), geracao: G, resultados: { MLB5321956667: OK } });
  expect(blocos()).toHaveLength(1);
  expect(textoDosBlocos()).toContain('Minha margem · Clássico 10,9%');
  ouvinte({ tipo: 'publiai:busca-resultados', url: aqui(), geracao: G, resultados: { MLB5321956667: { itemId: 'MLB5321956667', estado: 'sem_vinculo' } } });
  expect(blocos()).toHaveLength(1);
  expect(textoDosBlocos()).not.toContain('Minha margem');
});

it('enriquecimento do catálogo chega com os resultados e entra no bloco do card (Task 10)', () => {
  const link = document.querySelector('a.poly-component__title')!;
  const href = link.getAttribute('href')!;
  link.setAttribute('href', 'https://www.mercadolivre.com.br/p/MLB1000000#wid=MLB5321956667');
  const enriquecimento = { catalogos: { MLB1000000: { ofertas: { estado: 'ok', total: 4, lidas: 4, vendedoresIdentificados: 4, ofertasSemVendedor: 0, completa: true, exatas: {} } } }, vendedores: {}, retomarEm: null, falhou: false, indisponivel: null, perfis: 0 };
  ouvinte({ tipo: 'publiai:busca-resultados', url: aqui(), geracao: G, resultados: {}, enriquecimento });
  expect(textoDosBlocos()).toContain('4 vendedores');
  ouvinte({ tipo: 'publiai:busca-resultados', url: aqui(), geracao: G, resultados: {} });
  expect(textoDosBlocos()).toContain('Aguardando dados do catálogo');
  link.setAttribute('href', href);
  ouvinte({ tipo: 'publiai:busca-resultados', url: aqui(), geracao: G, resultados: {} });
});

it('mesmo resultado de novo não refaz o bloco (idempotente por assinatura)', () => {
  ouvinte({ tipo: 'publiai:busca-resultados', url: aqui(), geracao: G, resultados: { MLB5321956667: OK } });
  const host = blocos()[0];
  ouvinte({ tipo: 'publiai:busca-resultados', url: aqui(), geracao: G, resultados: { MLB5321956667: OK } });
  expect(blocos()[0]).toBe(host);
});

it('ativacao false remove os blocos; true reenvia os cards sem analisar sozinha', async () => {
  ouvinte({ tipo: 'publiai:busca-resultados', url: aqui(), geracao: G, resultados: { MLB5321956667: OK } });
  expect(textoDosBlocos()).toContain('Minha margem');
  ouvinte({ tipo: 'publiai:ativacao', ativa: false, logado: true, geracao: 2 });
  expect(blocos()).toHaveLength(0);
  const antes = cardsEnviados().length;
  ouvinte({ tipo: 'publiai:ativacao', ativa: true, logado: true, geracao: 3 });
  // Geração invalidada na hora: 1º envio sem ela, recusado; o reenvio já com a geração atual.
  await vi.waitFor(() => expect(cardsEnviados().length).toBe(antes + 1));
  expect(enviar.mock.calls.some(([m]) => (m as { tipo: string }).tipo === 'publiai:analisar-busca')).toBe(false);
  expect(textoDosBlocos()).not.toContain('Minha margem');
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

it('resultado de outra página (URL diferente) é ignorado', () => {
  ouvinte({ tipo: 'publiai:busca-resultados', url: aqui(), geracao: G, resultados: {} });
  ouvinte({ tipo: 'publiai:busca-resultados', url: 'https://lista.mercadolivre.com.br/outra', resultados: { MLB5321956667: OK } });
  expect(textoDosBlocos()).not.toContain('Minha margem');
});

it('SW pede retomada: um pulso só, depois da janela da cota', () => {
  vi.useFakeTimers();
  try {
    const pulsos = () => enviar.mock.calls.filter(([m]) => (m as { tipo: string }).tipo === 'publiai:busca-pulso').length;
    ouvinte({ tipo: 'publiai:busca-retomar', url: aqui(), geracao: G });
    ouvinte({ tipo: 'publiai:busca-retomar', url: aqui(), geracao: G });
    ouvinte({ tipo: 'publiai:busca-retomar', url: 'https://lista.mercadolivre.com.br/outra', geracao: G });
    ouvinte({ tipo: 'publiai:busca-retomar', url: aqui(), geracao: 'G0' });
    vi.advanceTimersByTime(60_000);
    expect(pulsos()).toBe(0);
    vi.advanceTimersByTime(2_000);
    expect(pulsos()).toBe(1);
    expect(enviar.mock.calls.find(([m]) => (m as { tipo: string }).tipo === 'publiai:busca-pulso')![0]).toMatchObject({ geracao: G });
  } finally {
    vi.useRealTimers();
  }
});

it('achado 1: resultado de outra geração (navegação/sessão anterior, mesma URL) é ignorado', () => {
  ouvinte({ tipo: 'publiai:busca-resultados', url: aqui(), geracao: G, resultados: {} });
  ouvinte({ tipo: 'publiai:busca-resultados', url: aqui(), geracao: 'G0', resultados: { MLB5321956667: OK } });
  ouvinte({ tipo: 'publiai:busca-resultados', url: aqui(), resultados: { MLB5321956667: OK } });
  expect(textoDosBlocos()).not.toContain('Minha margem');
  ouvinte({ tipo: 'publiai:busca-resultados', url: aqui(), geracao: G, resultados: { MLB5321956667: OK } });
  expect(textoDosBlocos()).toContain('Minha margem');
});

it('achado 1: SW recusa com geração nova (sessão mudou) → a página adota e reenvia tudo com ela', async () => {
  G = 'G2';
  const antes = cardsEnviados().length;
  ouvinte({ tipo: 'publiai:sessao-mudou' });
  await vi.waitFor(() => expect(cardsEnviados().length).toBeGreaterThan(antes), { timeout: 3000 });
  expect(enviar.mock.calls.at(-1)![0]).toMatchObject({ tipo: 'publiai:busca-cards', geracao: 'G2' });
});

it('I1: troca de sessão invalida a geração na hora: resultado antigo antes da resposta dos cards não desenha margem', async () => {
  const velha = G;
  let soltar!: (v: unknown) => void;
  enviar.mockImplementationOnce(() => new Promise((r) => { soltar = r; }) as never); // resposta dos cards fica em voo
  ouvinte({ tipo: 'publiai:ativacao', ativa: true, logado: true }); // envio de ANTES da troca, resposta pendente
  G = 'G3';
  ouvinte({ tipo: 'publiai:sessao-mudou' });
  ouvinte({ tipo: 'publiai:busca-resultados', url: aqui(), geracao: velha, resultados: { MLB5321956667: OK } });
  expect(textoDosBlocos()).not.toContain('Minha margem');
  // Resposta atrasada do aperto de mão de antes da troca (com a geração velha) não restaura a velha.
  soltar({ ok: false, erro: 'geracao_antiga', geracao: velha });
  await new Promise((r) => setTimeout(r, 0));
  ouvinte({ tipo: 'publiai:busca-resultados', url: aqui(), geracao: velha, resultados: { MLB5321956667: OK } });
  expect(textoDosBlocos()).not.toContain('Minha margem');
});

it('sessão alterada: blocos com dado da sessão anterior saem na hora', () => {
  ouvinte({ tipo: 'publiai:busca-resultados', url: aqui(), geracao: G, resultados: { MLB5321956667: OK } });
  expect(textoDosBlocos()).toContain('Minha margem');
  ouvinte({ tipo: 'publiai:sessao-mudou' });
  expect(blocos()).toHaveLength(0);
});

it('ML reusa o nó do card para outro item (só o href muda): o bloco é refeito com o novo item', async () => {
  const NOVO = 'MLB5321950001';
  document.body.insertAdjacentHTML('beforeend', `<div class="poly-card" id="reuso">
    <a class="poly-component__title" href="https://www.mercadolivre.com.br/x#wid=MLB5321950000&position=4">A</a>
    <div><div class="poly-component__price"></div></div></div>`);
  const doCard = () => [...document.querySelectorAll('#reuso .publiai-mini-bloco-busca')];
  await vi.waitFor(() => expect(doCard()).toHaveLength(1), { timeout: 3000 });
  ouvinte({ tipo: 'publiai:busca-resultados', url: aqui(), geracao: G, resultados: {}, metadados: { [NOVO]: { itemId: NOVO, proprio: true, vinculo: null } } });
  expect(raizes.get(doCard()[0])!.textContent).not.toContain('Meu anúncio');
  document.querySelector('#reuso a')!.setAttribute('href', `https://www.mercadolivre.com.br/x#wid=${NOVO}&position=4`);
  await vi.waitFor(() => expect(raizes.get(doCard()[0])?.textContent).toContain('Meu anúncio · posição 4 · orgânico'), { timeout: 3000 });
  expect(doCard()).toHaveLength(1);
});

it('ML refaz o conteúdo do card (o host sai junto): o bloco volta', async () => {
  const card = document.querySelector('#reuso')!;
  card.innerHTML = `<a class="poly-component__title" href="https://www.mercadolivre.com.br/x#wid=MLB5321950001&position=4">A</a>
    <div><div class="poly-component__price"></div></div>`;
  expect(card.querySelectorAll('.publiai-mini-bloco-busca')).toHaveLength(0);
  await vi.waitFor(() => expect(card.querySelectorAll('.publiai-mini-bloco-busca')).toHaveLength(1), { timeout: 3000 });
});

it('contagem de ocorrências ignora cards dentro do Avant', async () => {
  document.body.insertAdjacentHTML('beforeend', `<div class="avantpro-product-container"><div class="poly-card">
    <a class="poly-component__title" href="https://www.mercadolivre.com.br/x#wid=MLB5321950777">Avant</a></div></div>
    <div class="poly-card"><a class="poly-component__title" href="https://www.mercadolivre.com.br/x#wid=MLB5321950778">Novo</a></div>`);
  const msg = () => enviar.mock.calls.map(([m]) => m as { cards?: { itemId: string }[]; ocorrencias?: number })
    .filter((m) => m.cards?.some((c) => c.itemId === 'MLB5321950778')).at(-1);
  await vi.waitFor(() => expect(msg()).toBeTruthy(), { timeout: 3000 });
  expect(msg()!.ocorrencias).toBe(document.querySelectorAll('.poly-card').length - 1);
});

const precoHtml = (v: string) => `<div><div class="poly-component__price"><div class="poly-price__current"><span class="andes-money-amount__fraction">${v}</span></div></div></div>`;

it('revisão final: status de margem (aguardando cota) só na aparição com o preço analisado (1º preço do item)', async () => {
  const ID = 'MLB5321950800';
  document.body.insertAdjacentHTML('beforeend', `
    <div class="poly-card" id="lim1"><a class="poly-component__title" href="https://www.mercadolivre.com.br/x#wid=${ID}&position=1&is_advertising=true">L</a>${precoHtml('10')}</div>
    <div class="poly-card" id="lim2"><a class="poly-component__title" href="https://www.mercadolivre.com.br/x#wid=${ID}&position=5">L</a>${precoHtml('30')}</div>`);
  ouvinte({ tipo: 'publiai:busca-resultados', url: aqui(), geracao: G, resultados: { [ID]: { itemId: ID, estado: 'limite', fonte: 'catalogo', codigo: '81' } } });
  const t = (id: string) => raizes.get(document.querySelector(`#${id} .publiai-mini-bloco-busca`)!)?.textContent ?? '';
  await vi.waitFor(() => expect(t('lim1')).toContain('Minha margem'), { timeout: 3000 });
  expect(t('lim2')).not.toContain('Minha margem');
  document.querySelector('#lim1')!.remove();
  document.querySelector('#lim2')!.remove();
});

it('achado 1: sinais são da aparição — mesmo item com vendedor/Full/frete só numa delas (Full e frete ficam no card do ML)', async () => {
  const ID = 'MLB5321950900';
  document.body.insertAdjacentHTML('beforeend', `
    <div class="poly-card" id="sig1"><a class="poly-component__title" href="https://www.mercadolivre.com.br/x#wid=${ID}&position=8">S</a>
      <span class="poly-component__seller">Loja Um</span>${precoHtml('30')}
      <div><span class="polylabel-label">Frete grátis</span><svg aria-label="Enviado pelo FULL"></svg></div></div>
    <div class="poly-card" id="sig2"><a class="poly-component__title" href="https://www.mercadolivre.com.br/x#wid=${ID}&position=9&is_advertising=true">S</a>${precoHtml('35')}</div>`);
  const t = (id: string) => raizes.get(document.querySelector(`#${id} .publiai-mini-bloco-busca`)!)?.textContent ?? '';
  await vi.waitFor(() => expect(t('sig2')).toContain('Patrocinado'), { timeout: 3000 });
  expect(t('sig1')).toContain('Loja Um');
  expect(t('sig1')).not.toContain('Patrocinado');
  expect(t('sig2')).not.toContain('Loja Um');
  expect(t('sig2')).not.toContain('Frete grátis');
  expect(t('sig2')).not.toContain('Full');
});

it('achado 2: host removido sozinho pela página num card estável volta após o agendamento; remoção repetida para (sem ciclo)', async () => {
  document.body.insertAdjacentHTML('beforeend', `<div class="poly-card" id="estavel">
    <a class="poly-component__title" href="https://www.mercadolivre.com.br/x#wid=MLB5321950950&position=10">E</a>${precoHtml('40')}</div>`);
  const host = () => document.querySelector('#estavel .publiai-mini-bloco-busca');
  await vi.waitFor(() => expect(host()).not.toBeNull(), { timeout: 3000 });
  for (let i = 0; i < 3; i++) {
    host()!.remove();
    expect(host()).toBeNull();
    await vi.waitFor(() => expect(host()).not.toBeNull(), { timeout: 3000 });
  }
  host()!.remove(); // 4ª remoção: a página insiste → o PubliAI desiste deste card (o painel segue com tudo)
  await new Promise((r) => setTimeout(r, 1200));
  expect(host()).toBeNull();
});

it('achado 3: card aninhado em outro card não recebe bloco nem entra na contagem', async () => {
  document.body.insertAdjacentHTML('beforeend', `<div class="poly-card" id="fora">
    <a class="poly-component__title" href="https://www.mercadolivre.com.br/x#wid=MLB5321950960&position=11">F</a>${precoHtml('50')}
    <div class="poly-card" id="dentro"><a class="poly-component__title" href="https://www.mercadolivre.com.br/x#wid=MLB5321950961">D</a>${precoHtml('5')}</div></div>`);
  const msg = () => enviar.mock.calls.map(([m]) => m as { cards?: { itemId: string }[]; ocorrencias?: number })
    .filter((m) => m.cards?.some((c) => c.itemId === 'MLB5321950960')).at(-1);
  await vi.waitFor(() => expect(msg()).toBeTruthy(), { timeout: 3000 });
  expect(msg()!.cards!.some((c) => c.itemId === 'MLB5321950961')).toBe(false);
  const elegiveis = [...document.querySelectorAll('.poly-card')].filter((c) => !c.closest('.avantpro-product-container') && !c.parentElement?.closest('.poly-card'));
  expect(msg()!.ocorrencias).toBe(elegiveis.length);
  await vi.waitFor(() => expect(document.querySelectorAll('#fora .publiai-mini-bloco-busca')).toHaveLength(1), { timeout: 3000 });
  expect(document.querySelectorAll('#dentro .publiai-mini-bloco-busca')).toHaveLength(0);
});

describe('mutacaoUtil: o que o observer ignora', () => {
  const registros = async (fazer: () => void) => {
    const rs: MutationRecord[] = [];
    const obs = new MutationObserver((m) => rs.push(...m));
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    fazer();
    await Promise.resolve();
    rs.push(...obs.takeRecords());
    obs.disconnect();
    return rs;
  };
  it('dentro do Avant (inclusive characterData) e do host PubliAI não vale; host próprio entrando/saindo também não', async () => {
    const { mutacaoUtil } = await import('../busca');
    document.body.insertAdjacentHTML('beforeend', '<div class="poly-card"><div class="avantpro-product-container"><span id="m-av">R$ 1</span></div><div id="m-pai"></div></div>');
    const host = document.createElement('div');
    host.className = 'publiai-mini-bloco-busca';
    const rs = await registros(() => {
      document.querySelector('#m-av')!.firstChild!.textContent = 'R$ 2';
      document.querySelector('#m-av')!.setAttribute('title', 'x');
      document.querySelector('.avantpro-product-container')!.append(document.createElement('b'));
      document.querySelector('#m-pai')!.append(host);
      host.setAttribute('data-x', '1');
    });
    expect(rs.length).toBeGreaterThan(0);
    expect(rs.filter(mutacaoUtil)).toHaveLength(0);
    // Remoção do host feita pela página (não por nós) vale: o bloco precisa voltar.
    expect((await registros(() => host.remove())).filter(mutacaoUtil)).toHaveLength(1);
  });
  it('preço, imagem e link do ML valem', async () => {
    const { mutacaoUtil } = await import('../busca');
    document.body.insertAdjacentHTML('beforeend', '<div class="poly-card"><a id="m-a" href="https://x">t</a><img id="m-img" src="a"><span id="m-preco">10</span></div>');
    const rs = await registros(() => {
      document.querySelector('#m-a')!.setAttribute('href', 'https://y');
      document.querySelector('#m-img')!.setAttribute('srcset', 'b 1x');
      document.querySelector('#m-preco')!.firstChild!.textContent = '12';
    });
    expect(rs.filter(mutacaoUtil)).toHaveLength(3);
  });
});
