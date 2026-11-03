// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CardBusca } from '../../leitura/busca';
import { brlCompacto, renderizarMiniBlocoDaBusca } from '../mini-bloco-busca';
import { idadeDoCatalogo, vistaDoCard, type EstadoEnriquecimento } from '../../compartilhado/enriquecimento';

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
  // Full, frete e "Catálogo" já estão no card do ML / na linha do catálogo: fora do bloco compacto.
  expect(t).not.toMatch(/Full|Frete grátis|Catálogo/);
  expect(t).toContain('Giro mín.');
  const i = raizes[0].querySelector('button[aria-label="O que é giro mínimo?"]') as HTMLButtonElement;
  expect(i.type).toBe('button');
  expect(i.textContent).toBe('ⓘ');
  expect(t).toContain('R$ 5 mil');
  expect(t).not.toContain('Minha margem');
  expect(t).not.toContain('Meu anúncio');
  expect(t).not.toMatch(/faturamento/i);
});

it('margem só aparece quando o preço dela coincide com o da ocorrência', () => {
  renderizarMiniBlocoDaBusca(card(), undefined, ok(50, 11.21) as never);
  expect(texto(document.body)).toContain('Minha margem · Clássico 11,2%');
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
  expect(t).not.toContain('Giro mínimo');
});

