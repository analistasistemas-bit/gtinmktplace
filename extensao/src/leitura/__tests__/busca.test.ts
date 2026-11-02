// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { lerBusca, normalizarCards } from '../busca';

// Estrutura medida em lista.mercadolivre.com.br (22/10): card patrocinado (click1 + is_advertising), card de catálogo
// (/p/MLB…) e card /up/; o Avantpro injeta `.avantpro-product-container` dentro do card (deve ser ignorado).
const card = (o: { href: string; titulo: string; vendedor?: string; oficial?: boolean; review?: string; frac: string; cents?: string; frete?: boolean; full?: boolean; ad?: boolean; selo?: string }) => `
  <li class="ui-search-layout__item"><div class="poly-card poly-card--grid-card">
    <div class="poly-card__portada">${o.selo ? `<div class="poly-component__poly-label"><span class="polylabel-fw-semibold">${o.selo}</span></div>` : ''}</div>
    <div class="poly-card__content">
      <h3 class="poly-component__title-wrapper"><a class="poly-component__title" href="${o.href}">${o.titulo}</a></h3>
      ${o.vendedor ? `<span class="poly-component__seller">${o.vendedor}${o.oficial ? '<svg class="polylabel-icon" aria-label="Loja oficial"></svg>' : ''}</span>` : ''}
      ${o.review ? `<div class="poly-component__review-compacted">${o.review}</div>` : ''}
      <div class="avantpro-product-container product-info-slot" data-slot="MLB999">Comece a usar o Avantpro! +99mil vendidos Frete grátis Enviado pelo FULL</div>
      <div class="poly-component__price"><div class="poly-price__current"><span class="andes-money-amount">
        <span class="andes-money-amount__currency-symbol">R$</span><span class="andes-money-amount__fraction">${o.frac}</span>${o.cents ? `<span class="andes-money-amount__cents">${o.cents}</span>` : ''}
      </span></div></div>
      <div class="poly-component__shipping">${o.frete ? '<span class="polylabel-label">Frete grátis</span>' : ''}${o.full ? '<svg class="polylabel-icon" aria-label="Enviado pelo FULL"></svg>' : ''}</div>
    </div>
    ${o.ad ? '<div class="poly-card__footer"><a class="poly-component__ads-promotions" aria-label="Patrocinado">Ad</a></div>' : ''}
  </div></li>`;

const PAD = 'https://click1.mercadolivre.com.br/mclics/clicks/external/MLB/count?a=xyz&pdp_filters=item_id%3AMLB4053374163#polycard_client=search-nordic&is_advertising=true&position=1&type=pad&tracking_id=t1';
const P = 'https://www.mercadolivre.com.br/jogo-de-panelas/p/MLB32466350#polycard_client=search-nordic&position=5&type=product&tracking_id=t2&wid=MLB4053374163&sid=search';
const UP = 'https://www.mercadolivre.com.br/jogo-panelas/up/MLBU1959450397#polycard_client=search-nordic&position=12&type=product&wid=MLB2880235461';

function pagina(html: string) {
  document.body.innerHTML = `<ol>${html}</ol>`;
  return document;
}

