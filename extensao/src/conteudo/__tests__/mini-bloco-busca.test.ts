// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CardBusca } from '../../leitura/busca';
import { renderizarMiniBlocoDaBusca } from '../mini-bloco-busca';

let raizes: ShadowRoot[] = [];
let modos: string[] = [];
beforeEach(() => {
  raizes = []; modos = [];
  const orig = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
    modos.push(init.mode);
    const r = orig.call(this, init);
    raizes.push(r);
    return r;
  });
});
afterEach(() => vi.restoreAllMocks());

const card = (o: Partial<CardBusca> = {}): CardBusca => ({
  itemId: 'MLB1000001', catalogProductId: 'MLB200', userProductId: null, posicao: 3, titulo: 'X', preco: 50,
  vendedor: 'Loja Boa', nota: null, vendidosTexto: '+100 vendidos', freteGratis: true, full: true, lojaOficial: null,
  patrocinado: false, selos: [], miniaturaUrl: null, identidadeConflitante: false,
  ocorrencias: [{ posicao: 3, patrocinado: false, preco: 50, vendidosTexto: '+100 vendidos' }], ...o,
});
const ok = (preco: number, margemPct: number) => ({
  itemId: 'MLB1000001', estado: 'ok' as const, fonte: 'catalogo' as const, codigo: '81', custo: {} as never,
  margem: { preco, classico: { estado: 'ok' as const, valor: { margemPct } as never }, premium: { estado: 'indisponivel' as const, motivo: 'x' } },
});
const texto = (_?: unknown) => { expect(raizes).toHaveLength(1); return raizes[0].textContent!.replace(/\s+/g, ' '); };

it('card sem vínculo recebe bloco local em Shadow DOM fechado: vendedor, sinais, volume mínimo', () => {
  const h = renderizarMiniBlocoDaBusca(card(), { itemId: 'MLB1000001', proprio: false, vinculo: null }, { itemId: 'MLB1000001', estado: 'sem_vinculo' });
  expect(h.className).toBe('publiai-mini-bloco-busca');
  expect(modos).toEqual(['closed']);
  const t = texto(h);
  expect(t).toContain('Loja Boa');
  expect(t).toContain('Full');
  expect(t).toContain('Frete grátis');
  expect(t).toContain('Volume mínimo ao preço atual');
  expect(t).toContain('R$ 5.000,00');
  expect(t).not.toContain('Minha margem');
  expect(t).not.toContain('Meu anúncio');
  expect(t).not.toMatch(/faturamento/i);
});

it('margem só aparece quando o preço dela coincide com o da ocorrência', () => {
  renderizarMiniBlocoDaBusca(card(), undefined, ok(50, 11.21) as never);
  expect(texto(document.body)).toContain('Minha margem · simulação Clássico 11,2%');
  raizes = [];
  renderizarMiniBlocoDaBusca(card({ preco: 45, ocorrencias: [{ posicao: 3, patrocinado: true, preco: 45, vendidosTexto: null }] }), undefined, ok(50, 11.21) as never);
  expect(texto(document.body)).not.toContain('Minha margem');
});

it('status de margem (limite, sem categoria, indisponível) só na aparição do preço analisado (revisão final)', () => {
  const base = { itemId: 'MLB1000001', fonte: 'catalogo' as const, codigo: '81' };
  const estados = [{ ...base, estado: 'limite' as const }, { ...base, estado: 'sem_categoria' as const }, { ...base, estado: 'indisponivel' as const, motivo: 'x' }];
  for (const m of estados) {
    raizes = [];
    // Item analisado a R$10 (1º preço do item na busca); esta aparição (orgânica) é a de R$30.
    renderizarMiniBlocoDaBusca(card({ preco: 30, ocorrencias: [{ posicao: 5, patrocinado: false, preco: 30, vendidosTexto: null }] }), undefined, m, 10);
    expect(texto(document.body)).not.toContain('Minha margem');
    raizes = [];
    renderizarMiniBlocoDaBusca(card({ preco: 10, ocorrencias: [{ posicao: 1, patrocinado: true, preco: 10, vendidosTexto: null }] }), undefined, m, 10);
    expect(texto(document.body)).toContain('Minha margem');
  }
});

