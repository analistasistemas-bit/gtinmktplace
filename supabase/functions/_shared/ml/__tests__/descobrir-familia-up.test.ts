import { describe, it, expect } from 'vitest';
import { descobrirFamiliaUP, corDoItemUP } from '../descobrir-familia-up';
import type { FetchLike } from '../buscar-item';

// Fixtures modelados no caso REAL que motivou o ADR-0105 (lote #45, PAI 02186551): o ML fechou
// MLB4847766197 e criou N itens sob family_id 2244380420892433, TODOS sem seller_custom_field.
const SELLER = '1003820507';
const CATEGORIA = 'MLB270273';
const MORTO = 'MLB4847766197';
const FAMILIA = '2244380420892433';
const TITULO = 'Barbante Euroroma 4/6 600g 610mt | 85% Algodão';

function irmao(id: string, cor: string, over: Record<string, unknown> = {}) {
  return {
    id, seller_id: SELLER, category_id: CATEGORIA, family_id: FAMILIA, family_name: TITULO,
    status: 'active', variations: [], attributes: [{ id: 'COLOR', value_name: cor }],
    ...over,
  };
}

/** fetchLike que roteia por URL: busca (`?q=`/`?family_id=`) e multiget. */
function stub(opts: {
  porTitulo: string[];
  porFamilia?: string[];
  itens: Record<string, unknown>;
  /** `paging.total` maior do que os `results` devolvidos = paginação não coberta. */
  totalInflado?: number;
}): { fetchLike: FetchLike; chamadas: string[] } {
  const chamadas: string[] = [];
  const fetchLike: FetchLike = (url) => {
    chamadas.push(url);
    const responder = (body: unknown) => Promise.resolve({
      ok: true, status: 200, json: () => Promise.resolve(body),
    });
    if (url.includes('/items?ids=')) {
      const ids = decodeURIComponent(url.split('ids=')[1].split('&')[0]).split(',');
      return responder(ids.map((id) => (
        opts.itens[id] ? { code: 200, body: opts.itens[id] } : { code: 404, body: { id } }
      )));
    }
    const results = url.includes('family_id=')
      ? (opts.porFamilia ?? opts.porTitulo)
      : opts.porTitulo;
    return responder({ results, paging: { total: opts.totalInflado ?? results.length } });
  };
  return { fetchLike, chamadas };
}

const CRIT = {
  getToken: () => Promise.resolve('tok'),
  sellerId: SELLER,
  titulo: TITULO,
  categoriaId: CATEGORIA,
  itemMortoId: MORTO,
};