describe('lerBusca (Task 20)', () => {
  it('card de catálogo: item pelo wid, catálogo pelo caminho e campos observados', () => {
    const [c] = lerBusca(pagina(card({ href: P, titulo: 'Jogo de Panelas Tramontina', vendedor: 'TRAMONTINA', oficial: true, review: '4.9 | +10mil vendidos', frac: '301', cents: '30', frete: true, full: true, selo: 'MAIS VENDIDO' })));
    expect(c).toEqual({
      itemId: 'MLB4053374163', catalogProductId: 'MLB32466350', userProductId: null, posicao: 5,
      titulo: 'Jogo de Panelas Tramontina', preco: 301.3, vendedor: 'TRAMONTINA',
      nota: 4.9, vendidosTexto: '+10mil vendidos', freteGratis: true, full: true, lojaOficial: true, patrocinado: false, selos: ['MAIS VENDIDO'],
      miniaturaUrl: null, identidadeConflitante: false, ocorrencias: [{ posicao: 5, patrocinado: false, preco: 301.3, vendidosTexto: '+10mil vendidos' }],
    });
  });

  it('patrocinado: item pelo wid/pdp_filters, catálogo desconhecido; ausência de selo é desconhecida (null), não falso', () => {
    const [c] = lerBusca(pagina(card({ href: PAD, titulo: 'Kit Panelas', frac: '798', cents: '90', ad: true })));
    expect(c).toMatchObject({ itemId: 'MLB4053374163', catalogProductId: null, patrocinado: true, freteGratis: null, full: null, lojaOficial: null, nota: null, vendidosTexto: null, preco: 798.9 });
  });

  it('/up/: produto do vendedor, sem catálogo comprovado', () => {
    const [c] = lerBusca(pagina(card({ href: UP, titulo: 'Panelas', frac: '1.299', frete: true })));
    expect(c).toMatchObject({ itemId: 'MLB2880235461', catalogProductId: null, userProductId: 'MLBU1959450397', preco: 1299, posicao: 12 });
  });

  it('nunca lê o que outra extensão injetou no card (Avantpro)', () => {
    const [c] = lerBusca(pagina(card({ href: P, titulo: 'X', frac: '10' })));
    expect([c.vendidosTexto, c.freteGratis, c.full]).toEqual([null, null, null]);
  });

  it('card sem item comprovado (link de outro domínio, sem wid ou id malformado) é descartado; repetido entra uma vez', () => {
    const html = [
      card({ href: 'https://evil.example.com/p/MLB1#wid=MLB2', titulo: 'a', frac: '1' }),
      card({ href: 'https://www.mercadolivre.com.br/x/p/MLB1#type=product', titulo: 'b', frac: '1' }),
      card({ href: 'https://www.mercadolivre.com.br/x/p/MLB1#wid=MLBX', titulo: 'c', frac: '1' }),
      card({ href: P, titulo: 'd', frac: '1' }),
      card({ href: P, titulo: 'd de novo', frac: '1' }),
    ].join('');
    expect(lerBusca(pagina(html)).map((c) => c.titulo)).toEqual(['d']);
  });

  it('mesmo item como patrocinado e orgânico: uma entrada com o catálogo do orgânico e marcada como patrocinada', () => {
    const r = lerBusca(pagina(card({ href: PAD, titulo: 'Panelas', frac: '301', cents: '30', ad: true }) + card({ href: P, titulo: 'Panelas', frac: '301', cents: '30', selo: 'MAIS VENDIDO' })));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ itemId: 'MLB4053374163', catalogProductId: 'MLB32466350', patrocinado: true, posicao: 1, selos: ['MAIS VENDIDO'] });
  });

  it('Grok: texto injetado DENTRO de nós do ML não contamina nota, vendidos, preço, selo nem vendedor', () => {
    const inj = '<span class="avantpro-product-container">1.2 | +99mil vendidos FALSO OUTRO 1 99</span>';
    document.body.innerHTML = `<ol><li><div class="poly-card">
      <div class="poly-component__poly-label">${inj}MAIS VENDIDO</div>
      <a class="poly-component__title" href="${P}">Panelas</a>
      <span class="poly-component__seller">TRAMONTINA${inj}</span>
      <div class="poly-component__review-compacted">${inj}4.9 | +10mil vendidos</div>
      <div class="poly-price__current"><span class="andes-money-amount__fraction">${inj}301</span><span class="andes-money-amount__cents">30</span></div>
      <span class="polylabel-label">Frete grátis${inj}</span>
    </div></li></ol>`;
    const [c] = lerBusca(document);
    expect(c).toMatchObject({ nota: 4.9, vendidosTexto: '+10mil vendidos', preco: 301.3, vendedor: 'TRAMONTINA', selos: ['MAIS VENDIDO'], freteGratis: true });
  });

  it('Grok: "N vendidos" sem nota não vira nota', () => {
    for (const review of ['4 vendidos', '1 vendido', '+4 vendidos', '10 vendidos']) {
      const [c] = lerBusca(pagina(card({ href: P, titulo: 'X', frac: '10', review })));
      expect(c.nota).toBeNull();
      expect(c.vendidosTexto).not.toBeNull();
    }
  });

  it('Grok: catálogo só de link www/produto; catálogos diferentes para o mesmo item → desconhecido', () => {
    const padComP = 'https://click1.mercadolivre.com.br/x/p/MLB999999999?pdp_filters=item_id%3AMLB4053374163#is_advertising=true&position=1';
    const r = lerBusca(pagina(card({ href: padComP, titulo: 'a', frac: '1', ad: true }) + card({ href: P, titulo: 'a', frac: '1' })));
    expect(r[0].catalogProductId).toBe('MLB32466350');
    const outroP = 'https://www.mercadolivre.com.br/y/p/MLB77777777#wid=MLB4053374163&position=9';
    expect(lerBusca(pagina(card({ href: P, titulo: 'a', frac: '1' }) + card({ href: outroP, titulo: 'a', frac: '1' })))[0].catalogProductId).toBeNull();
  });

  it('Grok: card aninhado não empresta preço nem Full ao card de fora', () => {
    document.body.innerHTML = `<ol><li><div class="poly-card">
      <a class="poly-component__title" href="${P}">Fora</a>
      <div class="poly-card"><a class="poly-component__title" href="${UP}">Dentro</a>
        <div class="poly-price__current"><span class="andes-money-amount__fraction">1</span></div>
        <svg aria-label="Enviado pelo FULL"></svg></div>
    </div></li></ol>`;
    const fora = lerBusca(document).find((c) => c.titulo === 'Fora')!;
    expect([fora.preco, fora.full]).toEqual([null, null]);
  });

  it('Grok: pdp_filters em lista, wid vazio cai no pdp_filters; ids curtos de catálogo/up são descartados', () => {
    const lista = 'https://click1.mercadolivre.com.br/mclics/clicks/external/MLB/count?pdp_filters=item_id%3AMLB4053374163%2Cofficial_store%3A1#wid=&is_advertising=true';
    expect(lerBusca(pagina(card({ href: lista, titulo: 'a', frac: '1' })))[0].itemId).toBe('MLB4053374163');
    const curto = 'https://www.mercadolivre.com.br/x/p/MLB1#wid=MLB4053374163';
    expect(lerBusca(pagina(card({ href: curto, titulo: 'a', frac: '1' })))[0].catalogProductId).toBeNull();
  });

  it('preço ilegível vira null (nunca zero)', () => {
    const [c] = lerBusca(pagina(card({ href: P, titulo: 'X', frac: 'abc' })));
    expect(c.preco).toBeNull();
  });
});

