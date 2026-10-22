// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { lerBusca } from '../busca';

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

  it('preço ilegível vira null (nunca zero)', () => {
    const [c] = lerBusca(pagina(card({ href: P, titulo: 'X', frac: 'abc' })));
    expect(c.preco).toBeNull();
  });
});