describe('descobrirFamiliaUP (ADR-0105)', () => {
  it('acha a família e mapeia COR → item, ignorando o item morto que a busca também devolve', async () => {
    const { fetchLike } = stub({
      porTitulo: [MORTO, 'MLB7210143182', 'MLB7210143184'],
      itens: {
        // O item morto ainda aparece na busca por título: Legacy, com variations e sem family_id.
        [MORTO]: { id: MORTO, seller_id: SELLER, category_id: CATEGORIA, status: 'closed', variations: [{}] },
        MLB7210143182: irmao('MLB7210143182', 'Cru 100'),
        MLB7210143184: irmao('MLB7210143184', 'Vermelho 1000'),
      },
    });
    const r = await descobrirFamiliaUP(fetchLike, CRIT);
    expect(r.tipo).toBe('achada');
    if (r.tipo !== 'achada') return;
    expect(r.familia.familyId).toBe(FAMILIA);
    expect(r.familia.familyName).toBe(TITULO);
    expect(r.familia.itemPorCor.get('Cru 100')).toBe('MLB7210143182');
    expect(r.familia.itemPorCor.get('Vermelho 1000')).toBe('MLB7210143184');
    expect(r.familia.coresAmbiguas).toEqual([]);
  });

  it('a enumeração por family_id é a fonte autoritativa — pega irmão que a busca por título não devolveu', async () => {
    // Caso real: `?q=` devolveu 18, `?family_id=` devolveu os mesmos + 1 (cor adicionada depois).
    const { fetchLike, chamadas } = stub({
      porTitulo: [MORTO, 'MLB7210143182'],
      porFamilia: ['MLB7210143182', 'MLB7218244860'],
      itens: {
        [MORTO]: { id: MORTO, seller_id: SELLER, category_id: CATEGORIA, status: 'closed', variations: [{}] },
        MLB7210143182: irmao('MLB7210143182', 'Cru 100'),
        MLB7218244860: irmao('MLB7218244860', 'Rosa Bebê - 510'),
      },
    });
    const r = await descobrirFamiliaUP(fetchLike, CRIT);
    expect(r.tipo).toBe('achada');
    if (r.tipo !== 'achada') return;
    expect([...r.familia.itemPorCor.keys()].sort()).toEqual(['Cru 100', 'Rosa Bebê - 510']);
    expect(chamadas.some((u) => u.includes(`family_id=${FAMILIA}`))).toBe(true);
  });

  it('dois family_id candidatos → ambigua, com os ids observados (nunca escolhe)', async () => {
    const { fetchLike } = stub({
      porTitulo: ['MLB1', 'MLB2'],
      itens: {
        MLB1: irmao('MLB1', 'Cru 100'),
        MLB2: irmao('MLB2', 'Cru 100', { family_id: '999' }),
      },
    });
    const r = await descobrirFamiliaUP(fetchLike, CRIT);
    expect(r.tipo).toBe('ambigua');
    if (r.tipo !== 'ambigua') return;
    expect(r.familyIds.sort()).toEqual(['2244380420892433', '999']);
  });

  it('duas cores iguais entre irmãos vivos → cor fica ambígua e NÃO vira vínculo', async () => {
    const { fetchLike } = stub({
      porTitulo: ['MLB1', 'MLB2'],
      itens: { MLB1: irmao('MLB1', 'Cru 100'), MLB2: irmao('MLB2', 'Cru 100') },
    });
    const r = await descobrirFamiliaUP(fetchLike, CRIT);
    expect(r.tipo).toBe('achada');
    if (r.tipo !== 'achada') return;
    expect(r.familia.itemPorCor.size).toBe(0);
    expect(r.familia.coresAmbiguas).toEqual(['Cru 100']);
  });

  it.each([
    ['outro vendedor', { seller_id: '999' }],
    ['outra categoria', { category_id: 'MLB999' }],
    ['ainda Legacy (tem variations)', { variations: [{ id: 1 }] }],
    ['sem family_id', { family_id: null }],
    ['status remoto desconhecido', { status: 'under_review' }],
    ['status terminal', { status: 'closed' }],
  ])('descarta candidato: %s', async (_nome, over) => {
    const { fetchLike } = stub({
      porTitulo: ['MLB1'],
      itens: { MLB1: irmao('MLB1', 'Cru 100', over) },
    });
    expect((await descobrirFamiliaUP(fetchLike, CRIT)).tipo).toBe('nenhuma');
  });

  it('paginação não coberta → truncada, nunca trata conjunto parcial como completo', async () => {
    // Um `?q=` truncado pode esconder um segundo family_id e virar um `achada` confiante e errado.
    const { fetchLike, chamadas } = stub({
      porTitulo: ['MLB1'],
      itens: { MLB1: irmao('MLB1', 'Cru 100') },
      totalInflado: 900,
    });
    const r = await descobrirFamiliaUP(fetchLike, CRIT);
    expect(r.tipo).toBe('truncada');
    if (r.tipo !== 'truncada') return;
    expect(r.total).toBe(900);
    expect(chamadas.some((u) => u.includes('family_id='))).toBe(false);
  });

  it('busca por título sem nenhum resultado → nenhuma, sem enumerar família', async () => {
    const { fetchLike, chamadas } = stub({ porTitulo: [], itens: {} });
    expect((await descobrirFamiliaUP(fetchLike, CRIT)).tipo).toBe('nenhuma');
    expect(chamadas.some((u) => u.includes('family_id='))).toBe(false);
  });

  it('nenhuma chamada de escrita: só GET de busca e multiget', async () => {
    const { fetchLike, chamadas } = stub({
      porTitulo: ['MLB1'],
      itens: { MLB1: irmao('MLB1', 'Cru 100') },
    });
    await descobrirFamiliaUP(fetchLike, CRIT);
    expect(chamadas.every((u) => u.includes('/items/search') || u.includes('/items?ids='))).toBe(true);
  });
});

describe('corDoItemUP', () => {
  it('lê COLOR.value_name da raiz do item', () => {
    expect(corDoItemUP([{ id: 'BRAND', value_name: 'X' }, { id: 'COLOR', value_name: 'Azul' }])).toBe('Azul');
  });
  it('sem COLOR ou com value_name vazio → null (nunca vira chave de casamento)', () => {
    expect(corDoItemUP([{ id: 'BRAND', value_name: 'X' }])).toBeNull();
    expect(corDoItemUP([{ id: 'COLOR', value_name: '' }])).toBeNull();
    expect(corDoItemUP(undefined)).toBeNull();
  });
});
