import { describe, it, expect } from 'vitest';
import { buscarItemPorSku, type FetchLike } from '../buscar-item';

// GET /users/{seller}/items/search?sku=  → só `sku` é filtro server-side garantido (ADR-0088).
// category_id / family_name exato / seller / janela de recência são validados via multiget dos IDs.

const CRIT = { accessToken: 'tok', sellerId: 'seller-1', categoriaId: 'MLB419782', familyName: 'AGULHA MATTE [7]', desdeMs: Date.parse('2026-07-01') };

function resp(json: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(json) });
}

// Monta um fetch fake que responde à busca (paginada) e ao multiget /items?ids=.
function fakeFetch(searchPages: Array<{ results: string[]; total: number }>, itens: Record<string, unknown>): FetchLike {
  let page = 0;
  return (url: string) => {
    if (url.includes('/items/search')) {
      const p = searchPages[Math.min(page, searchPages.length - 1)];
      page++;
      const offsetMatch = /offset=(\d+)/.exec(url);
      const offset = offsetMatch ? Number(offsetMatch[1]) : 0;
      return resp({ results: p.results, paging: { total: p.total, offset, limit: 100 } });
    }
    if (url.includes('/items?ids=')) {
      const ids = decodeURIComponent(/ids=([^&]+)/.exec(url)![1]).split(',');
      return resp(ids.map((id) => (itens[id] ? { code: 200, body: itens[id] } : { code: 404, body: { id } })));
    }
    return resp({}, false, 500);
  };
}

const item = (over: Record<string, unknown> = {}) => ({
  id: 'MLB1', category_id: 'MLB419782', family_name: 'AGULHA MATTE [7]',
  seller_id: 'seller-1', date_created: '2026-07-20T10:00:00Z', ...over,
});

describe('buscarItemPorSku (adoção de órfão por seller_custom_field)', () => {
  it('nenhum resultado → nenhum', async () => {
    const f = fakeFetch([{ results: [], total: 0 }], {});
    expect(await buscarItemPorSku(f, CRIT, 's1')).toEqual({ tipo: 'nenhum' });
  });

  it('exatamente 1 match válido → um (adota o id)', async () => {
    const f = fakeFetch([{ results: ['MLB1'], total: 1 }], { MLB1: item() });
    expect(await buscarItemPorSku(f, CRIT, 's1')).toEqual({ tipo: 'um', itemExternoId: 'MLB1' });
  });

  it('>1 match válido → ambiguo (nunca adota o primeiro)', async () => {
    const f = fakeFetch([{ results: ['MLB1', 'MLB2'], total: 2 }], { MLB1: item(), MLB2: item({ id: 'MLB2' }) });
    expect(await buscarItemPorSku(f, CRIT, 's1')).toEqual({ tipo: 'ambiguo' });
  });

  it('paging.total maior do que o coberto → truncado (não assume 1º lote completo)', async () => {
    // total 5000, cada página 100, cap de páginas não cobre tudo
    const pages = Array.from({ length: 3 }, () => ({ results: Array.from({ length: 100 }, (_, i) => `X${i}`), total: 5000 }));
    const f = fakeFetch(pages, {});
    expect(await buscarItemPorSku(f, CRIT, 's1')).toEqual({ tipo: 'truncado' });
  });

  it('category_id divergente → filtrado (nenhum)', async () => {
    const f = fakeFetch([{ results: ['MLB1'], total: 1 }], { MLB1: item({ category_id: 'MLB000' }) });
    expect(await buscarItemPorSku(f, CRIT, 's1')).toEqual({ tipo: 'nenhum' });
  });

  it('family_name divergente → filtrado (nenhum)', async () => {
    const f = fakeFetch([{ results: ['MLB1'], total: 1 }], { MLB1: item({ family_name: 'OUTRA FAMILIA' }) });
    expect(await buscarItemPorSku(f, CRIT, 's1')).toEqual({ tipo: 'nenhum' });
  });

  it('seller divergente → filtrado (nenhum)', async () => {
    const f = fakeFetch([{ results: ['MLB1'], total: 1 }], { MLB1: item({ seller_id: 'seller-99' }) });
    expect(await buscarItemPorSku(f, CRIT, 's1')).toEqual({ tipo: 'nenhum' });
  });

  it('fora da janela de recência (item antigo) → filtrado (nenhum)', async () => {
    const f = fakeFetch([{ results: ['MLB1'], total: 1 }], { MLB1: item({ date_created: '2025-01-01T00:00:00Z' }) });
    expect(await buscarItemPorSku(f, CRIT, 's1')).toEqual({ tipo: 'nenhum' });
  });

  it('pagina de verdade: coleta ids em 2 páginas e valida o único bom', async () => {
    const pages = [
      { results: Array.from({ length: 100 }, (_, i) => `A${i}`), total: 150 },
      { results: [...Array.from({ length: 49 }, (_, i) => `B${i}`), 'MLB1'], total: 150 },
    ];
    const itens: Record<string, unknown> = { MLB1: item() }; // só MLB1 valida (resto 404/inválido)
    const f = fakeFetch(pages, itens);
    expect(await buscarItemPorSku(f, CRIT, 's1')).toEqual({ tipo: 'um', itemExternoId: 'MLB1' });
  });
});