it('cores da margem: rótulo roxo (identidade), valor success/destructive, aguardando em warning com texto', () => {
  const css = (r: ShadowRoot) => r.querySelector('style')!.textContent!.replace(/\s+/g, '');
  renderizarMiniBlocoDaBusca(card(), undefined, ok(50, 11.21) as never);
  expect(raizes[0].querySelector('.t.roxo')!.textContent).toBe('Minha margem · Clássico');
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

it('Loja oficial é âmbar, sem chip Catálogo, e margem indisponível tem rótulo neutro', () => {
  const h = renderizarMiniBlocoDaBusca(card({ lojaOficial: true }), { itemId: 'MLB1000001', proprio: false, vinculo: { fonte: 'catalogo', codigo: '81' } },
    { itemId: 'MLB1000001', estado: 'sem_categoria', fonte: 'catalogo', codigo: '81' });
  void h;
  const r = raizes[raizes.length - 1];
  expect(r.querySelector('.c.ambar')!.textContent).toBe('Loja oficial');
  expect(r.querySelector('.c.catalogo')).toBeNull();
  expect(r.querySelector('.t.neutro')!.textContent).toBe('Minha margem indisponível');
  expect(r.querySelector('.t.roxo')).toBeNull();
});

it('ⓘ do giro é botão: ativar mostra a explicação, de novo esconde; não propaga o clique ao card', () => {
  renderizarMiniBlocoDaBusca(card(), { itemId: 'MLB1000001', proprio: false, vinculo: null }, { itemId: 'MLB1000001', estado: 'sem_vinculo' });
  const GIRO = 'Piso de vendidos de cada produto × o preço atual do card. Serve para comparar o tamanho dos produtos entre si. Não é faturamento nem o valor realmente vendido: as vendas aconteceram a outros preços e o Mercado Livre só informa a faixa.';
  const i = raizes[0].querySelector('button[aria-label="O que é giro mínimo?"]') as HTMLButtonElement;
  const noCard = vi.fn();
  document.body.addEventListener('click', noCard);
  expect(i.getAttribute('aria-expanded')).toBe('false');
  expect(raizes[0].textContent).not.toContain(GIRO);
  i.click();
  expect(i.getAttribute('aria-expanded')).toBe('true');
  expect(raizes[0].textContent).toContain(GIRO);
  i.click();
  expect(i.getAttribute('aria-expanded')).toBe('false');
  expect(raizes[0].textContent).not.toContain(GIRO);
  expect(noCard).not.toHaveBeenCalled();
  document.body.removeEventListener('click', noCard);
});

it('host fica acima do link esticado do título do ML (::before inset 0, z-index 1): ⓘ clicável sem abrir o anúncio', () => {
  const host = renderizarMiniBlocoDaBusca(card(), undefined, undefined);
  expect(host.style.position).toBe('relative');
  expect(Number(host.style.zIndex)).toBeGreaterThan(1);
});

// Task 10: catálogo enriquecido (vendedor/medalha/UF, tipo + comissão na sua conta, vendedores, idade) e estados.
const AGORA = Date.parse('2026-11-03T12:00:00Z');
const enr = (o: Partial<EstadoEnriquecimento> = {}): EstadoEnriquecimento => ({ catalogos: {}, vendedores: {}, retomarEm: null, falhou: false, indisponivel: null, perfis: 0, ...o });
const exata = (o: Record<string, unknown> = {}) => ({ estado: 'ok', preco: 50, sellerId: 7, tipo: 'gold_special', comissao: { estado: 'ok', valor: { percentual: 14, fixa: 0, saleFeeAmount: 7.1, precoConsultado: 50 } }, ...o });
const ofertas = (o: Record<string, unknown> = {}, ex: Record<string, unknown> = { MLB1000001: exata() }) =>
  ({ estado: 'ok', total: 12, lidas: 12, vendedoresIdentificados: 9, ofertasSemVendedor: 0, completa: true, exatas: ex, ...o });
const comEnr = (e: EstadoEnriquecimento, c = card()) => renderizarMiniBlocoDaBusca(c, undefined, undefined, c.preco, vistaDoCard(c, e), AGORA);
const dias = (n: number) => new Date(AGORA - n * 86_400_000).toISOString();
const completo = (o: Record<string, unknown> = {}) => enr({
  catalogos: { MLB200: { produto: { estado: 'ok', criadoEm: dias(120) }, ofertas: ofertas(o) as never } },
  vendedores: { 7: { estado: 'ok', nome: 'V7', medalha: 'platinum', uf: 'SP' } },
});

it('enriquecido e compacto: vendedor · medalha · UF; tipo · comissão; giro; vendedores · idade (≤ 5 linhas com margem)', () => {
  const linhas = () => [...raizes[0].querySelectorAll('.b > .l')].map((l) => l.textContent!.replace(/\s+/g, ' ').trim());
  renderizarMiniBlocoDaBusca(card({ lojaOficial: true }), undefined, ok(50, 23.4) as never, 50, vistaDoCard(card(), completo()), AGORA);
  expect(linhas()).toEqual([
    'Loja Boa· Platinum· SPLoja oficial',
    'Clássico·comissão na sua contaR$ 7,10 (14%)ⓘ',
    'Giro mín.R$ 5 milⓘ',
    '9 vendedores·catálogohá 120 diasⓘ',
    'Minha margem · Clássico 23,4%',
  ]);
  expect(raizes[0].querySelector('.med')!.textContent).toBe('Platinum');
  expect(raizes[0].querySelector('.idade')!.className).toContain('recente');
  expect(raizes[0].querySelector('.idade')!.textContent).toBe('há 120 dias');
  expect(texto()).not.toMatch(/faturamento|ganhador|vencedor/i);
});

it('moeda compacta do Mini-bloco: mil / mi com 1 casa (sem ",0")', () => {
  expect(brlCompacto(209000)).toBe('R$ 209 mil');
  expect(brlCompacto(4350000)).toBe('R$ 4,4 mi');
  expect(brlCompacto(34553589)).toBe('R$ 34,6 mi');
  expect(brlCompacto(950)).toBe('R$ 950');
});

it('outra aparição do item com outro preço: comissão não aparece (é do preço exato)', () => {
  comEnr(completo(), card({ ocorrencias: [{ posicao: 9, patrocinado: true, preco: 55, vendidosTexto: null }] }));
  expect(texto()).not.toContain('comissão na sua conta R');
  expect(texto()).not.toContain('R$ 7,10');
});

it('leitura parcial: "N+ vendedores" (sentido no ⓘ); sem vendedor identificado: "vendedores não identificados"', () => {
  comEnr(completo({ completa: false }));
  expect(texto()).toContain('9+ vendedores');
  expect(texto()).not.toContain('Leitura parcial');
  raizes = [];
  comEnr(completo({ completa: false, vendedoresIdentificados: 0, ofertasSemVendedor: 3 }));
  expect(texto()).toContain('vendedores não identificados');
});

it('estados: aguardando dados, próxima janela, oferta não localizada, perfil não carregado, comissão aguardando', () => {
  comEnr(enr());
  expect(texto()).toContain('Aguardando dados do catálogo');
  raizes = [];
  comEnr(enr({ catalogos: { MLB200: { aguardandoJanela: true } }, retomarEm: AGORA + 1000 }));
  expect(texto()).toContain('Aguardando próxima janela');
  raizes = [];
  comEnr(enr({ catalogos: { MLB200: { produto: { estado: 'ok', criadoEm: null }, ofertas: ofertas({}, { MLB1000001: { estado: 'nao_encontrada', preco: 50 } }) as never } } }));
  expect(texto()).toContain('Oferta não localizada nesta leitura');
  expect(texto()).toContain('9 vendedores'); // metadados do catálogo seguem
  raizes = [];
  comEnr(enr({ catalogos: { MLB200: { ofertas: ofertas({}, { MLB1000001: exata({ tipo: null, comissao: { estado: 'aguardando' } }) }) as never } } }));
  expect(texto()).toContain('Perfil não carregado');
  expect(texto()).toContain('Tipo não confirmado'); // comissão aguardando ainda é mostrada à parte

  expect(texto()).toContain('Tipo não confirmado');
  expect(texto()).toContain('comissão na sua contaaguardandoⓘ');
});

it('pendência por componente: metadados lidos + ofertas aguardando janela → mostra a idade E a espera', () => {
  comEnr(enr({ catalogos: { MLB200: { produto: { estado: 'ok', criadoEm: dias(120) }, aguardandoJanela: true } }, retomarEm: AGORA + 1000 }));
  expect(texto()).toContain('Aguardando próxima janela');
  expect(texto()).toContain('há 120 dias');
  raizes = [];
  // Ofertas lidas, metadados ainda aguardando: vendedores + "idade aguardando".
  comEnr(enr({ catalogos: { MLB200: { ofertas: ofertas() as never, produto: { estado: 'aguardando', retomarEm: AGORA + 1000, tentativas: 1 } } } }));
  expect(texto()).toContain('9 vendedores');
  expect(texto()).toContain('idade aguardando');
  raizes = [];
  // Aguardando esgotado (2 tentativas) deixa de ser espera.
  comEnr(enr({ catalogos: { MLB200: { ofertas: ofertas() as never, produto: { estado: 'aguardando', retomarEm: null, tentativas: 2 } } } }));
  expect(texto()).not.toContain('idade aguardando');
  expect(texto()).not.toContain('Aguardando');
});

it('sem tipo e sem comissão: uma frase só ("Tipo e comissão não confirmados")', () => {
  comEnr(enr({ catalogos: { MLB200: { ofertas: ofertas({}, { MLB1000001: exata({ tipo: null, comissao: { estado: 'indisponivel', motivo: 'tipo do anúncio não confirmado' } }) }) as never } } }));
  expect(texto()).toContain('Tipo e comissão não confirmados');
  expect(texto()).not.toContain('indisponível');
});

it('card sem catálogo mantém só os dados da página', () => {
  comEnr(completo(), card({ catalogProductId: null }));
  expect(texto()).not.toMatch(/catálogo há|vendedores|Aguardando dados/);
});

it('ⓘ de "comissão na sua conta" e de "vendedores no catálogo" abrem texto curto, sem navegar', () => {
  const h = comEnr(completo());
  document.body.append(h);
  const botoes = [...raizes[0].querySelectorAll('button.i')] as HTMLButtonElement[];
  const com = botoes.find((b) => b.getAttribute('aria-label') === 'O que é comissão na sua conta?')!;
  const ven = botoes.find((b) => b.getAttribute('aria-label') === 'O que é vendedores no catálogo?')!;
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
  com.dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(true);
  expect(texto()).toContain('na sua conta para este tipo de anúncio');
  ven.click();
  expect(texto()).toMatch(/vendedores diferentes.*"N\+" = leitura parcial/);
  h.remove();
});

it('semáforo da idade nos limites 180/181/365/366 dias; futura ou inválida = indisponível', () => {
  expect(idadeDoCatalogo(dias(180), AGORA)).toEqual({ dias: 180, tom: 'recente' });
  expect(idadeDoCatalogo(dias(181), AGORA)).toEqual({ dias: 181, tom: 'medio' });
  expect(idadeDoCatalogo(dias(365), AGORA)).toEqual({ dias: 365, tom: 'medio' });
  expect(idadeDoCatalogo(dias(366), AGORA)).toEqual({ dias: 366, tom: 'antigo' });
  expect(idadeDoCatalogo(new Date(AGORA + 86_400_000).toISOString(), AGORA)).toBeNull();
  expect(idadeDoCatalogo('ontem', AGORA)).toBeNull();
  expect(idadeDoCatalogo(null, AGORA)).toBeNull();
});