// Medido em 02/11 (lista.mercadolivre.com.br): cada card tem uma `img.poly-component__picture` em `.poly-card__portada`,
// lazy, com `src` real em http2.mlstatic.com mesmo abaixo da dobra (currentSrc vazio até carregar).
const IMG = 'https://http2.mlstatic.com/D_Q_NP_2X_776821-MLA99365251528_112025-E.webp';
const comImg = (html: string, src: string | null) =>
  html.replace('<div class="poly-card__portada">', `<div class="poly-card__portada">${src === null ? '' : `<img class="poly-component__picture" loading="lazy" srcset="${src} 2x" src="${src}">`}`);

describe('miniatura e ocorrências (modo busca completo)', () => {
  it('lê o src da imagem do próprio card; a injetada pelo Avant e a de card aninhado não valem', () => {
    const base = card({ href: P, titulo: 'a', frac: '1' })
      .replace('Comece a usar', '<img class="poly-component__picture" src="https://http2.mlstatic.com/AVANT.webp">Comece a usar');
    expect(lerBusca(pagina(comImg(base, IMG)))[0].miniaturaUrl).toBe(IMG);
    expect(lerBusca(pagina(base))[0].miniaturaUrl).toBeNull();
    document.body.innerHTML = `<ol><li><div class="poly-card"><a class="poly-component__title" href="${P}">Fora</a>
      <div class="poly-card"><div class="poly-card__portada"><img class="poly-component__picture" src="${IMG}"></div></div></div></li></ol>`;
    expect(lerBusca(document)[0].miniaturaUrl).toBeNull();
  });

  it('só https em http2.mlstatic.com, sem credenciais; data:, outro host e http viram null', () => {
    const ruins = ['data:image/gif;base64,R0lGOD', 'http://http2.mlstatic.com/a.webp', 'https://evil.example.com/a.webp',
      'https://user:pw@http2.mlstatic.com/a.webp', 'https://http2.mlstatic.com.evil.com/a.webp', 'javascript:alert(1)'];
    for (const src of ruins) {
      expect(lerBusca(pagina(comImg(card({ href: P, titulo: 'a', frac: '1' }), src)))[0].miniaturaUrl).toBeNull();
    }
  });

  it('item repetido guarda cada ocorrência com a própria posição e preço; imagem que só o 2º card traz completa', () => {
    const a = card({ href: PAD, titulo: 'a', frac: '10', ad: true });
    const b = comImg(card({ href: P, titulo: 'a', frac: '12' }), IMG);
    const [c] = lerBusca(pagina(a + b));
    expect(c.ocorrencias).toEqual([
      { posicao: 1, patrocinado: true, preco: 10, vendidosTexto: null },
      { posicao: 5, patrocinado: false, preco: 12, vendidosTexto: null },
    ]);
    expect(c.miniaturaUrl).toBe(IMG);
  });

  it('normalizarCards revalida miniatura e ocorrências vindas da página', () => {
    const [c] = normalizarCards([{ itemId: 'MLB4053374163', miniaturaUrl: 'https://evil.example.com/a.webp',
      identidadeConflitante: 1, ocorrencias: [{ posicao: 2, patrocinado: 1, preco: 9.5 }, { posicao: -1, patrocinado: true, preco: 'x', vendidosTexto: '+5 vendidos' }, 'lixo'] }]);
    expect(c.identidadeConflitante).toBe(false);
    expect(c.miniaturaUrl).toBeNull();
    expect(c.ocorrencias).toEqual([{ posicao: 2, patrocinado: false, preco: 9.5, vendidosTexto: null }, { posicao: null, patrocinado: true, preco: null, vendidosTexto: '+5 vendidos' }]);
    expect(normalizarCards([{ itemId: 'MLB4053374163', miniaturaUrl: IMG }])[0].miniaturaUrl).toBe(IMG);
  });
});

describe('ocorrências e conflito (fix rodada 1)', () => {
  it('vendidos ficam na ocorrência de origem (patrocinado sem vendidos, orgânico com)', () => {
    const a = card({ href: PAD, titulo: 'a', frac: '10', ad: true });
    const b = card({ href: P, titulo: 'a', frac: '30', review: '4.9 | +100 vendidos' });
    expect(lerBusca(pagina(a + b))[0].ocorrencias.map((o) => [o.preco, o.vendidosTexto])).toEqual([[10, null], [30, '+100 vendidos']]);
  });
  it('catálogos diferentes para o mesmo item: catálogo null e identidadeConflitante true', () => {
    const outroP = 'https://www.mercadolivre.com.br/y/p/MLB77777777#wid=MLB4053374163&position=9';
    const [c] = lerBusca(pagina(card({ href: P, titulo: 'a', frac: '1' }) + card({ href: outroP, titulo: 'a', frac: '1' })));
    expect([c.catalogProductId, c.identidadeConflitante]).toEqual([null, true]);
  });
});