it('meu anúncio com posição e tipo da ocorrência; posição ausente = "posição não informada"; proprio null nada conclusivo', () => {
  const meta = { itemId: 'MLB1000001', proprio: true, vinculo: null };
  renderizarMiniBlocoDaBusca(card({ ocorrencias: [{ posicao: 7, patrocinado: true, preco: 50, vendidosTexto: null }] }), meta, undefined);
  expect(texto(document.body)).toContain('Meu anúncio · posição 7 · patrocinado');
  raizes = [];
  renderizarMiniBlocoDaBusca(card({ ocorrencias: [{ posicao: null, patrocinado: false, preco: 50, vendidosTexto: null }] }), meta, undefined);
  expect(texto(document.body)).toContain('Meu anúncio · posição não informada · orgânico');
  raizes = [];
  renderizarMiniBlocoDaBusca(card(), { ...meta, proprio: null }, undefined);
  expect(texto(document.body)).not.toContain('Meu anúncio');
});

it('margem aguardando cota (limite) e calculando (vinculado sem resultado)', () => {
  renderizarMiniBlocoDaBusca(card(), undefined, { itemId: 'MLB1000001', estado: 'limite', fonte: 'catalogo', codigo: '81' });
  expect(texto(document.body)).toContain('Minha margem · aguardando cota');
  raizes = [];
  renderizarMiniBlocoDaBusca(card(), { itemId: 'MLB1000001', proprio: false, vinculo: { fonte: 'catalogo', codigo: '81' } }, undefined);
  expect(texto(document.body)).toContain('Minha margem · calculando');
});

it('texto da página entra como texto, nunca como HTML', () => {
  renderizarMiniBlocoDaBusca(card({ vendedor: '<img src=x onerror=alert(1)>' }), undefined, undefined);
  expect(raizes[0].querySelector('img')).toBeNull();
  expect(texto(document.body)).toContain('<img src=x onerror=alert(1)>');
});

it('sem vendedor nem sinais: diz "vendedor não informado"; sem vendidos não inventa volume', () => {
  renderizarMiniBlocoDaBusca(card({ vendedor: null, full: null, freteGratis: null, ocorrencias: [{ posicao: 1, patrocinado: false, preco: 50, vendidosTexto: null }] }), undefined, undefined);
  const t = texto(document.body);
  expect(t).toContain('Vendedor não informado');
  expect(t).not.toContain('Volume mínimo');
});

it('cores da margem: rótulo roxo (identidade), valor success/destructive, aguardando em warning com texto', () => {
  const css = (r: ShadowRoot) => r.querySelector('style')!.textContent!.replace(/\s+/g, '');
  renderizarMiniBlocoDaBusca(card(), undefined, ok(50, 11.21) as never);
  expect(raizes[0].querySelector('.t.roxo')!.textContent).toBe('Minha margem · simulação Clássico');
  expect(raizes[0].querySelector('.t.lucro')!.textContent).toBe('11,2%');
  for (const regra of ['.roxo{--c:var(--chart-1)}', '.lucro{--c:var(--success)}', '.prejuizo{--c:var(--destructive)}', '.aguardando{--c:var(--warning)}']) {
    expect(css(raizes[0])).toContain(regra);
  }
  renderizarMiniBlocoDaBusca(card(), undefined, ok(50, -3.4) as never);
  expect(raizes[1].querySelector('.t.prejuizo')!.textContent).toBe('-3,4%');
  expect(raizes[1].querySelector('.t.lucro')).toBeNull();
  renderizarMiniBlocoDaBusca(card(), undefined, { itemId: 'MLB1000001', estado: 'limite', fonte: 'catalogo', codigo: '81' });
  expect(raizes[2].querySelector('.t.aguardando')!.textContent).toBe('Minha margem · aguardando cota');
  expect(raizes[2].querySelector('.t.roxo, .t.lucro, .t.prejuizo')).toBeNull();
});

it('Loja oficial é âmbar, Catálogo é chip transparente e margem indisponível tem rótulo neutro', () => {
  const h = renderizarMiniBlocoDaBusca(card({ lojaOficial: true }), { itemId: 'MLB1000001', proprio: false, vinculo: { fonte: 'catalogo', codigo: '81' } },
    { itemId: 'MLB1000001', estado: 'sem_categoria', fonte: 'catalogo', codigo: '81' });
  void h;
  const r = raizes[raizes.length - 1];
  expect(r.querySelector('.c.ambar')!.textContent).toBe('Loja oficial');
  expect(r.querySelector('.c.catalogo')!.textContent).toBe('Catálogo');
  expect(r.querySelector('.t.neutro')!.textContent).toBe('Minha margem indisponível');
  expect(r.querySelector('.t.roxo')).toBeNull();
});
